import { describe, it, expect, vi } from 'vitest';
import { CronAdapter } from '../src/event-sources/cron-adapter';
import { EventBus } from '../src/event-bus';

describe('CronAdapter', () => {
  it('emits proactive-event when notified of job execution', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('scheduled', handler);

    const adapter = new CronAdapter(bus);
    adapter.notifyJobExecuted('proactive-checkin-mei', 'mei', { status: 'success' });

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.source).toBe('cron');
    expect(event.type).toBe('scheduled');
    expect(event.data.jobName).toBe('proactive-checkin-mei');
  });

  it('has correct source status', () => {
    const bus = new EventBus();
    const adapter = new CronAdapter(bus);
    const status = adapter.getStatus();
    expect(status.name).toBe('cron');
    expect(status.type).toBe('poller');
    expect(status.enabled).toBe(true);
  });
});
