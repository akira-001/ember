/**
 * Conversation Scorer — 6-axis scoring system for proactive agent candidates.
 */

import {
  sampleWeights,
  type LearningState,
  type WeightPrior,
} from './thompson-sampling';
import { type ProfileType, getProfileMultiplier } from './conversation-profile';
import { isSharedTopicSimilar, normalizeSharedTopic, normalizeUrlForDedup } from './shared-proactive-history';
import { classifyProactiveTheme, hasThemeOverlap } from './proactive-themes';
import { getThemeInventoryBonus, type ThemeInventorySnapshot } from './theme-inventory';

export interface RawCandidate {
  topic: string;
  source: 'interest-cache' | 'calendar' | 'cogmem' | 'follow-up' | 'gmail' | 'topic';
  category: string;
  pub_date: string | null;
  metadata: Record<string, unknown>;
}

export interface ScoredCandidate extends RawCandidate {
  scores: {
    timeliness: number;
    novelty: number;
    continuity: number;
    emotional_fit: number;
    affinity: number;
    surprise: number;
  };
  finalScore: number;
  explorationBonus?: number;
  selectionScore?: number;
  reasoning: string;
}

export interface ConversationContext {
  currentHour: number;
  dayOfWeek: number;        // 0=Sun, 6=Sat
  todayMessages: Array<{
    time: string;
    summary: string;
    source: string;
    interestCategory?: string;
    topic?: string;
    url?: string;
    candidateId?: string;
    themePath?: string[];
    themeKey?: string;
  }>;
  recentHistory: Array<{
    category: string;
    interestCategory?: string;
    sentAt: string;
    reaction: string | null;
    reactionDelta: number;
    preview?: string;
    candidateId?: string;
    candidateTopic?: string;
    candidateUrl?: string;
    themePath?: string[];
    themeKey?: string;
  }>;
  calendarDensity: number;  // 0=empty, 1=normal, 2=busy
  lastSentMinutesAgo: number;
  consecutiveNoReaction: number;
  themeInventory?: ThemeInventorySnapshot;
}

// ── Scoring Functions ──

/**
 * Score timeliness based on publication date, source type.
 */
export function scoreTimeliness(candidate: RawCandidate): number {
  // Follow-up always 0.9
  if (candidate.source === 'follow-up') return 0.9;

  if (!candidate.pub_date) return 0.3;

  const pubDate = new Date(candidate.pub_date);
  const now = Date.now();

  // Calendar events
  if (candidate.source === 'calendar') {
    const diffMs = pubDate.getTime() - now;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays <= 0) return 0.9;            // today (or past)
    if (diffDays <= 1) return 0.6;            // tomorrow
    return 0.3;                                // next week+
  }

  // Articles: piecewise linear decay
  // 0h→1.0, 6h→0.75, 24h→0.5, 48h→0.0
  const ageHours = (now - pubDate.getTime()) / (1000 * 60 * 60);
  if (ageHours <= 0) return 1.0;
  if (ageHours >= 48) return 0.0;

  if (ageHours <= 6) {
    // 0→6h: 1.0→0.75
    return 1.0 - (ageHours / 6) * 0.25;
  }
  if (ageHours <= 24) {
    // 6→24h: 0.75→0.5
    return 0.75 - ((ageHours - 6) / 18) * 0.25;
  }
  // 24→48h: 0.5→0.0
  return 0.5 - ((ageHours - 24) / 24) * 0.5;
}

/** Check if two text strings are similar by keyword/CJK overlap */
function isSimilarText(a: string, b: string): boolean {
  if (isSharedTopicSimilar(a, b)) return true;

  const aLower = normalizeSharedTopic(a);
  const bLower = normalizeSharedTopic(b);
  if (!aLower || !bLower) return false;

  const fragments = aLower.split(/[\s,、。！!？?\-\—\–「」（）\(\)]+/).filter(w => w.length >= 2);
  const wordMatches = fragments.filter(w => bLower.includes(w)).length;
  if (wordMatches >= 2) return true;

  const cjkWindows: string[] = [];
  for (let i = 0; i <= aLower.length - 3; i++) {
    const w = aLower.slice(i, i + 3);
    if (/[\u3000-\u9fff]/.test(w)) cjkWindows.push(w);
  }
  if (cjkWindows.length > 0) {
    const cjkMatches = cjkWindows.filter(w => bLower.includes(w)).length;
    if (cjkMatches >= 3) return true;
  }

  return false;
}

