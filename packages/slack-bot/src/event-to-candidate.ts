import type { ProactiveEvent } from './event-sources/types';

export interface EventCandidate {
  topic: string;
  source: string;
  detail: string;
  priorityBoost: number;
}

const PRIORITY_BOOST: Record<string, number> = { high: 0.3, medium: 0.1, low: 0 };

export function eventToCandidate(event: ProactiveEvent): EventCandidate {
  const boost = PRIORITY_BOOST[event.priority] || 0;

  switch (event.source) {
    case 'gmail':
      return {
        topic: `メール: ${event.data.subject}（${event.data.from}）`,
        source: 'gmail',
        detail: String(event.data.snippet || ''),
        priorityBoost: boost,
      };
    case 'calendar': {
      const prefix = event.type === 'event_starting' ? 'もうすぐ' : '今日の予定';
      return {
        topic: `${prefix}: ${event.data.summary}`,
        source: 'calendar',
        detail: event.data.location ? `場所: ${event.data.location}` : '',
        priorityBoost: boost,
      };
    }
    case 'rss':
      return {
        topic: `ニュース: ${event.data.title}`,
        source: 'rss',
        detail: String(event.data.link || ''),
        priorityBoost: boost,
      };
    case 'github': {
      const typeLabel = event.type === 'pr_merged' ? 'PR マージ' : event.type === 'push' ? 'Push' : 'Issue';
      return {
        topic: `GitHub ${typeLabel}: ${event.data.title || event.data.ref || ''}`,
        source: 'github',
        detail: `${event.data.repo || ''} ${event.data.url || ''}`,
        priorityBoost: boost,
      };
    }
    default:
      return {
        topic: `${event.source}: ${event.type}`,
        source: event.source,
        detail: JSON.stringify(event.data).substring(0, 200),
        priorityBoost: boost,
      };
  }
}
