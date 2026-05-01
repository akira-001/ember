import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../src/event-bus';

const { mockList, mockGet } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock('googleapis', () => {
  function MockOAuth2() {
    // @ts-ignore
    this.setCredentials = vi.fn();
  }
  return {
    google: {
      auth: { OAuth2: MockOAuth2 },
      gmail: vi.fn().mockReturnValue({
        users: {
          messages: {
            list: mockList,
            get: mockGet,
          },
        },
      }),
    },
  };
});

import { GmailPoller } from '../src/event-sources/gmail-poller';

describe('GmailPoller', () => {
  let bus: EventBus;
  let poller: GmailPoller;

  beforeEach(() => {
    vi.clearAllMocks();
    bus = new EventBus();
    poller = new GmailPoller(bus, {
      enabled: true,
      intervalMinutes: 5,
      query: 'is:unread',
    });
  });

  it('has correct source metadata', () => {
    const status = poller.getStatus();
    expect(status.name).toBe('gmail');
    expect(status.type).toBe('poller');
    expect(status.enabled).toBe(true);
  });

  it('emits new_email event for new messages', async () => {
    const handler = vi.fn();
    bus.on('new_email', handler);

    mockList.mockResolvedValueOnce({
      data: {
        messages: [{ id: 'msg-1', threadId: 'thread-1' }],
      },
    });

    mockGet.mockResolvedValueOnce({
      data: {
        id: 'msg-1',
        labelIds: ['INBOX'],
        payload: {
          headers: [
            { name: 'From', value: 'alice@example.com' },
            { name: 'Subject', value: 'Hello World' },
          ],
        },
        snippet: 'This is a test email',
      },
    });

    await poller.poll();

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.source).toBe('gmail');
    expect(event.type).toBe('new_email');
    expect(event.data.messageId).toBe('msg-1');
    expect(event.data.from).toBe('alice@example.com');
    expect(event.data.subject).toBe('Hello World');
    expect(event.data.snippet).toBe('This is a test email');
    expect(event.priority).toBe('medium');
    expect(event.dedupKey).toBe('gmail:msg-1');
  });

  it('sets high priority for IMPORTANT labeled messages', async () => {
    const handler = vi.fn();
    bus.on('new_email', handler);

    mockList.mockResolvedValueOnce({
      data: {
        messages: [{ id: 'msg-2', threadId: 'thread-2' }],
      },
    });

    mockGet.mockResolvedValueOnce({
      data: {
        id: 'msg-2',
        labelIds: ['INBOX', 'IMPORTANT'],
        payload: {
          headers: [
            { name: 'From', value: 'boss@example.com' },
            { name: 'Subject', value: 'Urgent' },
          ],
        },
        snippet: 'Important message',
      },
    });

    await poller.poll();

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.priority).toBe('high');
  });

  it('does not emit duplicate events for already seen messages', async () => {
    const handler = vi.fn();
    bus.on('new_email', handler);

    // First poll
    mockList.mockResolvedValueOnce({
      data: { messages: [{ id: 'msg-3', threadId: 'thread-3' }] },
    });
    mockGet.mockResolvedValueOnce({
      data: {
        id: 'msg-3',
        labelIds: ['INBOX'],
        payload: { headers: [{ name: 'From', value: 'a@b.com' }, { name: 'Subject', value: 'Hi' }] },
        snippet: 'test',
      },
    });
    await poller.poll();

    // Second poll with same message
    mockList.mockResolvedValueOnce({
      data: { messages: [{ id: 'msg-3', threadId: 'thread-3' }] },
    });
    await poller.poll();

    // Should only have been called once (dedup by seenIds tracking)
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('handles empty message list gracefully', async () => {
    const handler = vi.fn();
    bus.on('new_email', handler);

    mockList.mockResolvedValueOnce({ data: { messages: null } });

    await poller.poll();

    expect(handler).not.toHaveBeenCalled();
  });

  it('handles API errors gracefully', async () => {
    mockList.mockRejectedValueOnce(new Error('API error'));

    await poller.poll(); // Should not throw

    const status = poller.getStatus();
    expect(status.errorCount).toBe(1);
    expect(status.lastError).toBe('API error');
  });
});
