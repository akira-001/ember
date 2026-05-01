import { randomUUID } from 'crypto';
import { Logger } from '../logger';
import type { EventBus } from '../event-bus';
import type { EventSource, EventSourceConfig, EventSourceStatus, ProactiveEvent } from './types';

interface RssItem {
  title: string;
  link: string;
  description: string;
}

export class RssPoller implements EventSource {
  name = 'rss';
  type = 'poller' as const;
  enabled: boolean;

  private bus: EventBus;
  private config: EventSourceConfig['rss'];
  private interests: string[];
  private logger = new Logger('RssPoller');
  private timer: ReturnType<typeof setInterval> | null = null;
  private seenUrls = new Set<string>();
  private lastFetchAt: string | null = null;
  private lastEventAt: string | null = null;
  private errorCount = 0;
  private lastError: string | null = null;

  constructor(bus: EventBus, config: EventSourceConfig['rss'], interests: string[]) {
    this.bus = bus;
    this.config = config;
    this.interests = interests;
    this.enabled = config.enabled;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.logger.info(`Starting RSS poller (interval: ${this.config.intervalMinutes}m, interests: ${this.interests.join(', ')})`);
    await this.poll();
    this.timer = setInterval(() => this.poll(), this.config.intervalMinutes * 60 * 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info('Stopped RSS poller');
  }

  async poll(): Promise<void> {
    try {
      for (const interest of this.interests) {
        await this.pollInterest(interest);
      }
      this.lastFetchAt = new Date().toISOString();
      this.errorCount = 0;
      this.lastError = null;
    } catch (err) {
      this.errorCount++;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.logger.error('RSS poll failed', err);
    }
  }

  private async pollInterest(interest: string): Promise<void> {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(interest)}&hl=ja&gl=JP&ceid=JP:ja`;
    const res = await fetch(url);
    if (!res.ok) {
      this.logger.warn(`RSS fetch failed for "${interest}": HTTP ${res.status}`);
      return;
    }

    const xml = await res.text();
    const items = this.parseItems(xml);
    const top5 = items.slice(0, 5);

    for (const item of top5) {
      if (this.seenUrls.has(item.link)) continue;
      this.seenUrls.add(item.link);

      const event: ProactiveEvent = {
        id: randomUUID(),
        source: 'rss',
        type: 'new_article',
        data: {
          title: item.title,
          link: item.link,
          description: item.description,
          interest,
        },
        timestamp: new Date().toISOString(),
        priority: 'medium',
        dedupKey: `rss:${item.link}`,
      };

      this.lastEventAt = event.timestamp;
      this.bus.emit(event);
    }

    // Keep seenUrls bounded
    if (this.seenUrls.size > 1000) {
      const arr = Array.from(this.seenUrls);
      this.seenUrls = new Set(arr.slice(arr.length - 500));
    }
  }

  private parseItems(xml: string): RssItem[] {
    const items: RssItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const title = this.extractTag(block, 'title');
      const link = this.extractTag(block, 'link');
      const description = this.extractTag(block, 'description');
      if (title && link) {
        items.push({ title, link, description: description ?? '' });
      }
    }

    return items;
  }

  private extractTag(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}>([\\s\\S]*?)</${tag}>`);
    const m = regex.exec(xml);
    if (!m) return null;
    return m[1] ?? m[2] ?? null;
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
