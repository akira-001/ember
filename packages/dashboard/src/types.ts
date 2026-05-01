export type SuggestionCategory =
  | 'email_reply'
  | 'meeting_prep'
  | 'deadline_risk'
  | 'slack_followup'
  | 'energy_break'
  | 'personal_event'
  | 'hobby_leisure'
  | 'flashback';

export interface SuggestionHistoryEntry {
  id: string;
  category: SuggestionCategory;
  sentAt: string;
  slackTs: string;
  slackChannel: string;
  reaction: string | null;
  reactionDelta: number;
}

export interface CooldownState {
  until: string | null;
  consecutiveIgnores: number;
  backoffMinutes: number;
}

export interface ProactiveState {
  categoryWeights: Record<SuggestionCategory, number>;
  cooldown: CooldownState;
  history: SuggestionHistoryEntry[];
  lastCheckAt: string | null;
  stats: {
    totalSent: number;
    positiveReactions: number;
    negativeReactions: number;
  };
}

export interface UserInsight {
  insight: string;
  learnedAt: string;
  source: string;
  arousal: number;
  reinforceCount: number;
}

export interface Constants {
  LEARNING_RATE: number;
  WEIGHT_MIN: number;
  WEIGHT_MAX: number;
  MAX_HISTORY: number;
  MAX_BACKOFF_MINUTES: number;
  INSIGHT_BASE_HALF_LIFE: number;
  INSIGHT_DECAY_FLOOR: number;
  INSIGHT_DEFAULT_AROUSAL: number;
  INSIGHT_REINFORCE_DELTA: number;
  INSIGHT_ACTIVE_THRESHOLD: number;
  INSIGHT_SIMILARITY_THRESHOLD: number;
}

export const CATEGORY_LABELS: Record<SuggestionCategory, string> = {
  email_reply: 'メール返信',
  meeting_prep: '会議準備',
  deadline_risk: '締切リスク',
  slack_followup: 'Slackフォロー',
  energy_break: '休憩提案',
  personal_event: '個人イベント',
  hobby_leisure: '趣味・レジャー',
  flashback: '雑談・思い出',
};

export const CATEGORY_COLORS: Record<SuggestionCategory, string> = {
  email_reply: '#5070a0',
  meeting_prep: '#6a5a9a',
  deadline_risk: '#984030',
  slack_followup: '#C06830',
  energy_break: '#4a8a4a',
  personal_event: '#8a6a20',
  hobby_leisure: '#8a4a6a',
  flashback: '#6a5a9a',
};

export const CHART_COLORS = {
  primary: '#C06830',
  secondary: '#8a6a20',
  tertiary: '#5070a0',
  grid: '#d4c8b8',
  axis: '#705848',
  tooltip: {
    bg: '#ede4d8',
    border: '#d4c8b8',
    text: '#3a2e28',
  },
};

// --- Bot Config Types ---

export type PersonalityType =
  | 'cautious' | 'optimist' | 'analyst' | 'intuitive' | 'doer'
  | 'critic' | 'empath' | 'innovator' | 'mediator' | 'strategist';

export type BackgroundMotif =
  | 'steve_jobs' | 'jeff_bezos' | 'peter_thiel' | 'charlie_munger'
  | 'elon_musk' | 'ray_dalio' | 'warren_buffett' | 'andy_grove'
  | 'zhuge_liang' | 'jensen_huang';

export interface BotConfigJson {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  slack: { botToken: string; appToken: string; signingSecret: string };
  personality: {
    type: PersonalityType | string;
    motif: BackgroundMotif | string;
    customPrompt: string | null;
    generatedPrompt: string | null;
  };
  models: { chat: string; cron: string };
  proactive: {
    enabled: boolean;
    schedule: string;
    slackTarget: string;
    calendarExclusions: string[];
  };
  rateLimits: {
    messagesPerMinute: number;
    botToBotMaxTurns: number;
    dailyLimit: number;
    cooldownMs: number;
  };
  tokenBudget: { hourlyUsd: number; dailyUsd: number };
  constants: Constants;
  mcpServers: string[];
  cronJobs: string[];
  stampCompetition: { enabled: boolean };
  cogmem: { enabled: boolean; tokenBudget: number; recentLogs: number };
  debug: boolean;
  statePath: string;
  insightsPath: string;
}

export interface PersonalityTemplate {
  id: string;
  label: string;
  labelEn: string;
  thinkingStyle: string;
  debateStyle: string;
}

export interface BackgroundMotifTemplate {
  id: string;
  label: string;
  labelJa: string;
  tag: string;
  background: string;
  perspective: string;
  keyPhrases: string[];
}

export interface PersonalityTemplates {
  types: PersonalityTemplate[];
  motifs: BackgroundMotifTemplate[];
  promptTemplate: string;
}

export interface CronJob {
  name: string;
  summary?: string;
  description?: string;
  cron: string;
  tz: string;
  message: string;
  slackTarget: string;
  timeoutSeconds: number;
  enabled: boolean;
  botId: string;
  command?: string;
  outputExample?: string;
  silentMode?: boolean;
}

// === Profile Types ===
export interface ProfileFieldMeta {
  value: any;
  confidence: 'high' | 'medium' | 'low' | 'hypothesis' | null;
  source: 'conversation' | 'observation' | 'manual' | 'inferred' | null;
  evidence: string | null;
  collectedAt: string | null;
  example: string | null;
}

export interface ProfileLayer {
  completionRate: number;
  fields: Record<string, ProfileFieldMeta>;
}

export interface CollectionConfig {
  layerWeights: Record<string, number>;
  actionReward: number;
  frequencyDays: number;
  choiceCount: number;
}

export interface UserProfile {
  version: number;
  lastUpdated: string;
  layers: {
    identity: ProfileLayer;
    vision: ProfileLayer;
    strategy: ProfileLayer;
    execution: ProfileLayer;
    state: ProfileLayer;
  };
  collectionConfig: CollectionConfig;
}
