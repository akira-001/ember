import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../src/event-bus';
import type { EventSource, ProactiveEvent, EventSourceStatus } from '../src/event-sources/types';

// ---------------------------------------------------------------------------
// Helper: minimal mock EventSource
// ---------------------------------------------------------------------------

function createMockSource(
  name: string,
  overrides: Partial<Pick<EventSource, 'type' | 'enabled'>> = {},
): EventSource {
  const status: EventSourceStatus = {
    name,
    type: overrides.type ?? 'poller',
    enabled: overrides.enabled ?? true,
    running: false,
    lastFetchAt: null,
    lastEventAt: null,
    errorCount: 0,
    lastError: null,
  };
  return {
    name,
    type: overrides.type ?? 'poller',
    enabled: overrides.enabled ?? true,
    start: vi.fn(async () => { status.running = true; }),
    stop: vi.fn(async () => { status.running = false; }),
    getStatus: vi.fn(() => ({ ...status })),
  };
}

let eventCounter = 0;

function makeEvent(overrides: Partial<ProactiveEvent> = {}): ProactiveEvent {
  eventCounter += 1;
  return {
    id: `evt-${eventCounter}`,
    source: 'test',
    type: 'test-event',
    data: {},
    timestamp: new Date().toISOString(),
    priority: 'medium',
    dedupKey: `dedup-${eventCounter}`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    vi.useFakeTimers();
    eventCounter = 0;
    bus = new EventBus();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---- Source management ----

  describe('source management', () => {
    it('registers and retrieves a source by name', () => {
      const src = createMockSource('gmail');
      bus.registerSource(src);
      expect(bus.getSource('gmail')).toBe(src);
    });

    it('throws when registering a duplicate source name', () => {
      bus.registerSource(createMockSource('gmail'));
      expect(() => bus.registerSource(createMockSource('gmail'))).toThrow();
    });

    it('removes a source', () => {
      bus.registerSource(createMockSource('gmail'));
      bus.removeSource('gmail');
      expect(bus.getSource('gmail')).toBeUndefined();
    });

    it('returns undefined for unknown source', () => {
      expect(bus.getSource('nope')).toBeUndefined();
    });

    it('returns statuses for all registered sources', () => {
      bus.registerSource(createMockSource('gmail'));
      bus.registerSource(createMockSource('calendar'));
      const statuses = bus.getSourceStatuses();
      expect(Object.keys(statuses)).toEqual(['gmail', 'calendar']);
      expect(statuses['gmail'].name).toBe('gmail');
      expect(statuses['gmail'].type).toBe('poller');
    });
  });

  // ---- Event emission & subscription ----

  describe('emit / on', () => {
    it('delivers events to subscribers', () => {
      const handler = vi.fn();
      bus.on('test-event', handler);

      const evt = makeEvent();
      bus.emit(evt);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(evt);
    });

    it('delivers to wildcard (*) subscribers', () => {
      const handler = vi.fn();
      bus.on('*', handler);

      bus.emit(makeEvent({ type: 'a' }));
      bus.emit(makeEvent({ type: 'b' }));

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('does not deliver to unrelated type subscribers', () => {
      const handler = vi.fn();
      bus.on('other-type', handler);

      bus.emit(makeEvent({ type: 'test-event' }));

      expect(handler).not.toHaveBeenCalled();
    });

    it('unsubscribes via returned function', () => {
      const handler = vi.fn();
      const unsub = bus.on('test-event', handler);

      bus.emit(makeEvent());
      unsub();
      bus.emit(makeEvent());

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ---- Deduplication ----

  describe('deduplication', () => {
    it('suppresses duplicate events within the dedup window', () => {
      const handler = vi.fn();
      bus.on('test-event', handler);

      const evt1 = makeEvent({ dedupKey: 'same-key' });
      const evt2 = makeEvent({ dedupKey: 'same-key' });

      bus.emit(evt1);
      bus.emit(evt2);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('allows duplicate events after the dedup window expires', () => {
      const handler = vi.fn();
      bus.on('test-event', handler);

      bus.emit(makeEvent({ dedupKey: 'same-key' }));

      // Advance past 5-minute dedup window
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      bus.emit(makeEvent({ dedupKey: 'same-key' }));

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('allows events with different dedupKeys', () => {
      const handler = vi.fn();
      bus.on('test-event', handler);

      bus.emit(makeEvent({ dedupKey: 'key-a' }));
      bus.emit(makeEvent({ dedupKey: 'key-b' }));

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  // ---- startAll / stopAll ----

  describe('startAll / stopAll', () => {
    it('starts only enabled sources', async () => {
      const s1 = createMockSource('gmail', { enabled: true });
      const s2 = createMockSource('calendar', { enabled: true });
      bus.registerSource(s1);
      bus.registerSource(s2);

      await bus.startAll();

      expect(s1.start).toHaveBeenCalledTimes(1);
      expect(s2.start).toHaveBeenCalledTimes(1);
    });

    it('does NOT start disabled sources', async () => {
      const enabled = createMockSource('gmail', { enabled: true });
      const disabled = createMockSource('calendar', { enabled: false });
      bus.registerSource(enabled);
      bus.registerSource(disabled);

      await bus.startAll();

      expect(enabled.start).toHaveBeenCalledTimes(1);
      expect(disabled.start).not.toHaveBeenCalled();
    });

    it('stops all registered sources regardless of enabled', async () => {
      const s1 = createMockSource('gmail', { enabled: true });
      const s2 = createMockSource('calendar', { enabled: false });
      bus.registerSource(s1);
      bus.registerSource(s2);

      await bus.stopAll();

      expect(s1.stop).toHaveBeenCalledTimes(1);
      expect(s2.stop).toHaveBeenCalledTimes(1);
    });

    it('continues stopping remaining sources if one throws', async () => {
      const s1 = createMockSource('gmail');
      const s2 = createMockSource('calendar');
      (s1.stop as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
      bus.registerSource(s1);
      bus.registerSource(s2);

      // Should not throw
      await bus.stopAll();

      expect(s1.stop).toHaveBeenCalled();
      expect(s2.stop).toHaveBeenCalled();
    });
  });
});