function buildCandidateId(candidate: RawCandidate): string {
  const url = typeof candidate.metadata?.url === 'string' ? candidate.metadata.url : '';
  if (url) return `url:${url}`;
  const normalizedTopic = candidate.topic
    .toLowerCase()
    .replace(/[（）()【】「」『』｢｣﹁﹂﹃﹄\-:：|｜,、。."'"'!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `topic:${candidate.source}:${candidate.category}:${normalizedTopic}`;
}

/**
 * Score novelty: penalize repetition, reward freshness.
 */
export function scoreNovelty(candidate: RawCandidate, ctx: ConversationContext): number {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const candidateTheme = classifyProactiveTheme({
    text: candidate.topic,
    topic: candidate.topic,
    category: candidate.category,
    source: candidate.source,
    sourceType: typeof candidate.metadata?.mediaSource === 'string' ? candidate.metadata.mediaSource : undefined,
  }).path;

  const getEntryTheme = (entry: {
    topic?: string;
    summary?: string;
    preview?: string;
    candidateTopic?: string;
    source?: string;
    candidateSource?: string;
    sourceType?: string;
    interestCategory?: string;
    category?: string;
    themePath?: string[];
  }): string[] => {
    if (entry.themePath && entry.themePath.length > 0) return entry.themePath;
    return classifyProactiveTheme({
      text: entry.candidateTopic || entry.topic || entry.summary || entry.preview || '',
      topic: entry.candidateTopic || entry.topic || entry.summary || entry.preview || '',
      preview: entry.preview || entry.summary,
      category: entry.category,
      interestCategory: entry.interestCategory,
      source: entry.candidateSource || entry.source,
      sourceType: entry.sourceType,
    }).path;
  };

  // Match by interestCategory (dodgers, ai_agent, etc.) — NOT by SuggestionCategory (hobby_leisure)
  const matchesCategory = (h: { category: string; interestCategory?: string }) =>
    h.interestCategory === candidate.category || h.category === candidate.category;

  // Check if same category was sent today
  const sameCategoryToday = ctx.recentHistory.some(h => {
    const sentDate = new Date(h.sentAt);
    return matchesCategory(h) && sentDate >= todayStart;
  });
  if (sameCategoryToday) return 0.0;

  const candidateId = buildCandidateId(candidate);
  const candidateUrl = normalizeUrlForDedup(candidate.metadata?.url as string | undefined);
  const candidateTopic = candidate.topic;

  const exactDuplicateToday = ctx.todayMessages.some(m =>
    (m.candidateId && m.candidateId === candidateId)
    || (candidateUrl && normalizeUrlForDedup(m.url) === candidateUrl),
  );
  if (exactDuplicateToday) return 0.0;

  // Check if similar topic was already sent today (cross-category dedup via todayMessages)
  const similarTopicToday = ctx.todayMessages.some(m =>
    isSimilarText(candidateTopic, m.topic || m.summary || ''),
  );
  if (similarTopicToday) return 0.0;

  const similarThemeToday = ctx.todayMessages.some((m) => {
    const overlap = hasThemeOverlap(candidateTheme, getEntryTheme(m));
    return overlap.overlap && overlap.depth >= 3;
  });
  if (similarThemeToday) return 0.0;

  // Check negatively-rated history — use longer text for broader matching
  const topicLong = candidate.topic.slice(0, 60);
  const similarToNegative = ctx.recentHistory.some(h =>
    h.reactionDelta < 0 && (h.candidateTopic || h.preview) && isSimilarText(topicLong, h.candidateTopic || h.preview || ''),
  );
  if (similarToNegative) return 0.0; // Hard block — user explicitly disliked

  // Check recentHistory previews for similar topic (catches cross-day repeats)
  const exactDuplicateHistory = ctx.recentHistory.some(h =>
    (h.candidateId && h.candidateId === candidateId)
    || (candidateUrl && normalizeUrlForDedup(h.candidateUrl) === candidateUrl),
  );
  if (exactDuplicateHistory) return 0.0;

  const similarInHistory = ctx.recentHistory.some(h =>
    (h.candidateTopic || h.preview) && isSimilarText(candidateTopic, h.candidateTopic || h.preview || ''),
  );
  if (similarInHistory) return 0.0; // Hard block repeat across days

  const similarThemeHistory = ctx.recentHistory.some((h) => {
    const overlap = hasThemeOverlap(candidateTheme, getEntryTheme(h));
    return overlap.overlap && overlap.depth >= 3;
  });
  if (similarThemeHistory) return 0.0;

  // Check todayMessages for same source/category
  const sameSourceToday = ctx.todayMessages.some(
    m => m.interestCategory === candidate.category || m.source === candidate.source,
  );
  if (sameSourceToday) return 0.1;

  // Find most recent entry for this category
  const categoryEntries = ctx.recentHistory
    .filter(h => matchesCategory(h))
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());

  if (categoryEntries.length === 0) return 0.8; // Never mentioned

  const mostRecent = new Date(categoryEntries[0].sentAt);
  const daysSince = (now - mostRecent.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSince >= 7) return 0.9;
  if (daysSince >= 3) return 0.7;
  if (daysSince >= 1) return 0.3;

  return 0.2; // Less than a day but not today — penalize repeat
}

/**
 * Score continuity: reward following up on recent topics.
 */
export function scoreContinuity(candidate: RawCandidate, ctx: ConversationContext): number {
  if (candidate.source === 'follow-up') return 0.9;

  // Check yesterday's interestCategory
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const twoDaysMs = 2 * oneDayMs;

  const yesterdayEntries = ctx.recentHistory.filter(h => {
    const sentTime = new Date(h.sentAt).getTime();
    const age = now - sentTime;
    return age >= oneDayMs * 0.5 && age <= twoDaysMs;
  });

  const matchesYesterday = yesterdayEntries.some(
    h => h.interestCategory === candidate.category || h.category === candidate.category,
  );

  if (matchesYesterday) return 0.9;

  return 0.3;
}

/**
 * Score emotional fit based on time/day context and emotion type.
 */
export function scoreEmotionalFit(candidate: RawCandidate, ctx: ConversationContext): number {
  const emotionType = (candidate.metadata.emotion_type as string) || 'medium';
  const isWeekend = ctx.dayOfWeek === 0 || ctx.dayOfWeek === 6;
  const isBusy = ctx.calendarDensity === 2;
  const isEvening = ctx.currentHour >= 20;
  const isMorning = ctx.currentHour >= 8 && ctx.currentHour <= 10;

  if (isWeekend) {
    if (emotionType === 'light') return 0.9;
    if (emotionType === 'heavy') return 0.2;
  }

  if (isBusy) {
    if (emotionType === 'light') return 0.7;
    if (emotionType === 'heavy') return 0.3;
  }

  if (isEvening && emotionType === 'light') return 0.9;
  if (isMorning && emotionType === 'heavy') return 0.8;

  return 0.5; // default for medium or unmatched
}

/**
 * Score affinity: based on historical reaction rate for this category.
 */
export function scoreAffinity(candidate: RawCandidate, ctx: ConversationContext): number {
  const entries = ctx.recentHistory.filter(
    h => h.interestCategory === candidate.category || h.category === candidate.category,
  );
  if (entries.length === 0) return 0.5;

  const positiveCount = entries.filter(h => h.reaction === 'positive').length;
  const rate = positiveCount / entries.length;

  if (rate >= 0.8) return 0.9;
  if (rate >= 0.5) return 0.7;
  return 0.4;
}

/**
 * Score surprise: reward unexpected/discovery content.
 */
export function scoreSurprise(candidate: RawCandidate, ctx: ConversationContext): number {
  if (candidate.category === '_cross') return 0.9;
  if (candidate.category === '_wildcard') return 0.8;

  if (candidate.category === '_discovery') {
    const occurrences = ctx.recentHistory.filter(h => h.category === '_discovery').length;
    return 0.5 + Math.min(occurrences * 0.1, 0.35);
  }

  if (candidate.source === 'cogmem' && candidate.metadata.isOneYearAgo) return 0.8;

  // Category not in recent history at all
  const categoryInHistory = ctx.recentHistory.some(h => h.category === candidate.category);
  if (!categoryInHistory) return 0.7;

  return 0.1;
}

// ── Context & Weights ──

/**
 * Context-based bonuses for scoring axes.
 */
export function getContextBonus(ctx: ConversationContext): Record<string, number> {
  const bonus: Record<string, number> = {
    timeliness: 0,
    novelty: 0,
    continuity: 0,
    emotional_fit: 0,
    affinity: 0,
    surprise: 0,
  };

  // Morning (8-10): timeliness +0.10
  if (ctx.currentHour >= 8 && ctx.currentHour <= 10) {
    bonus.timeliness = 0.10;
  }

  // Recent send (<120min): continuity +0.10
  if (ctx.lastSentMinutesAgo < 120) {
    bonus.continuity = 0.10;
  }

  // 3+ no reactions: surprise +0.15
  if (ctx.consecutiveNoReaction >= 3) {
    bonus.surprise = 0.15;
  }

  // Weekend: emotional_fit +0.10
  if (ctx.dayOfWeek === 0 || ctx.dayOfWeek === 6) {
    bonus.emotional_fit = 0.10;
  }

  return bonus;
}

/**
 * Sample weights from Thompson Sampling + apply context bonus + normalize.
 */
export function getDynamicWeights(
  learningState: LearningState,
  ctx: ConversationContext,
): { weights: Record<string, number>; sampledRaw: Record<string, number>; bonus: Record<string, number> } {
  const sampledRaw = sampleWeights(learningState.priors);
  const bonus = getContextBonus(ctx);

  // Combine sampled weights + bonus
  const combined: Record<string, number> = {};
  let sum = 0;
  for (const key of Object.keys(sampledRaw)) {
    combined[key] = sampledRaw[key] + (bonus[key] || 0);
    sum += combined[key];
  }

  // Normalize
  const weights: Record<string, number> = {};
  for (const key of Object.keys(combined)) {
    weights[key] = sum > 0 ? combined[key] / sum : 1 / Object.keys(combined).length;
  }

  return { weights, sampledRaw, bonus };
}

// ── Candidate Scoring ──

/**
 * Score all candidates using the 6-axis model.
 */
export function scoreCandidates(
  rawCandidates: RawCandidate[],
  ctx: ConversationContext,
  learningState: LearningState,
  profileType?: ProfileType,
): {
  candidates: ScoredCandidate[];
  weightsUsed: Record<string, number>;
  sampledRaw: Record<string, number>;
  bonus: Record<string, number>;
} {
  const { weights, sampledRaw, bonus } = getDynamicWeights(learningState, ctx);

  const scored: ScoredCandidate[] = rawCandidates.map(candidate => {
    const candidateTheme = classifyProactiveTheme({
      text: candidate.topic,
      topic: candidate.topic,
      category: candidate.category,
      source: candidate.source,
      sourceType: typeof candidate.metadata?.mediaSource === 'string' ? candidate.metadata.mediaSource : undefined,
    }).path;
    const scores = {
      timeliness: scoreTimeliness(candidate),
      novelty: scoreNovelty(candidate, ctx),
      continuity: scoreContinuity(candidate, ctx),
      emotional_fit: scoreEmotionalFit(candidate, ctx),
      affinity: scoreAffinity(candidate, ctx),
      surprise: scoreSurprise(candidate, ctx),
    };

    let finalScore = 0;
    for (const [axis, weight] of Object.entries(weights)) {
      finalScore += weight * (scores as any)[axis];
    }

    finalScore += getThemeInventoryBonus(candidateTheme, ctx.themeInventory);

    if (profileType) {
      finalScore *= getProfileMultiplier(profileType, candidate.category);
    }

    const reasoning = buildReasoning(candidate, scores);

    return {
      ...candidate,
      scores,
      finalScore,
      reasoning,
    };
  });

  // Sort descending by finalScore
  scored.sort((a, b) => b.finalScore - a.finalScore);

  return { candidates: scored, weightsUsed: weights, sampledRaw, bonus };
}

// ── Exploration ──

const EXPLORATION_COEFF = 0.15;

/**
 * UCB1 exploration bonus + discovery category extra bonus.
 * Re-sorts by selectionScore.
 */
export function addExplorationBonus(
  candidates: ScoredCandidate[],
  learningState: LearningState,
): ScoredCandidate[] {
  const totalN = learningState.totalSelections;
  const catN = learningState.categorySelections;

  const discoveryExtra: Record<string, number> = {
    _wildcard: 0.15,
    _cross: 0.10,
    _discovery: 0.12,
  };

  // Concentration penalty: categories with >40% of total selections get penalized
  const concentrationThreshold = 0.4;

  return candidates
    .map(c => {
      let explorationBonus: number;

      if (!catN[c.category] || catN[c.category] === 0) {
        // Unknown category
        explorationBonus = EXPLORATION_COEFF * 2;
      } else {
        // UCB1: coeff * sqrt(2 * ln(totalN) / categoryN)
        explorationBonus = EXPLORATION_COEFF * Math.sqrt(
          (2 * Math.log(totalN)) / catN[c.category],
        );

        // Concentration penalty: reduce score for over-represented categories
        if (totalN > 5) {
          const ratio = catN[c.category] / totalN;
          if (ratio > concentrationThreshold) {
            // Penalty scales with how far over threshold (max -0.20)
            explorationBonus -= Math.min(0.20, (ratio - concentrationThreshold) * 0.5);
          }
        }
      }

      // Extra bonus for discovery categories
      if (discoveryExtra[c.category]) {
        explorationBonus += discoveryExtra[c.category];
      }

      const selectionScore = c.finalScore + explorationBonus;

      return {
        ...c,
        explorationBonus,
        selectionScore,
      };
    })
    .sort((a, b) => (b.selectionScore ?? 0) - (a.selectionScore ?? 0));
}

// ── Follow-up Generation ──

/**
 * Generate follow-up candidates from yesterday's messages with positive reactions.
 */
export function generateFollowUpCandidates(ctx: ConversationContext): RawCandidate[] {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const twoDaysMs = 2 * oneDayMs;

  const yesterdayPositive = ctx.recentHistory.filter(h => {
    const age = now - new Date(h.sentAt).getTime();
    return age >= oneDayMs * 0.5 && age <= twoDaysMs && h.reaction === 'positive';
  });

  return yesterdayPositive.map(h => ({
    topic: `${h.category} の続き`,
    source: 'follow-up' as const,
    category: h.category,
    pub_date: null,
    metadata: { originalCategory: h.interestCategory || h.category },
  }));
}

function normalizeCandidateKey(candidate: RawCandidate): string {
  const url = typeof candidate.metadata?.url === 'string' ? candidate.metadata.url : '';
  if (url) return `url:${url}`;

  const normalizedTopic = candidate.topic
    .toLowerCase()
    .replace(/[（）()【】「」『』｢｣﹁﹂﹃﹄\-:：|｜,、。."'"'"'!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return `topic:${normalizedTopic}`;
}

export function mergeDistinctCandidates(
  primary: RawCandidate[],
  supplemental: RawCandidate[],
): RawCandidate[] {
  const merged: RawCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of [...primary, ...supplemental]) {
    const key = normalizeCandidateKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
  }

  return merged;
}

type GmailMessage = {
  id?: string;
  from?: string;
  subject?: string;
  snippet?: string;
  date?: string;
};

type CalendarEvent = {
  summary?: string;
  start?: string;
  end?: string;
  location?: string;
  calendar?: string;
};

type TopicItem = {
  title?: string;
  source?: string;
  interest?: string;
};

function deriveCategoryFromInterest(interest?: string): string {
  const lower = (interest || '').toLowerCase();
  if (!lower) return 'general_news';
  if (lower.includes('ai') || lower.includes('claude') || lower.includes('llm')) return 'ai_agent';
  if (lower.includes('大谷') || lower.includes('野球') || lower.includes('mlb') || lower.includes('dodgers')) return 'dodgers';
  if (lower.includes('ゴルフ')) return 'golf';
  if (lower.includes('温泉')) return 'onsen';
  if (lower.includes('所沢') || lower.includes('埼玉')) return 'local_tokorozawa';
  if (lower.includes('猫')) return 'cat_health';
  if (lower.includes('経営') || lower.includes('戦略')) return 'business_strategy';
  return 'general_news';
}

function deriveCalendarCategory(summary: string, location?: string): string {
  const text = `${summary} ${location || ''}`.toLowerCase();
  if (text.includes('誕生日') || text.includes('記念') || text.includes('birthday')) return 'personal_event';
  if (text.includes('休み') || text.includes('旅行') || text.includes('家族')) return 'personal_event';
  return 'meeting_prep';
}

function deriveCogmemCategory(content: string): string {
  const lower = content.toLowerCase();
  if (lower.includes('大谷') || lower.includes('野球') || lower.includes('mlb') || lower.includes('dodgers')) return 'dodgers';
  if (lower.includes('ai') || lower.includes('claude') || lower.includes('llm') || lower.includes('エージェント')) return 'ai_agent';
  if (lower.includes('ゴルフ')) return 'golf';
  if (lower.includes('温泉')) return 'onsen';
  if (lower.includes('猫')) return 'cat_health';
  if (lower.includes('経営') || lower.includes('戦略')) return 'business_strategy';
  if (lower.includes('所沢') || lower.includes('埼玉')) return 'local_tokorozawa';
  if (lower.includes('会議') || lower.includes('予定')) return 'meeting_prep';
  return 'flashback';
}

export function buildSupplementCandidatesFromMemoryContext(memoryContext: string): RawCandidate[] {
  if (!memoryContext.trim()) return [];

  const candidates: RawCandidate[] = [];
  const sections = memoryContext.split(/\n## /g);

  for (const section of sections) {
    const lines = section.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const header = lines[0].replace(/^##\s*/, '');
    const bodyLines = lines.slice(1).filter(line => line.startsWith('- '));
    for (const line of bodyLines.slice(0, 5)) {
      const content = line.replace(/^- \[[^\]]+\]\s*/, '').replace(/^- /, '').trim();
      if (!content) continue;

      candidates.push({
        topic: content.slice(0, 120),
        source: 'cogmem',
        category: deriveCogmemCategory(`${header} ${content}`),
        pub_date: null,
        metadata: {
          memorySection: header,
          memoryContent: content,
          sourceType: 'cogmem',
        },
      });
    }
  }

  return mergeDistinctCandidates([], candidates);
}

export function buildSupplementCandidatesFromCollectedData(collectedData: string): RawCandidate[] {
  try {
    const data = JSON.parse(collectedData) as {
      gmail?: { unread_important?: GmailMessage[] };
      calendar?: { today?: CalendarEvent[]; tomorrow?: CalendarEvent[] };
      topics?: TopicItem[];
    };

    const candidates: RawCandidate[] = [];

    for (const msg of data.gmail?.unread_important || []) {
      const topic = (msg.subject || msg.snippet || '').trim();
      if (!topic) continue;
      candidates.push({
        topic,
        source: 'gmail',
        category: 'email_reply',
        pub_date: msg.date || null,
        metadata: {
          from: msg.from || '',
          snippet: msg.snippet || '',
          messageId: msg.id || '',
          sourceType: 'gmail',
        },
      });
    }

    for (const event of [...(data.calendar?.today || []), ...(data.calendar?.tomorrow || [])]) {
      const summary = (event.summary || '').trim();
      if (!summary) continue;
      candidates.push({
        topic: event.start ? `${summary} (${event.start})` : summary,
        source: 'calendar',
        category: deriveCalendarCategory(summary, event.location),
        pub_date: event.start || null,
        metadata: {
          location: event.location || '',
          calendar: event.calendar || '',
          end: event.end || '',
          sourceType: 'calendar',
        },
      });
    }

    for (const item of data.topics || []) {
      const topic = (item.title || '').trim();
      if (!topic) continue;
      candidates.push({
        topic,
        source: 'topic',
        category: deriveCategoryFromInterest(item.interest || item.source),
        pub_date: null,
        metadata: {
          sourceLabel: item.source || '',
          interest: item.interest || '',
          sourceType: 'topic',
        },
      });
    }

    return mergeDistinctCandidates([], candidates);
  } catch {
    return [];
  }
}

export interface CandidateScoringResult {
  candidates: ScoredCandidate[];
  weightsUsed: Record<string, number>;
  sampledRaw: Record<string, number>;
  bonus: Record<string, number>;
  usedBackfill: boolean;
  primaryCount: number;
  supplementalCount: number;
  viableCount: number;
}

export function scoreCandidatesWithBackfill(
  primaryCandidates: RawCandidate[],
  supplementalCandidates: RawCandidate[],
  ctx: ConversationContext,
  learningState: LearningState,
  profileType?: ProfileType,
  minViableCount: number = 4,
): CandidateScoringResult {
  let scoreResult = scoreCandidates(primaryCandidates, ctx, learningState, profileType);
  let viable = scoreResult.candidates.filter(c => c.scores.novelty > 0);
  let usedBackfill = false;

  if (viable.length < minViableCount && supplementalCandidates.length > 0) {
    const merged = mergeDistinctCandidates(primaryCandidates, supplementalCandidates);
    if (merged.length > primaryCandidates.length) {
      scoreResult = scoreCandidates(merged, ctx, learningState, profileType);
      viable = scoreResult.candidates.filter(c => c.scores.novelty > 0);
      usedBackfill = true;
    }
  }

  const ranked = addExplorationBonus(viable, learningState);
  return {
    candidates: ranked,
    weightsUsed: scoreResult.weightsUsed,
    sampledRaw: scoreResult.sampledRaw,
    bonus: scoreResult.bonus,
    usedBackfill,
    primaryCount: primaryCandidates.length,
    supplementalCount: supplementalCandidates.length,
    viableCount: viable.length,
  };
}

// ── Reasoning ──

const AXIS_LABELS: Record<string, string> = {
  timeliness: '旬',
  novelty: '新鮮さ',
  continuity: '流れ',
  emotional_fit: '状態適合',
  affinity: '好み',
  surprise: '意外性',
};

// Aliases for matching in buildReasoning output
const AXIS_DESCRIPTION: Record<string, string> = {
  timeliness: 'タイムリー',
  novelty: '新鮮',
  continuity: '会話の流れに沿う',
  emotional_fit: '気分に合う',
  affinity: '好みに合う',
  surprise: '意外・サプライズ',
};

/**
 * Build a one-line Japanese reasoning string.
 */
export function buildReasoning(
  candidate: RawCandidate,
  scores: Record<string, number>,
): string {
  // Find top 2 scoring axes
  const sorted = Object.entries(scores)
    .sort(([, a], [, b]) => b - a);

  const top = sorted.slice(0, 2);
  const topDescriptions = top
    .filter(([, score]) => score >= 0.3)
    .map(([axis]) => AXIS_DESCRIPTION[axis] || AXIS_LABELS[axis] || axis);

  if (topDescriptions.length === 0) {
    return `${candidate.topic}: スコア低め`;
  }

  return `${topDescriptions.join('・')}（${candidate.source}）`;
}
