import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  scoreTimeliness,
  scoreNovelty,
  scoreContinuity,
  scoreEmotionalFit,
  scoreAffinity,
  scoreSurprise,
  getContextBonus,
  getDynamicWeights,
  scoreCandidates,
  addExplorationBonus,
  generateFollowUpCandidates,
  buildSupplementCandidatesFromCollectedData,
  buildSupplementCandidatesFromMemoryContext,
  scoreCandidatesWithBackfill,
  buildReasoning,
  type RawCandidate,
  type ScoredCandidate,
  type ConversationContext,
} from '../conversation-scorer';
import { createInitialLearningState, type LearningState } from '../thompson-sampling';

// Helper to create a base context
function makeCtx(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    currentHour: 14,
    dayOfWeek: 3, // Wednesday
    todayMessages: [],
    recentHistory: [],
    calendarDensity: 1,
    lastSentMinutesAgo: 180,
    consecutiveNoReaction: 0,
    ...overrides,
  };
}

// Helper to create a raw candidate
function makeCandidate(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    topic: 'Test topic',
    source: 'interest-cache',
    category: 'tech',
    pub_date: null,
    metadata: {},
    ...overrides,
  };
}

describe('conversation-scorer', () => {
  describe('scoreTimeliness', () => {
    it('should return 1.0 for just-published article (0 hours ago)', () => {
      const now = new Date();
      const candidate = makeCandidate({ pub_date: now.toISOString() });
      expect(scoreTimeliness(candidate)).toBeCloseTo(1.0, 1);
    });

    it('should return ~0.75 for 6-hour-old article', () => {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const candidate = makeCandidate({ pub_date: sixHoursAgo.toISOString() });
      expect(scoreTimeliness(candidate)).toBeCloseTo(0.75, 1);
    });

    it('should return ~0.5 for 24-hour-old article', () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const candidate = makeCandidate({ pub_date: oneDayAgo.toISOString() });
      expect(scoreTimeliness(candidate)).toBeCloseTo(0.5, 1);
    });

    it('should return 0.0 for 48+ hour-old article', () => {
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const candidate = makeCandidate({ pub_date: twoDaysAgo.toISOString() });
      expect(scoreTimeliness(candidate)).toBe(0.0);
    });

    it('should return 0.9 for today calendar event', () => {
      const today = new Date();
      const candidate = makeCandidate({
        source: 'calendar',
        pub_date: today.toISOString(),
      });
      expect(scoreTimeliness(candidate)).toBeCloseTo(0.9, 1);
    });

    it('should return 0.6 for tomorrow calendar event', () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const candidate = makeCandidate({
        source: 'calendar',
        pub_date: tomorrow.toISOString(),
      });
      expect(scoreTimeliness(candidate)).toBeCloseTo(0.6, 1);
    });

    it('should return 0.3 for next-week calendar event', () => {
      const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const candidate = makeCandidate({
        source: 'calendar',
        pub_date: nextWeek.toISOString(),
      });
      expect(scoreTimeliness(candidate)).toBeCloseTo(0.3, 1);
    });

    it('should return 0.9 for follow-up source', () => {
      const candidate = makeCandidate({ source: 'follow-up' });
      expect(scoreTimeliness(candidate)).toBe(0.9);
    });

    it('should return 0.3 when no pub_date', () => {
      const candidate = makeCandidate({ pub_date: null });
      expect(scoreTimeliness(candidate)).toBe(0.3);
    });
  });

  describe('scoreNovelty', () => {
    it('should return 0.0 when same category was sent today', () => {
      const ctx = makeCtx({
        todayMessages: [{ time: '10:00', summary: 'tech news', source: 'interest-cache' }],
        recentHistory: [{ category: 'tech', sentAt: new Date().toISOString(), reaction: null, reactionDelta: 0 }],
      });
      const candidate = makeCandidate({ category: 'tech' });
      expect(scoreNovelty(candidate, ctx)).toBe(0.0);
    });

    it('should return 0.1 when same source was sent today', () => {
      const ctx = makeCtx({
        todayMessages: [{ time: '10:00', summary: 'sports news', source: 'interest-cache' }],
        recentHistory: [{ category: 'sports', sentAt: new Date().toISOString(), reaction: null, reactionDelta: 0 }],
      });
      // Different category but same source sent today
      const candidate = makeCandidate({ topic: 'ラーメンを食べたい', category: 'music', source: 'interest-cache' });
      expect(scoreNovelty(candidate, ctx)).toBe(0.1);
    });

    it('should return 0.3 when same category was sent yesterday', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const ctx = makeCtx({
        recentHistory: [{ category: 'tech', sentAt: yesterday.toISOString(), reaction: null, reactionDelta: 0 }],
      });
      const candidate = makeCandidate({ category: 'tech' });
      expect(scoreNovelty(candidate, ctx)).toBe(0.3);
    });

    it('should return 0.7 when same category was sent 3+ days ago', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const ctx = makeCtx({
        recentHistory: [{ category: 'tech', sentAt: threeDaysAgo.toISOString(), reaction: null, reactionDelta: 0 }],
      });
      const candidate = makeCandidate({ category: 'tech' });
      expect(scoreNovelty(candidate, ctx)).toBe(0.7);
    });

    it('should return 0.9 when same category was sent 7+ days ago', () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const ctx = makeCtx({
        recentHistory: [{ category: 'tech', sentAt: sevenDaysAgo.toISOString(), reaction: null, reactionDelta: 0 }],
      });
      const candidate = makeCandidate({ category: 'tech' });
      expect(scoreNovelty(candidate, ctx)).toBe(0.9);
    });

    it('should return 0.8 when category has never been mentioned', () => {
      const ctx = makeCtx({ recentHistory: [] });
      const candidate = makeCandidate({ category: 'completely-new' });
      expect(scoreNovelty(candidate, ctx)).toBe(0.8);
    });

    it('should return 0.0 when same candidateId was already sent today', () => {
      const ctx = makeCtx({
        todayMessages: [{
          time: '10:00',
          summary: 'ニコンのカメラ、月の裏側へ',
          source: 'interest-cache',
          topic: 'ニコンのカメラ、月の裏側へ',
          candidateId: 'url:https://example.com/nikon-moon',
        }],
      });
      const candidate = makeCandidate({
        topic: 'ニコンのカメラ、月の裏側へ',
        category: 'space',
        metadata: { url: 'https://example.com/nikon-moon' },
      });
      expect(scoreNovelty(candidate, ctx)).toBe(0.0);
    });

    it('should return 0.0 when a similar topic was already sent today', () => {
      const ctx = makeCtx({
        todayMessages: [{
          time: '10:00',
          summary: 'ニコンのカメラ、月の裏側へ',
          source: 'interest-cache',
          topic: 'ニコンのカメラ、月の裏側へ',
        }],
      });
      const candidate = makeCandidate({
        category: 'space',
        topic: 'ニコンカメラ 月の裏側へ',
      });
      expect(scoreNovelty(candidate, ctx)).toBe(0.0);
    });

    it('should return 0.0 when similar to negatively-rated message', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const ctx = makeCtx({
        recentHistory: [{
          category: 'golf',
          interestCategory: 'golf',
          sentAt: yesterday.toISOString(),
          reaction: '-1',
          reactionDelta: -3,
          preview: '多摩川ゴルフ倶楽部が4/29に丸ごとドッグランになるイベント',
        }],
      });
      const candidate = makeCandidate({
        category: 'golf',
        topic: '多摩川ゴルフ倶楽部の巨大ドッグランイベント開催',
      });
      expect(scoreNovelty(candidate, ctx)).toBe(0.0);
    });

    it('should return 0.0 when a similar topic exists in recent history', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const ctx = makeCtx({
        recentHistory: [{
          category: 'space',
          sentAt: yesterday.toISOString(),
          reaction: null,
          reactionDelta: 0,
          candidateTopic: 'アルテミスII計画 宇宙飛行士の地球写真',
          preview: 'アルテミスII計画 宇宙飛行士の地球写真',
        }],
      });
      const candidate = makeCandidate({
        category: 'space',
        topic: 'アルテミスII計画の宇宙飛行士が撮影した地球写真',
      });
      expect(scoreNovelty(candidate, ctx)).toBe(0.0);
    });

    it('should return 0.0 when a paraphrased topic exists in recent history', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const ctx = makeCtx({
        recentHistory: [{
          category: 'events',
          sentAt: yesterday.toISOString(),
          reaction: null,
          reactionDelta: 0,
          candidateTopic: '東京・関東近郊のおでかけイベント特集',
          preview: '東京・関東近郊のおでかけイベント特集',
        }],
      });
      const candidate = makeCandidate({
        category: 'events',
        topic: '東京・関東近郊の春〜GWおでかけイベント',
      });
      expect(scoreNovelty(candidate, ctx)).toBe(0.0);
    });

    it('should not block different topic in same category after negative', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const ctx = makeCtx({
        recentHistory: [{
          category: 'golf',
          interestCategory: 'golf',
          sentAt: yesterday.toISOString(),
          reaction: '-1',
          reactionDelta: -3,
          preview: '多摩川ゴルフ倶楽部が4/29に丸ごとドッグランになるイベント',
        }],
      });
      const candidate = makeCandidate({
        category: 'golf',
        topic: 'Ping G740 Irons Review: Ideal for high handicappers',
      });
      // Different topic — should NOT be blocked by negative (daysSince >= 1 → 0.3)
      expect(scoreNovelty(candidate, ctx)).toBe(0.3);
    });
  });

  describe('scoreContinuity', () => {
    it('should return 0.9 when matching yesterday interestCategory', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const ctx = makeCtx({
        recentHistory: [
          { category: 'baseball', interestCategory: 'sports', sentAt: yesterday.toISOString(), reaction: 'positive', reactionDelta: 5 },
        ],
      });
      const candidate = makeCandidate({ category: 'sports' });
      expect(scoreContinuity(candidate, ctx)).toBe(0.9);
    });

    it('should return 0.9 for follow-up source', () => {
      const ctx = makeCtx();
      const candidate = makeCandidate({ source: 'follow-up' });
      expect(scoreContinuity(candidate, ctx)).toBe(0.9);
    });

    it('should return 0.3 baseline when no recent history match', () => {
      const ctx = makeCtx({ recentHistory: [] });
      const candidate = makeCandidate({ category: 'unknown' });
      expect(scoreContinuity(candidate, ctx)).toBe(0.3);
    });
  });

  describe('scoreEmotionalFit', () => {
    it('should return 0.9 for weekend + light', () => {
      const ctx = makeCtx({ dayOfWeek: 0 }); // Sunday
      const candidate = makeCandidate({ metadata: { emotion_type: 'light' } });
      expect(scoreEmotionalFit(candidate, ctx)).toBe(0.9);
    });

    it('should return 0.2 for weekend + heavy', () => {
      const ctx = makeCtx({ dayOfWeek: 6 }); // Saturday
      const candidate = makeCandidate({ metadata: { emotion_type: 'heavy' } });
      expect(scoreEmotionalFit(candidate, ctx)).toBe(0.2);
    });

    it('should return 0.7 for busy day + light', () => {
      const ctx = makeCtx({ calendarDensity: 2 });
      const candidate = makeCandidate({ metadata: { emotion_type: 'light' } });
      expect(scoreEmotionalFit(candidate, ctx)).toBe(0.7);
    });

    it('should return 0.3 for busy day + heavy', () => {
      const ctx = makeCtx({ calendarDensity: 2 });
      const candidate = makeCandidate({ metadata: { emotion_type: 'heavy' } });
      expect(scoreEmotionalFit(candidate, ctx)).toBe(0.3);
    });

    it('should return 0.9 for evening + light', () => {
      const ctx = makeCtx({ currentHour: 21 });
      const candidate = makeCandidate({ metadata: { emotion_type: 'light' } });
      expect(scoreEmotionalFit(candidate, ctx)).toBe(0.9);
    });

    it('should return 0.8 for morning + heavy', () => {
      const ctx = makeCtx({ currentHour: 9 });
      const candidate = makeCandidate({ metadata: { emotion_type: 'heavy' } });
      expect(scoreEmotionalFit(candidate, ctx)).toBe(0.8);
    });

    it('should return 0.5 for medium (default)', () => {
      const ctx = makeCtx();
      const candidate = makeCandidate({ metadata: { emotion_type: 'medium' } });
      expect(scoreEmotionalFit(candidate, ctx)).toBe(0.5);
    });

    it('should return 0.5 when no emotion_type', () => {
      const ctx = makeCtx();
      const candidate = makeCandidate();
      expect(scoreEmotionalFit(candidate, ctx)).toBe(0.5);
    });
  });

  describe('scoreAffinity', () => {
    it('should return 0.9 when 80%+ positive reactions', () => {
      const ctx = makeCtx({
        recentHistory: [
          { category: 'tech', sentAt: '2026-03-25', reaction: 'positive', reactionDelta: 5 },
          { category: 'tech', sentAt: '2026-03-24', reaction: 'positive', reactionDelta: 3 },
          { category: 'tech', sentAt: '2026-03-23', reaction: 'positive', reactionDelta: 7 },
          { category: 'tech', sentAt: '2026-03-22', reaction: 'positive', reactionDelta: 4 },
          { category: 'tech', sentAt: '2026-03-21', reaction: 'neutral', reactionDelta: 0 },
        ],
      });
      const candidate = makeCandidate({ category: 'tech' });
      expect(scoreAffinity(candidate, ctx)).toBe(0.9);
    });

    it('should return 0.7 when 50-80% positive reactions', () => {
      const ctx = makeCtx({
        recentHistory: [
          { category: 'tech', sentAt: '2026-03-25', reaction: 'positive', reactionDelta: 5 },
          { category: 'tech', sentAt: '2026-03-24', reaction: 'positive', reactionDelta: 3 },
          { category: 'tech', sentAt: '2026-03-23', reaction: 'neutral', reactionDelta: 0 },
          { category: 'tech', sentAt: '2026-03-22', reaction: null, reactionDelta: 0 },
        ],
      });
      const candidate = makeCandidate({ category: 'tech' });
      expect(scoreAffinity(candidate, ctx)).toBe(0.7);
    });

    it('should return 0.4 when <50% positive reactions', () => {
      const ctx = makeCtx({
        recentHistory: [
          { category: 'tech', sentAt: '2026-03-25', reaction: 'positive', reactionDelta: 5 },
          { category: 'tech', sentAt: '2026-03-24', reaction: 'negative', reactionDelta: -3 },
          { category: 'tech', sentAt: '2026-03-23', reaction: 'neutral', reactionDelta: 0 },
          { category: 'tech', sentAt: '2026-03-22', reaction: null, reactionDelta: 0 },
          { category: 'tech', sentAt: '2026-03-21', reaction: null, reactionDelta: 0 },
        ],
      });
      const candidate = makeCandidate({ category: 'tech' });
      expect(scoreAffinity(candidate, ctx)).toBe(0.4);
    });

    it('should return 0.4 when all reactions are null (ignored messages)', () => {
      const ctx = makeCtx({
        recentHistory: [
          { category: 'tech', sentAt: '2026-03-25', reaction: null, reactionDelta: 0 },
          { category: 'tech', sentAt: '2026-03-24', reaction: null, reactionDelta: 0 },
          { category: 'tech', sentAt: '2026-03-23', reaction: null, reactionDelta: 0 },
        ],
      });
      const candidate = makeCandidate({ category: 'tech' });
      // 0 positive / 3 total = 0.0 < 0.5 → 0.4
      expect(scoreAffinity(candidate, ctx)).toBe(0.4);
    });

    it('should return 0.5 when no data for category', () => {
      const ctx = makeCtx({ recentHistory: [] });
      const candidate = makeCandidate({ category: 'new-category' });
      expect(scoreAffinity(candidate, ctx)).toBe(0.5);
    });
  });

  describe('scoreSurprise', () => {
    it('should return 0.9 for _cross category', () => {
      const ctx = makeCtx();
      const candidate = makeCandidate({ category: '_cross' });
      expect(scoreSurprise(candidate, ctx)).toBe(0.9);
    });

    it('should return 0.8 for _wildcard category', () => {
      const ctx = makeCtx();
      const candidate = makeCandidate({ category: '_wildcard' });
      expect(scoreSurprise(candidate, ctx)).toBe(0.8);
    });

    it('should return 0.5+ for _discovery category (based on occurrences)', () => {
      const ctx = makeCtx({
        recentHistory: [
          { category: '_discovery', sentAt: '2026-03-25', reaction: 'positive', reactionDelta: 5 },
          { category: '_discovery', sentAt: '2026-03-24', reaction: 'positive', reactionDelta: 3 },
        ],
      });
      const candidate = makeCandidate({ category: '_discovery' });
      // 0.5 + min(2 * 0.1, 0.35) = 0.5 + 0.2 = 0.7
      expect(scoreSurprise(candidate, ctx)).toBeCloseTo(0.7, 2);
    });

    it('should cap _discovery bonus at 0.85', () => {
      const ctx = makeCtx({
        recentHistory: Array.from({ length: 10 }, (_, i) => ({
          category: '_discovery',
          sentAt: `2026-03-${15 + i}`,
          reaction: 'positive' as const,
          reactionDelta: 5,
        })),
      });
      const candidate = makeCandidate({ category: '_discovery' });
      // 0.5 + min(10 * 0.1, 0.35) = 0.5 + 0.35 = 0.85
      expect(scoreSurprise(candidate, ctx)).toBeCloseTo(0.85, 2);
    });

    it('should return 0.8 for cogmem source with isOneYearAgo', () => {
      const ctx = makeCtx();
      const candidate = makeCandidate({
        source: 'cogmem',
        category: 'memory',
        metadata: { isOneYearAgo: true },
      });
      expect(scoreSurprise(candidate, ctx)).toBe(0.8);
    });

    it('should return 0.7 for category not in recent history', () => {
      const ctx = makeCtx({
        recentHistory: [
          { category: 'tech', sentAt: '2026-03-25', reaction: null, reactionDelta: 0 },
        ],
      });
      const candidate = makeCandidate({ category: 'never-seen' });
      expect(scoreSurprise(candidate, ctx)).toBe(0.7);
    });

    it('should return 0.1 as default', () => {
      const ctx = makeCtx({
        recentHistory: [
          { category: 'tech', sentAt: '2026-03-25', reaction: null, reactionDelta: 0 },
        ],
      });
      const candidate = makeCandidate({ category: 'tech' });
      expect(scoreSurprise(candidate, ctx)).toBe(0.1);
    });
  });

  describe('getContextBonus', () => {
    it('should add timeliness +0.10 for morning (8-10)', () => {
      const ctx = makeCtx({ currentHour: 9 });
      const bonus = getContextBonus(ctx);
      expect(bonus.timeliness).toBe(0.10);
    });

    it('should add continuity +0.10 for recent send (<120min)', () => {
      const ctx = makeCtx({ lastSentMinutesAgo: 60 });
      const bonus = getContextBonus(ctx);
      expect(bonus.continuity).toBe(0.10);
    });

    it('should add surprise +0.15 for 3+ consecutive no reactions', () => {
      const ctx = makeCtx({ consecutiveNoReaction: 3 });
      const bonus = getContextBonus(ctx);
      expect(bonus.surprise).toBe(0.15);
    });

    it('should add emotional_fit +0.10 for weekend', () => {
      const ctx = makeCtx({ dayOfWeek: 0 }); // Sunday
      const bonus = getContextBonus(ctx);
      expect(bonus.emotional_fit).toBe(0.10);
    });

    it('should return all zeros when no conditions met', () => {
      const ctx = makeCtx({
        currentHour: 14,
        lastSentMinutesAgo: 300,
        consecutiveNoReaction: 0,
        dayOfWeek: 3,
      });
      const bonus = getContextBonus(ctx);
      expect(Object.values(bonus).every(v => v === 0)).toBe(true);
    });

    it('should combine multiple bonuses', () => {
      const ctx = makeCtx({
        currentHour: 9,
        dayOfWeek: 6, // Saturday
        lastSentMinutesAgo: 60,
        consecutiveNoReaction: 4,
      });
      const bonus = getContextBonus(ctx);
      expect(bonus.timeliness).toBe(0.10);
      expect(bonus.continuity).toBe(0.10);
      expect(bonus.surprise).toBe(0.15);
      expect(bonus.emotional_fit).toBe(0.10);
    });
  });

  describe('getDynamicWeights', () => {
    it('should return weights that sum to 1.0', () => {
      const state = createInitialLearningState();
      const ctx = makeCtx();
      const result = getDynamicWeights(state, ctx);
      const sum = Object.values(result.weights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 5);
    });

    it('should include sampledRaw and bonus in result', () => {
      const state = createInitialLearningState();
      const ctx = makeCtx();
      const result = getDynamicWeights(state, ctx);
      expect(result.sampledRaw).toBeDefined();
      expect(result.bonus).toBeDefined();
      expect(Object.keys(result.sampledRaw)).toHaveLength(6);
    });
  });

  describe('scoreCandidates', () => {
    it('should score and sort multiple candidates', () => {
      const state = createInitialLearningState();
      const ctx = makeCtx();
      const candidates = [
        makeCandidate({ topic: 'Old news', category: 'old', pub_date: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString() }),
        makeCandidate({ topic: 'Fresh news', category: 'fresh', pub_date: new Date().toISOString() }),
      ];
      const result = scoreCandidates(candidates, ctx, state);
      expect(result.candidates).toHaveLength(2);
      // Fresh should generally score higher
      expect(result.candidates[0].topic).toBe('Fresh news');
      expect(result.weightsUsed).toBeDefined();
    });

    it('should handle empty input', () => {
      const state = createInitialLearningState();
      const ctx = makeCtx();
      const result = scoreCandidates([], ctx, state);
      expect(result.candidates).toHaveLength(0);
    });

    it('should handle single candidate', () => {
      const state = createInitialLearningState();
      const ctx = makeCtx();
      const candidates = [makeCandidate({ topic: 'Only one' })];
      const result = scoreCandidates(candidates, ctx, state);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].scores).toBeDefined();
      expect(result.candidates[0].finalScore).toBeDefined();
      expect(result.candidates[0].reasoning).toBeDefined();
    });
  });

  describe('addExplorationBonus', () => {
    it('should add higher bonus for unknown category', () => {
      const state: LearningState = {
        ...createInitialLearningState(),
        totalSelections: 10,
        categorySelections: { tech: 5 },
      };
      const candidates: ScoredCandidate[] = [
        {
          ...makeCandidate({ category: 'unknown-cat' }),
          scores: { timeliness: 0.5, novelty: 0.5, continuity: 0.5, emotional_fit: 0.5, affinity: 0.5, surprise: 0.5 },
          finalScore: 0.5,
          reasoning: 'test',
        },
      ];
      const result = addExplorationBonus(candidates, state);
      // Unknown: EXPLORATION_COEFF * 2 = 0.3
      expect(result[0].explorationBonus).toBeCloseTo(0.3, 2);
    });

    it('should add UCB1 bonus for rarely selected category', () => {
      const state: LearningState = {
        ...createInitialLearningState(),
        totalSelections: 100,
        categorySelections: { rare: 1, common: 50 },
      };
      const candidates: ScoredCandidate[] = [
        {
          ...makeCandidate({ category: 'rare' }),
          scores: { timeliness: 0.5, novelty: 0.5, continuity: 0.5, emotional_fit: 0.5, affinity: 0.5, surprise: 0.5 },
          finalScore: 0.5,
          reasoning: 'test',
        },
        {
          ...makeCandidate({ category: 'common' }),
          scores: { timeliness: 0.5, novelty: 0.5, continuity: 0.5, emotional_fit: 0.5, affinity: 0.5, surprise: 0.5 },
          finalScore: 0.5,
          reasoning: 'test',
        },
      ];
      const result = addExplorationBonus(candidates, state);
      const rareBonus = result.find(c => c.category === 'rare')!.explorationBonus!;
      const commonBonus = result.find(c => c.category === 'common')!.explorationBonus!;
      expect(rareBonus).toBeGreaterThan(commonBonus);
    });

    it('should add extra bonus for discovery categories', () => {
      const state: LearningState = {
        ...createInitialLearningState(),
        totalSelections: 10,
        categorySelections: {},
      };
      const baseCandidates: ScoredCandidate[] = [
        {
          ...makeCandidate({ category: '_wildcard' }),
          scores: { timeliness: 0.5, novelty: 0.5, continuity: 0.5, emotional_fit: 0.5, affinity: 0.5, surprise: 0.5 },
          finalScore: 0.5,
          reasoning: 'test',
        },
        {
          ...makeCandidate({ category: '_cross' }),
          scores: { timeliness: 0.5, novelty: 0.5, continuity: 0.5, emotional_fit: 0.5, affinity: 0.5, surprise: 0.5 },
          finalScore: 0.5,
          reasoning: 'test',
        },
        {
          ...makeCandidate({ category: '_discovery' }),
          scores: { timeliness: 0.5, novelty: 0.5, continuity: 0.5, emotional_fit: 0.5, affinity: 0.5, surprise: 0.5 },
          finalScore: 0.5,
          reasoning: 'test',
        },
        {
          ...makeCandidate({ category: 'normal' }),
          scores: { timeliness: 0.5, novelty: 0.5, continuity: 0.5, emotional_fit: 0.5, affinity: 0.5, surprise: 0.5 },
          finalScore: 0.5,
          reasoning: 'test',
        },
      ];
      const result = addExplorationBonus(baseCandidates, state);
      const wildcardBonus = result.find(c => c.category === '_wildcard')!.explorationBonus!;
      const crossBonus = result.find(c => c.category === '_cross')!.explorationBonus!;
      const discoveryBonus = result.find(c => c.category === '_discovery')!.explorationBonus!;
      const normalBonus = result.find(c => c.category === 'normal')!.explorationBonus!;

      // All discovery categories should have higher bonus than normal
      expect(wildcardBonus).toBeGreaterThan(normalBonus);
      expect(crossBonus).toBeGreaterThan(normalBonus);
      expect(discoveryBonus).toBeGreaterThan(normalBonus);
    });

    it('should re-sort by selectionScore', () => {
      const state: LearningState = {
        ...createInitialLearningState(),
        totalSelections: 100,
        categorySelections: { high: 50, low: 1 },
      };
      const candidates: ScoredCandidate[] = [
        {
          ...makeCandidate({ category: 'high' }),
          scores: { timeliness: 0.9, novelty: 0.9, continuity: 0.9, emotional_fit: 0.9, affinity: 0.9, surprise: 0.9 },
          finalScore: 0.9,
          reasoning: 'test',
        },
        {
          ...makeCandidate({ category: 'low' }),
          scores: { timeliness: 0.8, novelty: 0.8, continuity: 0.8, emotional_fit: 0.8, affinity: 0.8, surprise: 0.8 },
          finalScore: 0.8,
          reasoning: 'test',
        },
      ];
      const result = addExplorationBonus(candidates, state);
      // Result should be sorted by selectionScore (finalScore + explorationBonus)
      expect(result[0].selectionScore).toBeGreaterThanOrEqual(result[1].selectionScore!);
    });

    it('should penalize over-concentrated categories', () => {
      const state: LearningState = {
        ...createInitialLearningState(),
        totalSelections: 14,
        categorySelections: { ai_agent: 11, business_strategy: 3 },
      };
      const candidates: ScoredCandidate[] = [
        {
          ...makeCandidate({ category: 'ai_agent' }),
          scores: { timeliness: 0.8, novelty: 1, continuity: 0.5, emotional_fit: 0.7, affinity: 0.7, surprise: 0.1 },
          finalScore: 0.80,
          reasoning: 'test',
        },
        {
          ...makeCandidate({ category: 'dodgers' }),
          scores: { timeliness: 0.9, novelty: 1, continuity: 0, emotional_fit: 0.5, affinity: 0.5, surprise: 0.7 },
          finalScore: 0.60,
          reasoning: 'test',
        },
      ];
      const result = addExplorationBonus(candidates, state);
      const aiAgent = result.find(c => c.category === 'ai_agent')!;
      const dodgers = result.find(c => c.category === 'dodgers')!;
      // ai_agent (79% concentration) should get penalized
      // dodgers (0 selections) should get exploration bonus
      // dodgers should be competitive despite lower finalScore
      expect(dodgers.selectionScore).toBeGreaterThan(aiAgent.selectionScore!);
    });
  });

  describe('generateFollowUpCandidates', () => {
    it('should generate candidates from yesterday messages', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const ctx = makeCtx({
        recentHistory: [
          {
            category: 'baseball',
            interestCategory: 'sports',
            sentAt: yesterday.toISOString(),
            reaction: 'positive',
            reactionDelta: 5,
          },
        ],
      });
      const candidates = generateFollowUpCandidates(ctx);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].source).toBe('follow-up');
    });

    it('should return empty array when no yesterday messages', () => {
      const ctx = makeCtx({ recentHistory: [] });
      const candidates = generateFollowUpCandidates(ctx);
      expect(candidates).toHaveLength(0);
    });

    it('should only include messages with positive reaction', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const ctx = makeCtx({
        recentHistory: [
          { category: 'tech', sentAt: yesterday.toISOString(), reaction: 'negative', reactionDelta: -3 },
          { category: 'baseball', sentAt: yesterday.toISOString(), reaction: 'positive', reactionDelta: 5 },
        ],
      });
      const candidates = generateFollowUpCandidates(ctx);
      expect(candidates.length).toBe(1);
      expect(candidates[0].category).toBe('baseball');
    });
  });

  describe('buildSupplementCandidatesFromCollectedData', () => {
    it('should extract gmail, calendar, and topic candidates', () => {
      const candidates = buildSupplementCandidatesFromCollectedData(JSON.stringify({
        gmail: {
          unread_important: [{
            id: 'msg-1',
            from: 'Boss <boss@example.com>',
            subject: '今日中に確認してほしい',
            snippet: '締切が近いよ',
            date: '2026-04-12T09:00:00+09:00',
          }],
        },
        calendar: {
          today: [{
            summary: '定例会議',
            start: '2026-04-12T10:00:00+09:00',
            end: '2026-04-12T10:30:00+09:00',
            location: '会議室A',
            calendar: 'Work',
          }],
          tomorrow: [],
        },
        topics: [{
          title: 'AIエージェントの最新動向',
          source: 'Google News',
          interest: 'ai',
        }],
      }));

      expect(candidates).toHaveLength(3);
      expect(candidates.map(c => c.source)).toEqual(['gmail', 'calendar', 'topic']);
      expect(candidates[0].category).toBe('email_reply');
      expect(candidates[1].category).toBe('meeting_prep');
      expect(candidates[2].category).toBe('ai_agent');
    });
  });

  describe('buildSupplementCandidatesFromMemoryContext', () => {
    it('should extract cogmem candidates from memory context', () => {
      const candidates = buildSupplementCandidatesFromMemoryContext(`
## 記憶から浮上した関連情報
- [2026-04-10] 大谷翔平のニュースを見ていた

## 去年の今頃
- [2025-04-12] AIエージェントの改善を進めていた
`);

      expect(candidates).toHaveLength(2);
      expect(candidates.every(c => c.source === 'cogmem')).toBe(true);
      expect(candidates[0].category).toBe('dodgers');
      expect(candidates[1].category).toBe('ai_agent');
    });
  });

  describe('scoreCandidatesWithBackfill', () => {
    it('should backfill from supplemental sources when primary candidates are all filtered out', () => {
      const today = new Date().toISOString();
      const ctx = makeCtx({
        todayMessages: [{
          time: '10:00',
          summary: 'tech news',
          source: 'interest-cache',
          topic: '既送信の技術話題',
          candidateId: 'topic:interest-cache:tech:既送信の技術話題',
        }],
        recentHistory: [{
          category: 'tech',
          sentAt: today,
          reaction: null,
          reactionDelta: 0,
        }],
      });

      const primary: RawCandidate[] = [{
        topic: '既送信の技術話題',
        source: 'interest-cache',
        category: 'tech',
        pub_date: null,
        metadata: {},
      }];
      const supplemental: RawCandidate[] = [{
        topic: 'AIエージェントの最新動向',
        source: 'topic',
        category: 'ai_agent',
        pub_date: null,
        metadata: {},
      }];

      const result = scoreCandidatesWithBackfill(primary, supplemental, ctx, createInitialLearningState());
      expect(result.usedBackfill).toBe(true);
      expect(result.viableCount).toBeGreaterThan(0);
      expect(result.candidates.some(c => c.topic === 'AIエージェントの最新動向')).toBe(true);
    });

    it('should backfill from cogmem when memory context has a novel candidate', () => {
      const ctx = makeCtx({
        todayMessages: [{
          time: '10:00',
          summary: 'tech news',
          source: 'interest-cache',
          topic: '既送信の技術話題',
          candidateId: 'topic:既送信の技術話題',
        }],
        recentHistory: [{
          category: 'tech',
          sentAt: new Date().toISOString(),
          reaction: null,
          reactionDelta: 0,
        }],
      });

      const primary: RawCandidate[] = [{
        topic: '既送信の技術話題',
        source: 'interest-cache',
        category: 'tech',
        pub_date: null,
        metadata: {},
      }];
      const supplemental: RawCandidate[] = [{
        topic: '温泉に行きたい',
        source: 'cogmem',
        category: 'onsen',
        pub_date: null,
        metadata: {},
      }];

      const result = scoreCandidatesWithBackfill(primary, supplemental, ctx, createInitialLearningState());
      expect(result.usedBackfill).toBe(true);
      expect(result.candidates.some(c => c.source === 'cogmem')).toBe(true);
    });
  });

  describe('buildReasoning', () => {
    it('should return a non-empty Japanese string', () => {
      const scores = {
        timeliness: 0.9,
        novelty: 0.7,
        continuity: 0.5,
        emotional_fit: 0.6,
        affinity: 0.8,
        surprise: 0.3,
      };
      const candidate = makeCandidate({ topic: 'テスト' });
      const reasoning = buildReasoning(candidate, scores);
      expect(reasoning.length).toBeGreaterThan(0);
      expect(typeof reasoning).toBe('string');
    });

    it('should mention the highest scoring axis', () => {
      const scores = {
        timeliness: 0.1,
        novelty: 0.1,
        continuity: 0.1,
        emotional_fit: 0.1,
        affinity: 0.1,
        surprise: 0.9,
      };
      const candidate = makeCandidate();
      const reasoning = buildReasoning(candidate, scores);
      // Should mention surprise-related term
      expect(reasoning).toMatch(/意外|サプライズ|驚き|surprise/i);
    });
  });
});
