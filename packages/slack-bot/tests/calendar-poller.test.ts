import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../src/event-bus';

const { mockEventsList, mockCalendarList } = vi.hoisted(() => ({
  mockEventsList: vi.fn(),
  mockCalendarList: vi.fn(),
}));

vi.mock('googleapis', () => {
  function MockOAuth2() {
    // @ts-ignore
    this.setCredentials = vi.fn();
  }
  return {
    google: {
      auth: { OAuth2: MockOAuth2 },
      calendar: vi.fn().mockReturnValue({
        calendarList: {
          list: mockCalendarList,
        },
        events: {
          list: mockEventsList,
        },
      }),
    },
  };
});

import { CalendarPoller } from '../src/event-sources/calendar-poller';

// Helper: default calendarList response with a single calendar
const defaultCalendarListResponse = {
  data: {
    items: [{ id: 'primary' }],
  },
};

describe('CalendarPoller', () => {
  let bus: EventBus;
  let poller: CalendarPoller;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    bus = new EventBus();
    poller = new CalendarPoller(bus, {
      enabled: true,
      intervalMinutes: 15,
      alertBeforeMinutes: 10,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has correct source metadata', () => {
    const status = poller.getStatus();
    expect(status.name).toBe('calendar');
    expect(status.type).toBe('poller');
    expect(status.enabled).toBe(true);
  });

  it('emits event_starting for events within alertBeforeMinutes', async () => {
    const handler = vi.fn();
    bus.on('event_starting', handler);

    const now = new Date();
    const soonStart = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes from now

    mockCalendarList.mockResolvedValueOnce(defaultCalendarListResponse);
    mockEventsList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'evt-1',
            summary: 'Team Standup',
            location: 'Room A',
            start: { dateTime: soonStart.toISOString() },
            end: { dateTime: new Date(soonStart.getTime() + 30 * 60 * 1000).toISOString() },
          },
        ],
      },
    });

    await poller.poll();

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.source).toBe('calendar');
    expect(event.type).toBe('event_starting');
    expect(event.priority).toBe('high');
    expect(event.data.eventId).toBe('evt-1');
    expect(event.data.summary).toBe('Team Standup');
    expect(event.data.location).toBe('Room A');
    expect(event.dedupKey).toBe('calendar:evt-1:starting');
  });

  it('emits event_upcoming for events further in the future', async () => {
    const handler = vi.fn();
    bus.on('event_upcoming', handler);

    const now = new Date();
    const laterStart = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now

    mockCalendarList.mockResolvedValueOnce(defaultCalendarListResponse);
    mockEventsList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'evt-2',
            summary: 'Lunch Meeting',
            location: null,
            start: { dateTime: laterStart.toISOString() },
            end: { dateTime: new Date(laterStart.getTime() + 60 * 60 * 1000).toISOString() },
          },
        ],
      },
    });

    await poller.poll();

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.type).toBe('event_upcoming');
    expect(event.priority).toBe('low');
    expect(event.dedupKey).toBe('calendar:evt-2:upcoming');
  });

  it('does not re-alert same event', async () => {
    const startingHandler = vi.fn();
    const upcomingHandler = vi.fn();
    bus.on('event_starting', startingHandler);
    bus.on('event_upcoming', upcomingHandler);

    const now = new Date();
    const soonStart = new Date(now.getTime() + 5 * 60 * 1000);

    const mockData = {
      data: {
        items: [
          {
            id: 'evt-3',
            summary: 'Recurring',
            location: null,
            start: { dateTime: soonStart.toISOString() },
            end: { dateTime: new Date(soonStart.getTime() + 30 * 60 * 1000).toISOString() },
          },
        ],
      },
    };

    mockCalendarList.mockResolvedValueOnce(defaultCalendarListResponse);
    mockEventsList.mockResolvedValueOnce(mockData);
    await poller.poll();

    mockCalendarList.mockResolvedValueOnce(defaultCalendarListResponse);
    mockEventsList.mockResolvedValueOnce(mockData);
    await poller.poll();

    // event_starting emitted once (tracked by alertedEvents), dedup on bus may also catch
    expect(startingHandler).toHaveBeenCalledTimes(1);
  });

  it('skips past events', async () => {
    const handler = vi.fn();
    bus.on('event_starting', handler);
    bus.on('event_upcoming', handler);

    const now = new Date();
    const pastStart = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago

    mockCalendarList.mockResolvedValueOnce(defaultCalendarListResponse);
    mockEventsList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'evt-past',
            summary: 'Past Event',
            location: null,
            start: { dateTime: pastStart.toISOString() },
            end: { dateTime: new Date(pastStart.getTime() + 30 * 60 * 1000).toISOString() },
          },
        ],
      },
    });

    await poller.poll();

    expect(handler).not.toHaveBeenCalled();
  });

  it('handles empty events list', async () => {
    const handler = vi.fn();
    bus.on('event_starting', handler);

    mockCalendarList.mockResolvedValueOnce(defaultCalendarListResponse);
    mockEventsList.mockResolvedValueOnce({ data: { items: [] } });

    await poller.poll();

    expect(handler).not.toHaveBeenCalled();
  });

  it('handles API errors gracefully', async () => {
    mockCalendarList.mockRejectedValueOnce(new Error('Calendar API error'));

    await poller.poll();

    const status = poller.getStatus();
    expect(status.errorCount).toBe(1);
    expect(status.lastError).toBe('Calendar API error');
  });
});
