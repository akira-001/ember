import { randomUUID } from 'crypto';
import type { EventSource, EventSourceStatus, ProactiveEvent } from './types';
import type { EventBus } from '../event-bus';

export class CronAdapter implements EventSource {
  name = 'cron';
  type = 'poller' as const;
  enabled = true;

  private bus: EventBus;
  private lastEventAt: string | null = null;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  notifyJobExecuted(jobName: string, botId: string, result: Record<string, unknown>): void {
    const event: ProactiveEvent = {
      id: randomUUID(),
      source: 'cron',
      type: 'scheduled',
      data: { jobName, botId, ...result },
      timestamp: new Date().toISOString(),
      priority: 'medium',
      dedupKey: `cron:${jobName}:${Date.now()}`,
    };
    this.lastEventAt = event.timestamp;
    this.bus.emit(event);
  }

  async start(): Promise<void> {
    /* No-op — cron managed by Scheduler */
  }

  async stop(): Promise<void> {
    /* No-op */
  }

  getStatus(): EventSourceStatus {
    return {
      name: this.name,
      type: this.type,
      enabled: this.enabled,
      running: true,
      lastFetchAt: null,
      lastEventAt: this.lastEventAt,
      errorCount: 0,
      lastError: null,
    };
  }
}
