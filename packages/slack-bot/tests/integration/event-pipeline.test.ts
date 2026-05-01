import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../../src/event-bus';
import { CronAdapter } from '../../src/event-sources/cron-adapter';
import { eventToCandidate } from '../../src/event-to-candidate';
import { buildStagedMessages } from '../../src/staged-delivery';
import { DEFAULT_INTENTIONAL_PAUSE_CONFIG } from '../../src/event-sources/types';
import type { ProactiveEvent } from '../../src/event-sources/types';

describe('Event Pipeline Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('full flow: cron event → candidate → staged delivery', () => {
    const bus = new EventBus();
    const events: ProactiveEvent[] = [];
    bus.on('*', (e) => events.push(e)); // Use wildcard to catch all events

    // 1. CronAdapter emits event
    const adapter = new CronAdapter(bus);
    bus.registerSource(adapter);
    adapter.notifyJobExecuted('proactive-checkin-mei', 'mei', { status: 'success' });

    expect(events).toHaveLength(1);

    // 2. Event converts to candidate
    const candidate = eventToCandidate(events[0]);
    expect(candidate.source).toBe('cron');

    // 3. Staged delivery for heavy topic
    const enabledConfig = { ...DEFAULT_INTENTIONAL_PAUSE_CONFIG, enabled: true };
    const staged = buildStagedMessages('Important message', 'heavy', enabledConfig);
    expect(staged.premise).toBe('ねえ、少し大事な話なんだけど...');
    expect(staged.waitMs).toBe(5000);
  });

  it('dedup prevents duplicate events', () => {
    const bus = new EventBus();
    const events: ProactiveEvent[] = [];
    bus.on('*', (e) => events.push(e)); // Use wildcard to catch all events

    const event1: ProactiveEvent = {
      id: '1',
      source: 'gmail',
      type: 'new_email',
      data: {},
      timestamp: new Date().toISOString(),
      priority: 'high',
      dedupKey: 'gmail:same',
    };
    const event2: ProactiveEvent = {
      id: '2',
      source: 'gmail',
      type: 'new_email',
      data: {},
      timestamp: new Date().toISOString(),
      priority: 'high',
      dedupKey: 'gmail:same',
    };

    bus.emit(event1);
    bus.emit(event2);
    expect(events).toHaveLength(1);
  });

  it('gmail event → candidate with correct priority boost', () => {
    const event: ProactiveEvent = {
      id: '1',
      source: 'gmail',
      type: 'new_email',
      data: {
        from: 'ceo@company.com',
        subject: 'Urgent',
        snippet: 'Please review',
      },
      timestamp: new Date().toISOString(),
      priority: 'high',
      dedupKey: 'gmail:msg1',
    };
    const candidate = eventToCandidate(event);
    expect(candidate.topic).toContain('Urgent');
    expect(candidate.priorityBoost).toBe(0.3);
  });

  it('staged delivery disabled returns direct message', () => {
    const staged = buildStagedMessages('Hello', 'heavy', DEFAULT_INTENTIONAL_PAUSE_CONFIG);
    // Default config has enabled: false
    expect(staged.premise).toBeNull();
    expect(staged.waitMs).toBe(0);
    expect(staged.main).toBe('Hello');
  });

  it('calendar event → candidate with correct formatting', () => {
    const event: ProactiveEvent = {
      id: '1',
      source: 'calendar',
      type: 'event_starting',
      data: {
        summary: 'Weekly Sync',
        location: 'Zoom',
      },
      timestamp: new Date().toISOString(),
      priority: 'high',
      dedupKey: 'cal:event1',
    };
    const candidate = eventToCandidate(event);
    expect(candidate.topic).toContain('もうすぐ');
    expect(candidate.topic).toContain('Weekly Sync');
    expect(candidate.detail).toContain('Zoom');
    expect(candidate.source).toBe('calendar');
  });

  it('rss event → candidate with title and link', () => {
    const event: ProactiveEvent = {
      id: '1',
      source: 'rss',
      type: 'new_article',
      data: {
        title: 'New AI Breakthrough',
        link: 'https://example.com/article',
      },
      timestamp: new Date().toISOString(),
      priority: 'medium',
      dedupKey: 'rss:article1',
    };
    const candidate = eventToCandidate(event);
    expect(candidate.topic).toContain('ニュース');
    expect(candidate.topic).toContain('New AI Breakthrough');
    expect(candidate.detail).toContain('https://example.com/article');
    expect(candidate.priorityBoost).toBe(0.1);
  });

  it('github event → candidate with correct type label', () => {
    const event: ProactiveEvent = {
      id: '1',
      source: 'github',
      type: 'pr_merged',
      data: {
        title: 'Fix authentication',
        repo: 'claude-code-slack',
        url: 'https://github.com/anthropic/claude-code-slack/pull/123',
      },
      timestamp: new Date().toISOString(),
      priority: 'high',
      dedupKey: 'gh:pr1',
    };
    const candidate = eventToCandidate(event);
    expect(candidate.topic).toContain('PR マージ');
    expect(candidate.topic).toContain('Fix authentication');
    expect(candidate.detail).toContain('claude-code-slack');
    expect(candidate.priorityBoost).toBe(0.3);
  });

  it('priority boost reflects event priority correctly', () => {
    const eventHigh = eventToCandidate({
      id: '1',
      source: 'gmail',
      type: 'new_email',
      data: { subject: 'test' },
      timestamp: new Date().toISOString(),
      priority: 'high',
      dedupKey: 'gh:high',
    });
    expect(eventHigh.priorityBoost).toBe(0.3);

    const eventMedium = eventToCandidate({
      id: '2',
      source: 'gmail',
      type: 'new_email',
      data: { subject: 'test' },
      timestamp: new Date().toISOString(),
      priority: 'medium',
      dedupKey: 'gh:medium',
    });
    expect(eventMedium.priorityBoost).toBe(0.1);

    const eventLow = eventToCandidate({
      id: '3',
      source: 'gmail',
      type: 'new_email',
      data: { subject: 'test' },
      timestamp: new Date().toISOString(),
      priority: 'low',
      dedupKey: 'gh:low',
    });
    expect(eventLow.priorityBoost).toBe(0);
  });

  it('staged delivery wait times match configuration', () => {
    const config = {
      enabled: true,
      premiseTexts: { light: 'ちょっと...', medium: 'ちょっと思ったんだけど...', heavy: 'ねえ、少し大事な話なんだけど...' },
      waitSeconds: { light: 1, medium: 3, heavy: 5 },
    };

    const lightStaged = buildStagedMessages('Light', 'light', config);
    expect(lightStaged.waitMs).toBe(1000); // 1 second
    expect(lightStaged.premise).toBe('ちょっと...');

    const mediumStaged = buildStagedMessages('Medium', 'medium', config);
    expect(mediumStaged.waitMs).toBe(3000); // 3 seconds
    expect(mediumStaged.premise).toBe('ちょっと思ったんだけど...');

    const heavyStaged = buildStagedMessages('Heavy', 'heavy', config);
    expect(heavyStaged.waitMs).toBe(5000); // 5 seconds
    expect(heavyStaged.premise).toBe('ねえ、少し大事な話なんだけど...');
  });

  it('event bus delivers to wildcard subscribers', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('*', handler);

    const event: ProactiveEvent = {
      id: '1',
      source: 'gmail',
      type: 'new_email',
      data: {},
      timestamp: new Date().toISOString(),
      priority: 'low',
      dedupKey: 'gmail:test',
    };

    bus.emit(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('cron adapter sets lastEventAt when emitting', () => {
    const bus = new EventBus();
    const adapter = new CronAdapter(bus);
    bus.registerSource(adapter);

    const beforeStatus = adapter.getStatus();
    expect(beforeStatus.lastEventAt).toBeNull();

    adapter.notifyJobExecuted('test-job', 'bot1', { status: 'success' });

    const afterStatus = adapter.getStatus();
    expect(afterStatus.lastEventAt).not.toBeNull();
  });

  it('unknown event source defaults to generic formatting', () => {
    const event: ProactiveEvent = {
      id: '1',
      source: 'unknown-source',
      type: 'some-event',
      data: { foo: 'bar', nested: { value: 123 } },
      timestamp: new Date().toISOString(),
      priority: 'medium',
      dedupKey: 'unknown:event1',
    };
    const candidate = eventToCandidate(event);
    expect(candidate.topic).toContain('unknown-source');
    expect(candidate.topic).toContain('some-event');
    expect(candidate.source).toBe('unknown-source');
    expect(candidate.priorityBoost).toBe(0.1);
  });

  it('full integration: multiple sources emit via bus', () => {
    const bus = new EventBus();
    const allEvents: ProactiveEvent[] = [];
    const cronEvents: ProactiveEvent[] = [];

    bus.on('*', (e) => allEvents.push(e));
    bus.on('scheduled', (e) => cronEvents.push(e));

    const cronAdapter = new CronAdapter(bus);
    bus.registerSource(cronAdapter);

    cronAdapter.notifyJobExecuted('job1', 'bot1', { status: 'success' });
    cronAdapter.notifyJobExecuted('job2', 'bot1', { status: 'failed' });

    expect(allEvents).toHaveLength(2);
    expect(cronEvents).toHaveLength(2);
    expect(allEvents[0].source).toBe('cron');
    expect(allEvents[1].source).toBe('cron');
  });
});
