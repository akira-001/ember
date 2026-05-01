import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { classifyProactiveTheme, type ThemeInput } from './proactive-themes';

export interface ThemeInventoryPolicyEntry {
  baseTarget: number;
  minTarget: number;
  maxTarget: number;
  freshnessDays: number;
}

export interface ThemeInventoryPolicy {
  default: ThemeInventoryPolicyEntry;
  roots: Record<string, ThemeInventoryPolicyEntry>;
}

export interface ThemeInventoryRecord {
  themeKey: string;
  themePath: string[];
  rootKey: string;
  availableCount: number;
  sentFreshCount: number;
  sent30dCount: number;
  positive30dCount: number;
  negative30dCount: number;
  positiveRate30d: number;
  uniqueSources30d: number;
  targetCount: number;
  supplyGap: number;
  rotationGap: number;
  freshnessDays: number;
  freshnessScore: number;
  lastSentAt: string | null;
}

export interface ThemeInventorySnapshot {
  updatedAt: string;
  records: ThemeInventoryRecord[];
}

export interface ThemeInventoryObservation {
  sentAt?: string;
  topic?: string;
  preview?: string;
  source?: string;
  category?: string;
  interestCategory?: string;
  sourceType?: string;
  reaction?: string | null;
  reactionDelta?: number;
  themePath?: string[];
  themeKey?: string;
}

export interface ThemeInventoryBuildInput {
  history?: ThemeInventoryObservation[];
  sharedMessages?: ThemeInventoryObservation[];
  candidatePool?: Array<{
    topic: string;
    source: string;
    category: string;
    metadata?: Record<string, unknown>;
  }>;
  now?: Date;
  policy?: ThemeInventoryPolicy;
}

const INVENTORY_FILE = join(process.cwd(), 'data', 'theme-inventory.json');
const POLICY_FILE = join(process.cwd(), 'data', 'theme-inventory-policy.json');

