import { randomUUID } from 'crypto';
import { google } from 'googleapis';
import { Logger } from '../logger';
import type { EventBus } from '../event-bus';
import type { EventSource, EventSourceConfig, EventSourceStatus, ProactiveEvent } from './types';

export class GmailPoller implements EventSource {
  name = 'gmail';
  type = 'poller' as const;
  enabled: boolean;

  private bus: EventBus;
  private config: EventSourceConfig['gmail'];
  private logger = new Logger('GmailPoller');
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSeenId: string | null = null;
  private seenIds = new Set<string>();
  private lastFetchAt: string | null = null;
  private lastEventAt: string | null = null;
  private errorCount = 0;
  private lastError: string | null = null;
  private gmail;

  constructor(bus: EventBus, config: EventSourceConfig['gmail']) {
    this.bus = bus;
    this.config = config;
    this.enabled = config.enabled;

    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    this.gmail = google.gmail({ version: 'v1', auth });
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.logger.info(`Starting Gmail poller (interval: ${this.config.intervalMinutes}m, query: "${this.config.query}")`);
    await this.poll();
    this.timer = setInterval(() => this.poll(), this.config.intervalMinutes * 60 * 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info('Stopped Gmail poller');
  }

  async poll(): Promise<void> {
    try {
      const res = await this.gmail.users.messages.list({
        userId: 'me',
        q: this.config.query,
        maxResults: 10,
      });

      this.lastFetchAt = new Date().toISOString();
      const messages = res.data.messages;
      if (!messages || messages.length === 0) return;

      for (const msg of messages) {
        const messageId = msg.id!;
        if (this.seenIds.has(messageId)) continue;

        const detail = await this.gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject'],
        });

        const headers = detail.data.payload?.headers ?? [];
        const from = headers.find((h: any) => h.name === 'From')?.value ?? 'unknown';
        const subject = headers.find((h: any) => h.name === 'Subject')?.value ?? '(no subject)';
        const snippet = detail.data.snippet ?? '';
        const labelIds = detail.data.labelIds ?? [];
        const isImportant = labelIds.includes('IMPORTANT');

        const event: ProactiveEvent = {
          id: randomUUID(),
          source: 'gmail',
          type: 'new_email',
          data: { messageId, from, subject, snippet },
          timestamp: new Date().toISOString(),
          priority: isImportant ? 'high' : 'medium',
          dedupKey: `gmail:${messageId}`,
        };

        this.seenIds.add(messageId);
        this.lastEventAt = event.timestamp;
        this.bus.emit(event);
      }

      // Keep seenIds bounded
      if (this.seenIds.size > 500) {
        const arr = Array.from(this.seenIds);
        this.seenIds = new Set(arr.slice(arr.length - 200));
      }

      this.errorCount = 0;
      this.lastError = null;
    } catch (err) {
      this.errorCount++;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.logger.error('Gmail poll failed', err);
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
