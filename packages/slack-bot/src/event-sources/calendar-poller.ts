import { randomUUID } from 'crypto';
import { google } from 'googleapis';
import { Logger } from '../logger';
import type { EventBus } from '../event-bus';
import type { EventSource, EventSourceConfig, EventSourceStatus, ProactiveEvent } from './types';

export class CalendarPoller implements EventSource {
  name = 'calendar';
  type = 'poller' as const;
  enabled: boolean;

  private bus: EventBus;
  private config: EventSourceConfig['calendar'];
  private logger = new Logger('CalendarPoller');
  private timer: ReturnType<typeof setInterval> | null = null;
  private alertedEvents = new Set<string>();
  private lastFetchAt: string | null = null;
  private lastEventAt: string | null = null;
  private errorCount = 0;
  private lastError: string | null = null;
  private calendar;

  constructor(bus: EventBus, config: EventSourceConfig['calendar']) {
    this.bus = bus;
    this.config = config;
    this.enabled = config.enabled;

    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    this.calendar = google.calendar({ version: 'v3', auth });
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.logger.info(`Starting Calendar poller (interval: ${this.config.intervalMinutes}m, alert: ${this.config.alertBeforeMinutes}m)`);
    await this.poll();
    this.timer = setInterval(() => this.poll(), this.config.intervalMinutes * 60 * 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info('Stopped Calendar poller');
  }

  async poll(): Promise<void> {
    try {
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      // Fetch calendar list and filter out excluded ones
      const calListRes = await this.calendar.calendarList.list();
      const allCalendars = calListRes.data.items ?? [];
      const excludeSet = new Set((this.config.excludeCalendars ?? []).map((s: string) => s.toLowerCase()));
      const calendars = allCalendars.filter((c: any) => !excludeSet.has((c.id ?? '').toLowerCase()));

      if (calendars.length === 0) {
        this.lastFetchAt = new Date().toISOString();
        return;
      }

      // Query events from all non-excluded calendars
      const allItems: any[] = [];
      for (const cal of calendars) {
        const calId = cal.id ?? '';
        if (!calId) continue;
        try {
          const res = await this.calendar.events.list({
            calendarId: calId,
            timeMin: startOfDay.toISOString(),
            timeMax: endOfDay.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
          });
          if (res.data.items) allItems.push(...res.data.items);
        } catch (err) {
          this.logger.warn(`Calendar poll skipped for ${calId}: ${err instanceof Error ? err.message : err}`);
        }
      }

      this.lastFetchAt = new Date().toISOString();
      const items = allItems;
      if (items.length === 0) return;

      const alertThreshold = this.config.alertBeforeMinutes * 60 * 1000;

      for (const item of items) {
        const eventId = item.id!;
        const startTime = item.start?.dateTime;
        if (!startTime) continue;

        const startDate = new Date(startTime);
        const msUntilStart = startDate.getTime() - now.getTime();

        // Skip past events
        if (msUntilStart < 0) continue;

        const data = {
          eventId,
          summary: item.summary ?? '(no title)',
          location: item.location ?? null,
          startTime,
        };

        if (msUntilStart <= alertThreshold) {
          const dedupKey = `calendar:${eventId}:starting`;
          if (this.alertedEvents.has(dedupKey)) continue;
          this.alertedEvents.add(dedupKey);

          const event: ProactiveEvent = {
            id: randomUUID(),
            source: 'calendar',
            type: 'event_starting',
            data,
            timestamp: new Date().toISOString(),
            priority: 'high',
            dedupKey,
          };
          this.lastEventAt = event.timestamp;
          this.bus.emit(event);
        } else {
          const dedupKey = `calendar:${eventId}:upcoming`;
          if (this.alertedEvents.has(dedupKey)) continue;
          this.alertedEvents.add(dedupKey);

          const event: ProactiveEvent = {
            id: randomUUID(),
            source: 'calendar',
            type: 'event_upcoming',
            data,
            timestamp: new Date().toISOString(),
            priority: 'low',
            dedupKey,
          };
          this.lastEventAt = event.timestamp;
          this.bus.emit(event);
        }
      }

      // Prune old alerted events (keep bounded)
      if (this.alertedEvents.size > 200) {
        const arr = Array.from(this.alertedEvents);
        this.alertedEvents = new Set(arr.slice(arr.length - 100));
      }

      this.errorCount = 0;
      this.lastError = null;
    } catch (err) {
      this.errorCount++;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.logger.error('Calendar poll failed', err);
    }
  }

  getStatus(): EventSourceStatus {
    return {
      name: this.name,
      type: this.type,
      enabled: this.enabled,
      running: this.timer !== null,
      lastFetchAt: this.lastFetchAt,
      lastEventAt: this.lastEventAt,
      errorCount: this.errorCount,
      lastError: this.lastError,
    };
  }
}