const DEFAULT_POLICY: ThemeInventoryPolicy = {
  default: {
    baseTarget: 4,
    minTarget: 2,
    maxTarget: 7,
    freshnessDays: 7,
  },
  roots: {
    'local/saitama/tokorozawa': {
      baseTarget: 5,
      minTarget: 3,
      maxTarget: 7,
      freshnessDays: 4,
    },
    'local/saitama/other': {
      baseTarget: 4,
      minTarget: 3,
      maxTarget: 6,
      freshnessDays: 5,
    },
    'sports/mlb/dodgers': {
      baseTarget: 5,
      minTarget: 3,
      maxTarget: 8,
      freshnessDays: 3,
    },
    'sports/golf': {
      baseTarget: 4,
      minTarget: 3,
      maxTarget: 6,
      freshnessDays: 5,
    },
    'ai/enterprise': {
      baseTarget: 4,
      minTarget: 3,
      maxTarget: 6,
      freshnessDays: 7,
    },
    'ai/local-llm': {
      baseTarget: 4,
      minTarget: 3,
      maxTarget: 6,
      freshnessDays: 7,
    },
    'business/consulting': {
      baseTarget: 4,
      minTarget: 3,
      maxTarget: 6,
      freshnessDays: 10,
    },
    'business/client': {
      baseTarget: 4,
      minTarget: 3,
      maxTarget: 6,
      freshnessDays: 10,
    },
    'business/benchmark': {
      baseTarget: 3,
      minTarget: 2,
      maxTarget: 5,
      freshnessDays: 14,
    },
    'entertainment/movie-drama': {
      baseTarget: 4,
      minTarget: 3,
      maxTarget: 6,
      freshnessDays: 7,
    },
    'lifestyle/food-wellness': {
      baseTarget: 5,
      minTarget: 3,
      maxTarget: 7,
      freshnessDays: 5,
    },
    'personal/travel-tech': {
      baseTarget: 3,
      minTarget: 2,
      maxTarget: 5,
      freshnessDays: 7,
    },
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rootKeyForPath(path: string[]): string {
  if (!path || path.length === 0) return 'misc';
  if (path[0] === 'promoted') return 'promoted';
  if (path[0] === 'misc') return 'misc';
  if (path[0] === 'local') return path.slice(0, 3).join('/');
  return path.slice(0, 2).join('/');
}

function themeKeyForObservation(obs: ThemeInventoryObservation): { themeKey: string; themePath: string[] } {
  if (obs.themePath && obs.themePath.length > 0 && obs.themeKey) {
    return { themeKey: obs.themeKey, themePath: obs.themePath };
  }
  const themeInput: ThemeInput = {
    text: obs.topic || obs.preview || '',
    topic: obs.topic || obs.preview || '',
    preview: obs.preview,
    category: obs.category,
    interestCategory: obs.interestCategory,
    source: obs.source,
    sourceType: obs.sourceType,
  };
  const theme = classifyProactiveTheme(themeInput);
  return { themeKey: obs.themeKey || theme.key, themePath: obs.themePath && obs.themePath.length > 0 ? obs.themePath : theme.path };
}

function loadPolicyFile(): ThemeInventoryPolicy | null {
  try {
    if (!existsSync(POLICY_FILE)) return null;
    const raw = JSON.parse(readFileSync(POLICY_FILE, 'utf-8')) as Partial<ThemeInventoryPolicy>;
    return {
      default: {
        ...DEFAULT_POLICY.default,
        ...(raw.default || {}),
      },
      roots: {
        ...DEFAULT_POLICY.roots,
        ...(raw.roots || {}),
      },
    };
  } catch {
    return null;
  }
}

export function loadThemeInventoryPolicy(): ThemeInventoryPolicy {
  return loadPolicyFile() || DEFAULT_POLICY;
}

export function loadThemeInventorySnapshot(): ThemeInventorySnapshot | null {
  try {
    if (!existsSync(INVENTORY_FILE)) return null;
    const raw = JSON.parse(readFileSync(INVENTORY_FILE, 'utf-8')) as Partial<ThemeInventorySnapshot>;
    return {
      updatedAt: raw.updatedAt || new Date(0).toISOString(),
      records: Array.isArray(raw.records) ? raw.records : [],
    };
  } catch {
    return null;
  }
}

export function saveThemeInventorySnapshot(snapshot: ThemeInventorySnapshot): void {
  const dir = dirname(INVENTORY_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(INVENTORY_FILE, JSON.stringify(snapshot, null, 2), 'utf-8');
}

function getPolicyForRoot(rootKey: string, policy: ThemeInventoryPolicy): ThemeInventoryPolicyEntry {
  return policy.roots[rootKey] || policy.default;
}

function computeTargetCount(stats: {
  sent30dCount: number;
  positiveRate30d: number;
  uniqueSources30d: number;
  daysSinceLastSent: number | null;
}, policy: ThemeInventoryPolicyEntry): number {
  const activityBoost = stats.sent30dCount >= 12 ? 2 : stats.sent30dCount >= 5 ? 1 : 0;
  const engagementBoost = stats.positiveRate30d >= 0.6 ? 1 : stats.positiveRate30d <= 0.25 ? -1 : 0;
  const diversityBoost = stats.uniqueSources30d >= 3 ? 1 : 0;
  const staleBoost = stats.daysSinceLastSent !== null && stats.daysSinceLastSent > policy.freshnessDays * 1.5 ? 1 : 0;
  return clamp(
    policy.baseTarget + activityBoost + engagementBoost + diversityBoost + staleBoost,
    policy.minTarget,
    policy.maxTarget,
  );
}

function freshnessScore(daysSinceLastSent: number | null, freshnessDays: number): number {
  if (daysSinceLastSent === null) return 1;
  return clamp(1 - daysSinceLastSent / Math.max(freshnessDays, 1), 0, 1);
}

export function buildThemeInventorySnapshot(input: ThemeInventoryBuildInput): ThemeInventorySnapshot {
  const now = input.now || new Date();
  const policy = input.policy || loadThemeInventoryPolicy();
  const freshMs = 24 * 60 * 60 * 1000;
  const thirtyDaysMs = 30 * freshMs;

  const candidateCounts = new Map<string, number>();
  const candidatePaths = new Map<string, string[]>();
  const observed = [...(input.history || []), ...(input.sharedMessages || [])];

  for (const candidate of input.candidatePool || []) {
    const theme = classifyProactiveTheme({
      text: candidate.topic,
      topic: candidate.topic,
      preview: typeof candidate.metadata?.preview === 'string' ? candidate.metadata.preview : undefined,
      category: candidate.category,
      source: candidate.source,
      sourceType: typeof candidate.metadata?.mediaSource === 'string' ? candidate.metadata.mediaSource : undefined,
    });
    candidateCounts.set(theme.key, (candidateCounts.get(theme.key) || 0) + 1);
    candidatePaths.set(theme.key, theme.path);
  }

  const stats = new Map<string, {
    themePath: string[];
    rootKey: string;
    availableCount: number;
    sentFreshCount: number;
    sent30dCount: number;
    positive30dCount: number;
    negative30dCount: number;
    sourceSet: Set<string>;
    lastSentAt: string | null;
  }>();

  for (const obs of observed) {
    const { themeKey, themePath } = themeKeyForObservation(obs);
    const rootKey = rootKeyForPath(themePath);
    const sentAtMs = obs.sentAt ? new Date(obs.sentAt).getTime() : NaN;
    const within30d = Number.isFinite(sentAtMs) && now.getTime() - sentAtMs <= thirtyDaysMs;
    const policyEntry = getPolicyForRoot(rootKey, policy);
    const withinFresh = Number.isFinite(sentAtMs) && now.getTime() - sentAtMs <= policyEntry.freshnessDays * freshMs;

    if (!stats.has(themeKey)) {
      stats.set(themeKey, {
        themePath,
        rootKey,
        availableCount: candidateCounts.get(themeKey) || 0,
        sentFreshCount: 0,
        sent30dCount: 0,
        positive30dCount: 0,
        negative30dCount: 0,
        sourceSet: new Set<string>(),
        lastSentAt: null,
      });
    }

    const record = stats.get(themeKey)!;
    record.availableCount = candidateCounts.get(themeKey) || record.availableCount;
    if (within30d) {
      record.sent30dCount += 1;
      if (typeof obs.reactionDelta === 'number' && obs.reactionDelta > 0) record.positive30dCount += 1;
      if (typeof obs.reactionDelta === 'number' && obs.reactionDelta < 0) record.negative30dCount += 1;
      if (obs.source) record.sourceSet.add(obs.source);
      if (obs.interestCategory) record.sourceSet.add(obs.interestCategory);
    }
    if (withinFresh) {
      record.sentFreshCount += 1;
    }
    if (obs.sentAt && (!record.lastSentAt || obs.sentAt > record.lastSentAt)) {
      record.lastSentAt = obs.sentAt;
    }
  }

  for (const [themeKey, count] of candidateCounts.entries()) {
    if (!stats.has(themeKey)) {
      const path = candidatePaths.get(themeKey) || themeKey.split('/');
      const rootKey = rootKeyForPath(path);
      stats.set(themeKey, {
        themePath: path,
        rootKey,
        availableCount: count,
        sentFreshCount: 0,
        sent30dCount: 0,
        positive30dCount: 0,
        negative30dCount: 0,
        sourceSet: new Set<string>(),
        lastSentAt: null,
      });
    }
  }

  const records: ThemeInventoryRecord[] = [...stats.entries()].map(([themeKey, stat]) => {
    const policyEntry = getPolicyForRoot(stat.rootKey, policy);
    const daysSinceLastSent = stat.lastSentAt ? (now.getTime() - new Date(stat.lastSentAt).getTime()) / freshMs : null;
    const targetCount = computeTargetCount(
      {
        sent30dCount: stat.sent30dCount,
        positiveRate30d: stat.sent30dCount > 0 ? stat.positive30dCount / stat.sent30dCount : 0.5,
        uniqueSources30d: stat.sourceSet.size,
        daysSinceLastSent,
      },
      policyEntry,
    );
    const freshness = freshnessScore(daysSinceLastSent, policyEntry.freshnessDays);
    const positiveRate30d = stat.sent30dCount > 0 ? stat.positive30dCount / stat.sent30dCount : 0.5;
    return {
      themeKey,
      themePath: stat.themePath,
      rootKey: stat.rootKey,
      availableCount: stat.availableCount,
      sentFreshCount: stat.sentFreshCount,
      sent30dCount: stat.sent30dCount,
      positive30dCount: stat.positive30dCount,
      negative30dCount: stat.negative30dCount,
      positiveRate30d,
      uniqueSources30d: stat.sourceSet.size,
      targetCount,
      supplyGap: targetCount - stat.availableCount,
      rotationGap: targetCount - stat.sentFreshCount,
      freshnessDays: policyEntry.freshnessDays,
      freshnessScore: freshness,
      lastSentAt: stat.lastSentAt,
    };
  });

  records.sort((a, b) => {
    const gapDiff = b.rotationGap - a.rotationGap;
    if (gapDiff !== 0) return gapDiff;
    return b.availableCount - a.availableCount;
  });

  return {
    updatedAt: now.toISOString(),
    records,
  };
}

export function persistThemeInventorySnapshot(snapshot: ThemeInventorySnapshot): void {
  saveThemeInventorySnapshot(snapshot);
}

function findRecord(snapshot: ThemeInventorySnapshot | undefined, themePath: string[] | undefined): ThemeInventoryRecord | null {
  if (!snapshot || !themePath || themePath.length === 0) return null;
  const key = themePath.join('/');
  return snapshot.records.find((record) => record.themeKey === key) || null;
}

export function getThemeInventoryBonus(themePath: string[] | undefined, snapshot?: ThemeInventorySnapshot): number {
  const record = findRecord(snapshot, themePath);
  if (!record) return 0;

  const rotationPressure = record.rotationGap / Math.max(record.targetCount, 1);
  const supplyPressure = record.supplyGap / Math.max(record.targetCount, 1);
  const freshness = record.freshnessScore;
  const bonus = rotationPressure * 0.18 + supplyPressure * 0.05 + freshness * 0.04;
  return clamp(bonus, -0.18, 0.18);
}

export function formatThemeInventorySection(snapshot?: ThemeInventorySnapshot, limit: number = 6): string {
  if (!snapshot || snapshot.records.length === 0) return '';

  const underfilled = snapshot.records
    .filter((record) => record.rotationGap > 0)
    .slice(0, limit);
  const overused = snapshot.records
    .filter((record) => record.rotationGap < 0)
    .slice(0, Math.max(2, Math.floor(limit / 2)));

  if (underfilled.length === 0 && overused.length === 0) return '';

  const lines: string[] = ['## テーマ在庫メモ'];
  if (underfilled.length > 0) {
    lines.push('### 足りないテーマ');
    for (const record of underfilled) {
      lines.push(`- ${record.themeKey} / 目標${record.targetCount} / 現在${record.availableCount} / 回転差${record.rotationGap}`);
    }
  }
  if (overused.length > 0) {
    lines.push('### 出しすぎ注意');
    for (const record of overused) {
      lines.push(`- ${record.themeKey} / 目標${record.targetCount} / 今週${record.sentFreshCount} / 回転差${record.rotationGap}`);
    }
  }
  return `\n${lines.join('\n')}\n`;
}

export function getTopThemeInventoryGaps(snapshot?: ThemeInventorySnapshot, limit: number = 8): ThemeInventoryRecord[] {
  if (!snapshot) return [];
  return [...snapshot.records]
    .sort((a, b) => {
      const gapDiff = b.rotationGap - a.rotationGap;
      if (gapDiff !== 0) return gapDiff;
      return b.availableCount - a.availableCount;
    })
    .slice(0, limit);
}
