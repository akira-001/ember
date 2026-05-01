import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../src/event-bus';

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);

import { RssPoller } from '../src/event-sources/rss-poller';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Test Feed</title>
  <item>
    <title>Article One</title>
    <link>https://example.com/article-1</link>
    <description>First article description</description>
  </item>
  <item>
    <title>Article Two</title>
    <link>https://example.com/article-2</link>
    <description>Second article description</description>
  </item>
</channel>
</rss>`;

describe('RssPoller', () => {
  let bus: EventBus;
  let poller: RssPoller;

  beforeEach(() => {
    vi.clearAllMocks();
    bus = new EventBus();
    poller = new RssPoller(bus, { enabled: true, intervalMinutes: 30 }, ['TypeScript', 'AI']);
  });

  it('has correct source metadata', () => {
    const status = poller.getStatus();
    expect(status.name).toBe('rss');
    expect(status.type).toBe('poller');
    expect(status.enabled).toBe(true);
  });

  it('emits new_article events from RSS feed', async () => {
    const handler = vi.fn();
    bus.on('new_article', handler);

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_RSS),
    });

    // Use single-interest poller so we get exactly 2 articles
    const singlePoller = new RssPoller(bus, { enabled: true, intervalMinutes: 30 }, ['TypeScript']);
    await singlePoller.poll();

    expect(handler).toHaveBeenCalledTimes(2);

    const event = handler.mock.calls[0][0];
    expect(event.source).toBe('rss');
    expect(event.type).toBe('new_article');
    expect(event.priority).toBe('medium');
    expect(event.data.title).toBe('Article One');
    expect(event.data.link).toBe('https://example.com/article-1');
    expect(event.dedupKey).toBe('rss:https://example.com/article-1');
  });

  it('does not emit duplicate articles on second poll', async () => {
    const handler = vi.fn();
    bus.on('new_article', handler);

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_RSS),
    });

    await poller.poll();
    const firstCount = handler.mock.calls.length;

    await poller.poll();

    // Second poll should not add new events (seenUrls tracking)
    expect(handler).toHaveBeenCalledTimes(firstCount);
  });

  it('limits to top 5 items per interest', async () => {
    const handler = vi.fn();
    bus.on('new_article', handler);

    let items = '';
    for (let i = 0; i < 10; i++) {
      items += `<item><title>Art ${i}</title><link>https://example.com/a-${i}</link><description>Desc</description></item>`;
    }
    const bigRss = `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(bigRss),
    });

    // Use single interest to simplify count
    const singlePoller = new RssPoller(bus, { enabled: true, intervalMinutes: 30 }, ['test']);
    await singlePoller.poll();

    expect(handler).toHaveBeenCalledTimes(5);
  });

  it('includes interest in event data', async () => {
    const handler = vi.fn();
    bus.on('new_article', handler);

    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_RSS),
    });

    const singlePoller = new RssPoller(bus, { enabled: true, intervalMinutes: 30 }, ['AI']);
    await singlePoller.poll();

    const event = handler.mock.calls[0][0];
    expect(event.data.interest).toBe('AI');
  });

  it('handles fetch errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    await poller.poll(); // Should not throw

    const status = poller.getStatus();
    expect(status.errorCount).toBe(1);
    expect(status.lastError).toBe('Network error');
  });

  it('handles non-ok responses gracefully', async () => {
    const handler = vi.fn();
    bus.on('new_article', handler);

    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve(''),
    });

    await poller.poll();

    expect(handler).not.toHaveBeenCalled();
  });
});
