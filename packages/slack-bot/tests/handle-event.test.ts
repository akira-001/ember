import { describe, it, expect } from 'vitest';
import type { ProactiveEvent } from '../src/event-sources/types';
import { eventToCandidate } from '../src/event-to-candidate';

describe('eventToCandidate', () => {
  it('converts gmail event to candidate', () => {
    const event: ProactiveEvent = {
      id: '1', source: 'gmail', type: 'new_email',
      data: { from: 'boss@corp.com', subject: 'Q1 Review', snippet: 'Please review...' },
      timestamp: new Date().toISOString(), priority: 'high', dedupKey: 'gmail:123',
    };
    const candidate = eventToCandidate(event);
    expect(candidate.topic).toContain('Q1 Review');
    expect(candidate.source).toBe('gmail');
    expect(candidate.priorityBoost).toBeGreaterThan(0);
  });

  it('converts calendar event_starting to candidate', () => {
    const event: ProactiveEvent = {
      id: '2', source: 'calendar', type: 'event_starting',
      data: { summary: 'Team standup', startTime: new Date().toISOString() },
      timestamp: new Date().toISOString(), priority: 'high', dedupKey: 'cal:1:starting',
    };
    const candidate = eventToCandidate(event);
    expect(candidate.topic).toContain('Team standup');
    expect(candidate.source).toBe('calendar');
  });

  it('converts github pr_merged to candidate', () => {
    const event: ProactiveEvent = {
      id: '3', source: 'github', type: 'pr_merged',
      data: { title: 'Fix auth', repo: 'org/repo', number: 42 },
      timestamp: new Date().toISOString(), priority: 'high', dedupKey: 'gh:del1',
    };
    const candidate = eventToCandidate(event);
    expect(candidate.topic).toContain('Fix auth');
    expect(candidate.source).toBe('github');
  });

  it('converts rss event to candidate', () => {
    const event: ProactiveEvent = {
      id: '4', source: 'rss', type: 'new_article',
      data: { title: 'AI News', link: 'https://example.com' },
      timestamp: new Date().toISOString(), priority: 'medium', dedupKey: 'rss:url',
    };
    const candidate = eventToCandidate(event);
    expect(candidate.topic).toContain('AI News');
    expect(candidate.source).toBe('rss');
  });
});
