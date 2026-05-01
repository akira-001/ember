/**
 * Event-driven proactive messaging system — core types.
 *
 * Every event source (Gmail, Calendar, RSS, GitHub, Cron) emits
 * ProactiveEvent objects through the EventBus. ProactiveAgent
 * subscribes and decides how to handle them.
 */

// ---------------------------------------------------------------------------
// EventSource status
// ---------------------------------------------------------------------------

export interface EventSourceStatus {
  name: string;
  type: 'poller' | 'webhook';
  enabled: boolean;
  running: boolean;
  lastFetchAt: string | null;
  lastEventAt: string | null;
  errorCount: number;
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// EventSource interface — implemented by each poller / adapter
// ---------------------------------------------------------------------------

export interface EventSource {
  name: string;
  type: 'poller' | 'webhook';
  enabled: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): EventSourceStatus;
}

// ---------------------------------------------------------------------------
// ProactiveEvent — the unit of work flowing through the EventBus
// ---------------------------------------------------------------------------

export interface ProactiveEvent {
  id: string;
  source: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
  priority: 'low' | 'medium' | 'high';
  dedupKey: string;
}

// ---------------------------------------------------------------------------
// EventSource configuration (per-source structure)
// ---------------------------------------------------------------------------

export interface EventSourceConfig {
  gmail: { enabled: boolean; intervalMinutes: number; query: string };
  calendar: { enabled: boolean; intervalMinutes: number; alertBeforeMinutes: number; excludeCalendars: string[] };
  rss: { enabled: boolean; intervalMinutes: number };
  github: { enabled: boolean; webhookSecret: string };
}

export const DEFAULT_EVENT_SOURCE_CONFIG: EventSourceConfig = {
  gmail: { enabled: false, intervalMinutes: 5, query: 'is:unread is:important' },
  calendar: { enabled: false, intervalMinutes: 15, alertBeforeMinutes: 10, excludeCalendars: [] },
  rss: { enabled: false, intervalMinutes: 30 },
  github: { enabled: false, webhookSecret: '' },
};

// ---------------------------------------------------------------------------
// Intentional pause configuration
// ---------------------------------------------------------------------------

export interface IntentionalPauseConfig {
  enabled: boolean;
  premiseTexts: { light: string | null; medium: string | null; heavy: string | null };
  waitSeconds: { light: number; medium: number; heavy: number };
}

export const DEFAULT_INTENTIONAL_PAUSE_CONFIG: IntentionalPauseConfig = {
  enabled: false,
  premiseTexts: { light: null, medium: 'ちょっと思ったんだけど...', heavy: 'ねえ、少し大事な話なんだけど...' },
  waitSeconds: { light: 1, medium: 3, heavy: 5 },
};
