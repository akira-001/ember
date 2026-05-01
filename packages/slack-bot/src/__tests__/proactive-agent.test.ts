import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { recordSharedSend } from '../shared-proactive-history';

// We'll test the pure logic functions extracted from ProactiveAgent
// Import will be added once we create the module
import {
  createDefaultState,
  loadState,
  saveState,
  isInCooldown,
  emojiToDelta,
  updateWeight,
  applyReaction,
  applyCooldown,
  detectTextSignal,
  pruneHistory,
  buildPrompt,
  parseResponse,
  parseDecisionLog,
  loadInsights,
  saveInsight,
  reinforceInsight,
  insightDecay,
  getActiveInsights,
  getEmbedding,
  cosineSimilarity,
  findSimilarInsight,
  MEI_SYSTEM_PROMPT,
  buildMeiContext,
  buildCronPrompt,
  buildCandidateId,
  extractInsightTag,
  resolveMessage,
  extractMessage,
  findSelectedCandidate,
  generateFallbackMessage,
  attachRequiredMovieUrl,
  type ProactiveState,
  type SuggestionHistoryEntry,
  type UserInsight,
  type MessageResolution,
  CATEGORIES,
  validateCandidateDedup,
} from '../proactive-state';

const TEST_STATE_PATH = join(__dirname, '../../data/test-state-proactive.json');
const SHARED_HISTORY_PATH = join(__dirname, '../../data/test-shared-history-proactive.json');

describe('ProactiveState', () => {
  beforeEach(() => {
    // Use isolated file paths to avoid race conditions with other test files
    process.env.SHARED_HISTORY_PATH = SHARED_HISTORY_PATH;
    if (existsSync(TEST_STATE_PATH)) {
      unlinkSync(TEST_STATE_PATH);
    }
    if (existsSync(SHARED_HISTORY_PATH)) {
      unlinkSync(SHARED_HISTORY_PATH);
    }
  });

  afterEach(() => {
    if (existsSync(TEST_STATE_PATH)) {
      unlinkSync(TEST_STATE_PATH);
    }
    if (existsSync(SHARED_HISTORY_PATH)) {
      unlinkSync(SHARED_HISTORY_PATH);
    }
    delete process.env.SHARED_HISTORY_PATH;
  });

  describe('createDefaultState', () => {
    it('should create state with all 8 categories at weight 1.0', () => {
      const state = createDefaultState();
      expect(Object.keys(state.categoryWeights)).toHaveLength(8);
      for (const cat of CATEGORIES) {
        expect(state.categoryWeights[cat]).toBe(1.0);
      }
    });

    it('should have empty cooldown', () => {
      const state = createDefaultState();
      expect(state.cooldown.until).toBeNull();
      expect(state.cooldown.consecutiveIgnores).toBe(0);
      expect(state.cooldown.backoffMinutes).toBe(0);
    });

    it('should have empty history and zero stats', () => {
      const state = createDefaultState();
      expect(state.history).toHaveLength(0);
      expect(state.stats.totalSent).toBe(0);
    });
  });

  describe('loadState / saveState', () => {
    it('should create default state if file does not exist', () => {
      const state = loadState(TEST_STATE_PATH);
      expect(state.categoryWeights.email_reply).toBe(1.0);
    });

    it('should save and reload state', () => {
      const state = createDefaultState();
      state.categoryWeights.email_reply = 1.5;
      state.stats.totalSent = 3;
      saveState(state, TEST_STATE_PATH);

      const loaded = loadState(TEST_STATE_PATH);
      expect(loaded.categoryWeights.email_reply).toBe(1.5);
      expect(loaded.stats.totalSent).toBe(3);
    });
  });

  describe('isInCooldown', () => {
    it('should return false when no cooldown is set', () => {
      const state = createDefaultState();
      expect(isInCooldown(state)).toBe(false);
    });

    it('should return true when cooldown is in the future', () => {
      const state = createDefaultState();
      state.cooldown.until = new Date(Date.now() + 60000).toISOString();
      expect(isInCooldown(state)).toBe(true);
    });

    it('should return false when cooldown has passed', () => {
      const state = createDefaultState();
      state.cooldown.until = new Date(Date.now() - 1000).toISOString();
      expect(isInCooldown(state)).toBe(false);
    });
  });

  describe('emojiToDelta', () => {
    it('should return positive delta for thumbsup', () => {
      expect(emojiToDelta('+1')).toBe(0.3);
      expect(emojiToDelta('thumbsup')).toBe(0.3);
    });

    it('should return high positive delta for heart', () => {
      expect(emojiToDelta('heart')).toBe(0.5);
      expect(emojiToDelta('heart_eyes')).toBe(0.5);
    });

    it('should return positive delta for check mark', () => {
      expect(emojiToDelta('white_check_mark')).toBe(0.4);
      expect(emojiToDelta('heavy_check_mark')).toBe(0.4);
    });

    it('should return positive delta for prayer', () => {
      expect(emojiToDelta('pray')).toBe(0.3);
      expect(emojiToDelta('raised_hands')).toBe(0.3);
    });

    it('should return negative delta for thumbsdown', () => {
      expect(emojiToDelta('-1')).toBe(-0.5);
      expect(emojiToDelta('thumbsdown')).toBe(-0.5);
    });

    it('should return strong negative for x', () => {
      expect(emojiToDelta('x')).toBe(-0.7);
      expect(emojiToDelta('no_entry_sign')).toBe(-0.7);
    });

    it('should return negative for clock emojis', () => {
      expect(emojiToDelta('clock1')).toBe(-0.3);
      expect(emojiToDelta('clock12')).toBe(-0.3);
      expect(emojiToDelta('hourglass')).toBe(-0.3);
      expect(emojiToDelta('hourglass_flowing_sand')).toBe(-0.3);
    });

    it('should return small positive for unknown emojis', () => {
      expect(emojiToDelta('smile')).toBe(0.1);
      expect(emojiToDelta('rocket')).toBe(0.1);
    });
  });

  describe('updateWeight', () => {
    it('should increase weight with positive delta', () => {
      expect(updateWeight(1.0, 0.3)).toBeCloseTo(1.03);
    });

    it('should decrease weight with negative delta', () => {
      expect(updateWeight(1.0, -0.5)).toBeCloseTo(0.95);
    });

    it('should clamp weight to max 2.0', () => {
      expect(updateWeight(1.99, 0.5)).toBe(2.0);
    });

    it('should clamp weight to min 0.05', () => {
      expect(updateWeight(0.06, -0.5)).toBe(0.05);
    });
  });

  describe('applyReaction', () => {
    it('should update category weight and reset cooldown on positive reaction', () => {
      const state = createDefaultState();
      state.cooldown.consecutiveIgnores = 3;
      state.cooldown.backoffMinutes = 240;
      const entry: SuggestionHistoryEntry = {
        id: 'test-1',
        category: 'email_reply',
        sentAt: new Date().toISOString(),
        slackTs: '123.456',
        slackChannel: 'D123',
        reaction: null,
        reactionDelta: 0,
      };
      state.history.push(entry);

      applyReaction(state, '123.456', 'heart');

      // categoryWeights frozen — learning moved to Thompson Sampling
      expect(state.categoryWeights.email_reply).toBeCloseTo(1.0);
      expect(state.cooldown.consecutiveIgnores).toBe(0);
      expect(state.cooldown.backoffMinutes).toBe(0);
      expect(state.stats.positiveReactions).toBe(1);
      expect(state.history[0].reaction).toBe('heart');
    });

    it('should increase cooldown on negative reaction', () => {
      const state = createDefaultState();
      const entry: SuggestionHistoryEntry = {
        id: 'test-1',
        category: 'meeting_prep',
        sentAt: new Date().toISOString(),
        slackTs: '123.456',
        slackChannel: 'D123',
        reaction: null,
        reactionDelta: 0,
      };
      state.history.push(entry);

      applyReaction(state, '123.456', 'thumbsdown');

      // categoryWeights frozen — learning moved to Thompson Sampling
      expect(state.categoryWeights.meeting_prep).toBeCloseTo(1.0);
      expect(state.cooldown.consecutiveIgnores).toBe(1);
      expect(state.cooldown.backoffMinutes).toBe(60);
      expect(state.stats.negativeReactions).toBe(1);
    });

    it('should set cooldown on clock emoji', () => {
      const state = createDefaultState();
      const entry: SuggestionHistoryEntry = {
        id: 'test-1',
        category: 'energy_break',
        sentAt: new Date().toISOString(),
        slackTs: '123.456',
        slackChannel: 'D123',
        reaction: null,
        reactionDelta: 0,
      };
      state.history.push(entry);

      applyReaction(state, '123.456', 'hourglass');

      expect(state.cooldown.until).not.toBeNull();
    });

    it('should do nothing if messageTs not found in history', () => {
      const state = createDefaultState();
      applyReaction(state, 'nonexistent', 'heart');
      expect(state.stats.positiveReactions).toBe(0);
    });
  });

  describe('detectTextSignal', () => {
    it('should detect busy signals', () => {
      expect(detectTextSignal('今忙しい')).toBe('busy');
      expect(detectTextSignal('後でみる')).toBe('busy');
      expect(detectTextSignal('あとでね')).toBe('busy');
      expect(detectTextSignal('今無理だわ')).toBe('busy');
    });

    it('should detect positive signals', () => {
      expect(detectTextSignal('ありがとう！')).toBe('positive');
      expect(detectTextSignal('助かるよ')).toBe('positive');
      expect(detectTextSignal('いいね')).toBe('positive');
    });

    it('should detect negative signals', () => {
      expect(detectTextSignal('いらない')).toBe('negative');
      expect(detectTextSignal('不要です')).toBe('negative');
      expect(detectTextSignal('やめて')).toBe('negative');
    });

    it('should return null for neutral text', () => {
      expect(detectTextSignal('了解')).toBeNull();
      expect(detectTextSignal('おはよう')).toBeNull();
    });
  });

  describe('MEI_SYSTEM_PROMPT', () => {
    it('should contain Mei character definition', () => {
      expect(MEI_SYSTEM_PROMPT).toContain('メイ');
      expect(MEI_SYSTEM_PROMPT).toContain('Akira');
    });

    it('should contain self-awareness constraint', () => {
      expect(MEI_SYSTEM_PROMPT).toContain('チャット上だけの存在');
    });

    it('should include accuracy guardrails for unverified movie URLs', () => {
      expect(MEI_SYSTEM_PROMPT).toContain('URLがないなら話題にしない');
    });
  });

  describe('buildMeiContext', () => {
    const TEST_INSIGHTS_CTX_PATH = join(__dirname, '../../data/test-mei-context.json');

    afterEach(() => {
      if (existsSync(TEST_INSIGHTS_CTX_PATH)) unlinkSync(TEST_INSIGHTS_CTX_PATH);
    });

    it('should return known insights as formatted text', () => {
      const insights: UserInsight[] = [
        { insight: '温泉が好き', learnedAt: new Date().toISOString(), source: '会話', arousal: 0.8, reinforceCount: 3 },
        { insight: 'Slack BOT開発中', learnedAt: new Date().toISOString(), source: '会話', arousal: 0.5, reinforceCount: 0 },
      ];
      writeFileSync(TEST_INSIGHTS_CTX_PATH, JSON.stringify(insights));

      const context = buildMeiContext(TEST_INSIGHTS_CTX_PATH);
      expect(context).toContain('温泉が好き');
      expect(context).toContain('Slack BOT開発中');
    });

    it('should return fallback text when no insights', () => {
      const context = buildMeiContext(TEST_INSIGHTS_CTX_PATH);
      expect(context).toContain('まだ');
    });
  });

  describe('buildCronPrompt', () => {
    it('should include collected data and category weights', () => {
      const state = createDefaultState();
      state.categoryWeights.email_reply = 1.5;
      const collectedData = '{"gmail": {"count": 3}}';
      const insights: UserInsight[] = [
        { insight: '温泉が好き', learnedAt: new Date().toISOString(), source: '会話', arousal: 0.8, reinforceCount: 1 },
      ];

      const prompt = buildCronPrompt(state, collectedData, insights);
      expect(prompt).toContain('email_reply');
      expect(prompt).toContain('1.5');
      expect(prompt).toContain('gmail');
      expect(prompt).toContain('NO_REPLY');
      expect(prompt).toContain('温泉が好き');
    });

    it('should require URL-backed movie candidates', () => {
      const withUrl = attachRequiredMovieUrl(
        '映画の話をひとつだけ。',
        [{ title: 'サルモクジ', url: 'https://example.com/movie', source: 'interest-cache' }],
        {
          topic: 'サルモクジ',
          source: 'interest-cache',
          category: 'movie_theater',
          metadata: { url: 'https://example.com/movie', mediaSource: 'interest-cache' },
        } as any,
      );
      expect(withUrl.text).toContain('https://example.com/movie');

      const withoutUrl = attachRequiredMovieUrl('映画の話をひとつだけ。', []);
      expect(withoutUrl.text).toBeNull();
    });
  });

  describe('extractInsightTag', () => {
    it('should extract insight from INSIGHT tag', () => {
      const text = 'いいね！温泉楽しんできてね。[INSIGHT: 温泉旅行が趣味]';
      expect(extractInsightTag(text)).toBe('温泉旅行が趣味');
    });

    it('should return null when no INSIGHT tag', () => {
      expect(extractInsightTag('普通の会話だよ')).toBeNull();
    });

    it('should strip INSIGHT tag from text', () => {
      const text = 'いいね！[INSIGHT: 温泉が好き]';
      const stripped = text.replace(/\[INSIGHT:\s*.+?\]/g, '').trim();
      expect(stripped).toBe('いいね！');
    });
  });

  describe('pruneHistory', () => {
    it('should keep only the most recent 100 entries', () => {
      const state = createDefaultState();
      for (let i = 0; i < 120; i++) {
        state.history.push({
          id: `test-${i}`,
          category: 'email_reply',
          sentAt: new Date(Date.now() + i * 1000).toISOString(),
          slackTs: `${i}.000`,
          slackChannel: 'D123',
          reaction: null,
          reactionDelta: 0,
        });
      }

      pruneHistory(state);

      expect(state.history).toHaveLength(100);
      expect(state.history[0].id).toBe('test-20');
      expect(state.history[99].id).toBe('test-119');
    });

    it('should not prune if under 100 entries', () => {
      const state = createDefaultState();
      state.history.push({
        id: 'test-1',
        category: 'email_reply',
        sentAt: new Date().toISOString(),
        slackTs: '1.000',
        slackChannel: 'D123',
        reaction: null,
        reactionDelta: 0,
      });

      pruneHistory(state);
      expect(state.history).toHaveLength(1);
    });
  });

  describe('buildPrompt', () => {
    it('should include current time and category weights', () => {
      const state = createDefaultState();
      state.categoryWeights.email_reply = 1.5;
      const collectedData = '{"gmail": {"count": 2}}';

      const prompt = buildPrompt(state, collectedData);

      expect(prompt).toContain('email_reply');
      expect(prompt).toContain('1.5');
      expect(prompt).toContain('gmail');
      expect(prompt).toContain('NO_REPLY');
    });

    it('should include reaction summary when history exists', () => {
      const state = createDefaultState();
      state.history.push({
        id: 'test-1',
        category: 'email_reply',
        sentAt: new Date().toISOString(),
        slackTs: '1.000',
        slackChannel: 'D123',
        reaction: 'heart',
        reactionDelta: 0.5,
      });

      const prompt = buildPrompt(state, '{}');

      expect(prompt).toContain('前回');
    });
  });

  describe('parseResponse', () => {
    it('should return null for NO_REPLY', () => {
      expect(parseResponse('NO_REPLY')).toBeNull();
      expect(parseResponse('NO_REPLY\n')).toBeNull();
      expect(parseResponse('  NO_REPLY  ')).toBeNull();
    });

    it('should return null for empty response', () => {
      expect(parseResponse('')).toBeNull();
      expect(parseResponse('  ')).toBeNull();
    });

    it('should return the text for actual suggestions', () => {
      const text = 'メール溜まってない？田中さんから来てたやつ、返した方がいいかも';
      expect(parseResponse(text)).toBe(text);
    });
  });

  describe('parseDecisionLog with Inner Thoughts schema', () => {
    it('extracts inner_thought / plan / generate_score / evaluate_score when present', () => {
      const json = JSON.stringify({
        decision: 'send',
        need: '充実',
        reason: 'ドジャース勝った',
        candidates: [{ topic: 'ドジャース', source: 'rss', score: 0.8 }],
        message: 'ドジャース勝ったよ',
        topicWeight: 'light',
        inner_thought: 'Akiraさんに伝えたい',
        plan: ['共有', '質問', '沈黙'],
        generate_score: [0.85, 0.5, 0.2],
        evaluate_score: 0.78,
      });
      const log = parseDecisionLog(json);
      expect(log).not.toBeNull();
      expect(log!.inner_thought).toBe('Akiraさんに伝えたい');
      expect(log!.plan).toEqual(['共有', '質問', '沈黙']);
      expect(log!.generate_score).toEqual([0.85, 0.5, 0.2]);
      expect(log!.evaluate_score).toBe(0.78);
    });

    it('returns undefined for new fields when LLM omits them (backward compat)', () => {
      const json = JSON.stringify({
        decision: 'no_reply',
        need: '何もしない',
        reason: '会議中',
        candidates: [],
        message: null,
        topicWeight: 'medium',
      });
      const log = parseDecisionLog(json);
      expect(log).not.toBeNull();
      expect(log!.inner_thought).toBeUndefined();
      expect(log!.plan).toBeUndefined();
      expect(log!.generate_score).toBeUndefined();
      expect(log!.evaluate_score).toBeUndefined();
    });

    it('filters out non-string entries from plan and non-numbers from generate_score', () => {
      const json = JSON.stringify({
        decision: 'send',
        need: '',
        reason: '',
        candidates: [],
        message: 'hi',
        topicWeight: 'light',
        plan: ['ok', 42, null, 'good'],
        generate_score: [0.5, 'NaN', 0.7],
        evaluate_score: 'not a number',
      });
      const log = parseDecisionLog(json);
      expect(log!.plan).toEqual(['ok', 'good']);
      expect(log!.generate_score).toEqual([0.5, 0.7]);
      expect(log!.evaluate_score).toBeUndefined();
    });
  });

  describe('applyCooldown', () => {
    it('should set cooldown based on backoff minutes', () => {
      const state = createDefaultState();
      state.cooldown.backoffMinutes = 120;

      applyCooldown(state);

      expect(state.cooldown.until).not.toBeNull();
      const until = new Date(state.cooldown.until!);
      const expected = new Date(Date.now() + 120 * 60 * 1000);
      expect(Math.abs(until.getTime() - expected.getTime())).toBeLessThan(2000);
    });

    it('should not set cooldown when backoff is 0', () => {
      const state = createDefaultState();
      state.cooldown.backoffMinutes = 0;

      applyCooldown(state);

      expect(state.cooldown.until).toBeNull();
    });
  });

  describe('User Insights', () => {
    const TEST_INSIGHTS_PATH = join(__dirname, '../../data/test-user-insights.json');

    beforeEach(() => {
      if (existsSync(TEST_INSIGHTS_PATH)) unlinkSync(TEST_INSIGHTS_PATH);
    });

    afterEach(() => {
      if (existsSync(TEST_INSIGHTS_PATH)) unlinkSync(TEST_INSIGHTS_PATH);
    });

    describe('loadInsights', () => {
      it('should return empty array when file does not exist', () => {
        const insights = loadInsights(TEST_INSIGHTS_PATH);
        expect(insights).toEqual([]);
      });

      it('should load saved insights', () => {
        const data: UserInsight[] = [
          { insight: '温泉が好き', learnedAt: '2026-03-22T09:00:00Z', source: '会話', arousal: 0.5, reinforceCount: 0 },
        ];
        writeFileSync(TEST_INSIGHTS_PATH, JSON.stringify(data));

        const insights = loadInsights(TEST_INSIGHTS_PATH);
        expect(insights).toHaveLength(1);
        expect(insights[0].insight).toBe('温泉が好き');
      });
    });

    describe('saveInsight', () => {
      it('should append a new insight', () => {
        saveInsight(TEST_INSIGHTS_PATH, '温泉が好き');

        const insights = loadInsights(TEST_INSIGHTS_PATH);
        expect(insights).toHaveLength(1);
        expect(insights[0].insight).toBe('温泉が好き');
        expect(insights[0].source).toBe('会話');
        expect(insights[0].learnedAt).toBeTruthy();
      });

      it('should append without overwriting existing insights', () => {
        saveInsight(TEST_INSIGHTS_PATH, '温泉が好き');
        saveInsight(TEST_INSIGHTS_PATH, 'Slack BOT を開発中');

        const insights = loadInsights(TEST_INSIGHTS_PATH);
        expect(insights).toHaveLength(2);
        expect(insights[0].insight).toBe('温泉が好き');
        expect(insights[1].insight).toBe('Slack BOT を開発中');
      });

      it('should not save duplicate insights', () => {
        saveInsight(TEST_INSIGHTS_PATH, '温泉が好き');
        saveInsight(TEST_INSIGHTS_PATH, '温泉が好き');

        const insights = loadInsights(TEST_INSIGHTS_PATH);
        expect(insights).toHaveLength(1);
      });
    });

    describe('buildPrompt with insights', () => {
      it('should include user insights when available', () => {
        const state = createDefaultState();
        const insights: UserInsight[] = [
          { insight: '温泉が好き', learnedAt: '2026-03-22T09:00:00Z', source: '会話', arousal: 0.5, reinforceCount: 0 },
          { insight: 'キャンプに興味あり', learnedAt: '2026-03-22T10:00:00Z', source: '会話', arousal: 0.5, reinforceCount: 0 },
        ];

        const prompt = buildPrompt(state, '{}', insights);

        expect(prompt).toContain('温泉が好き');
        expect(prompt).toContain('キャンプに興味あり');
      });
    });

    describe('insightDecay', () => {
      it('should return 1.0 for today', () => {
        expect(insightDecay(new Date().toISOString(), 0.5)).toBeCloseTo(1.0);
      });

      it('should decay slower with high arousal', () => {
        const date90daysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
        const highArousal = insightDecay(date90daysAgo, 0.9);
        const lowArousal = insightDecay(date90daysAgo, 0.2);
        expect(highArousal).toBeGreaterThan(lowArousal);
      });

      it('should not decay below floor (0.3)', () => {
        const veryOld = new Date(Date.now() - 365 * 86400000).toISOString();
        expect(insightDecay(veryOld, 0.1)).toBeGreaterThanOrEqual(0.3);
      });
    });

    describe('reinforceInsight', () => {
      it('should increase arousal when insight is mentioned again', () => {
        saveInsight(TEST_INSIGHTS_PATH, '温泉が好き');
        const before = loadInsights(TEST_INSIGHTS_PATH);
        const arousalBefore = before[0].arousal;

        reinforceInsight(TEST_INSIGHTS_PATH, '温泉が好き');

        const after = loadInsights(TEST_INSIGHTS_PATH);
        expect(after[0].arousal).toBeGreaterThan(arousalBefore);
        expect(after[0].reinforceCount).toBe(1);
      });

      it('should cap arousal at 1.0', () => {
        saveInsight(TEST_INSIGHTS_PATH, '温泉が好き');
        // Reinforce many times
        for (let i = 0; i < 20; i++) {
          reinforceInsight(TEST_INSIGHTS_PATH, '温泉が好き');
        }
        const insights = loadInsights(TEST_INSIGHTS_PATH);
        expect(insights[0].arousal).toBeLessThanOrEqual(1.0);
      });
    });

    describe('getActiveInsights', () => {
      it('should filter out decayed insights below threshold', () => {
        const insights: UserInsight[] = [
          { insight: '温泉が好き', learnedAt: new Date().toISOString(), source: '会話', arousal: 0.8, reinforceCount: 3 },
          { insight: '古い趣味', learnedAt: new Date(Date.now() - 300 * 86400000).toISOString(), source: '会話', arousal: 0.1, reinforceCount: 0 },
        ];
        writeFileSync(TEST_INSIGHTS_PATH, JSON.stringify(insights));

        const active = getActiveInsights(TEST_INSIGHTS_PATH);
        expect(active.length).toBeLessThanOrEqual(insights.length);
        // Recent high-arousal should survive
        expect(active.some(i => i.insight === '温泉が好き')).toBe(true);
      });

      it('should sort by effective score (arousal × decay)', () => {
        const insights: UserInsight[] = [
          { insight: '低重要度', learnedAt: new Date(Date.now() - 100 * 86400000).toISOString(), source: '会話', arousal: 0.2, reinforceCount: 0 },
          { insight: '高重要度', learnedAt: new Date().toISOString(), source: '会話', arousal: 0.9, reinforceCount: 5 },
        ];
        writeFileSync(TEST_INSIGHTS_PATH, JSON.stringify(insights));

        const active = getActiveInsights(TEST_INSIGHTS_PATH);
        expect(active[0].insight).toBe('高重要度');
      });
    });

    describe('Embedding & Semantic Matching', () => {
      it('getEmbedding should return a number array', async () => {
        const vec = await getEmbedding('温泉が好き');
        expect(Array.isArray(vec)).toBe(true);
        expect(vec.length).toBeGreaterThan(0);
        expect(typeof vec[0]).toBe('number');
      });

      it('cosineSimilarity should return 1.0 for identical vectors', () => {
        const v = [1, 2, 3];
        expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
      });

      it('cosineSimilarity should return ~0 for orthogonal vectors', () => {
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
      });

      it('similar insights should have high cosine similarity', async () => {
        const v1 = await getEmbedding('温泉が好き');
        const v2 = await getEmbedding('温泉に行くのが趣味');
        const sim = cosineSimilarity(v1, v2);
        expect(sim).toBeGreaterThan(0.8);
      });

      it('unrelated insights should have lower cosine similarity than similar ones', async () => {
        const vOnsen = await getEmbedding('温泉が好き');
        const vOnsen2 = await getEmbedding('温泉に行くのが趣味');
        const vProg = await getEmbedding('プログラミングの仕事をしている');
        const simSimilar = cosineSimilarity(vOnsen, vOnsen2);
        const simUnrelated = cosineSimilarity(vOnsen, vProg);
        // Similar should be higher than unrelated
        expect(simSimilar).toBeGreaterThan(simUnrelated);
        // Unrelated should be below threshold (0.88)
        expect(simUnrelated).toBeLessThan(0.88);
      });

      it('findSimilarInsight should find semantically similar match', async () => {
        const insights: UserInsight[] = [
          { insight: '温泉が好き', learnedAt: new Date().toISOString(), source: '会話', arousal: 0.5, reinforceCount: 0, embedding: await getEmbedding('温泉が好き') },
        ];
        writeFileSync(TEST_INSIGHTS_PATH, JSON.stringify(insights));

        const match = await findSimilarInsight(TEST_INSIGHTS_PATH, '温泉に行くのが趣味');
        expect(match).not.toBeNull();
        expect(match!.insight).toBe('温泉が好き');
      });

      it('findSimilarInsight should return null for unrelated text', async () => {
        const insights: UserInsight[] = [
          { insight: '温泉が好き', learnedAt: new Date().toISOString(), source: '会話', arousal: 0.5, reinforceCount: 0, embedding: await getEmbedding('温泉が好き') },
        ];
        writeFileSync(TEST_INSIGHTS_PATH, JSON.stringify(insights));

        const match = await findSimilarInsight(TEST_INSIGHTS_PATH, 'プログラミングの仕事をしている');
        expect(match).toBeNull();
      });
    });
  });
});

// --- Task 2: buildSourceUrlsFromCandidates tests ---
import { buildSourceUrlsFromCandidates } from '../proactive-state';

describe('buildSourceUrlsFromCandidates', () => {
  it('should extract URLs from scored candidates metadata', () => {
    const candidates = [
      {
        topic: 'Article A',
        source: 'interest-cache' as const,
        category: 'ai_agent',
        pub_date: null,
        metadata: { url: 'https://example.com/a', mediaSource: 'TechCrunch' },
        scores: { timeliness: 1, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
        finalScore: 0.9,
        reasoning: '',
      },
      {
        topic: 'Article B',
        source: 'interest-cache' as const,
        category: 'dodgers',
        pub_date: null,
        metadata: { url: 'https://example.com/b', mediaSource: 'MLB.com' },
        scores: { timeliness: 0.5, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
        finalScore: 0.7,
        reasoning: '',
      },
    ];
    const result = buildSourceUrlsFromCandidates(candidates);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      title: 'Article A',
      url: 'https://example.com/a',
      source: 'TechCrunch',
      candidateId: 'url:https://example.com/a',
      category: 'ai_agent',
    });
    expect(result[1]).toEqual({
      title: 'Article B',
      url: 'https://example.com/b',
      source: 'MLB.com',
      candidateId: 'url:https://example.com/b',
      category: 'dodgers',
    });
  });

  it('should skip candidates without URL', () => {
    const candidates = [
      {
        topic: 'No URL item',
        source: 'calendar' as const,
        category: 'meeting_prep',
        pub_date: null,
        metadata: {},
        scores: { timeliness: 1, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
        finalScore: 0.8,
        reasoning: '',
      },
    ];
    const result = buildSourceUrlsFromCandidates(candidates);
    expect(result).toHaveLength(0);
  });

  it('should deduplicate by URL', () => {
    const candidates = [
      {
        topic: 'Same Article',
        source: 'interest-cache' as const,
        category: 'ai_agent',
        pub_date: null,
        metadata: { url: 'https://example.com/same', mediaSource: 'Source' },
        scores: { timeliness: 1, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
        finalScore: 0.9,
        reasoning: '',
      },
      {
        topic: 'Same Article Duplicate',
        source: 'interest-cache' as const,
        category: 'ai_agent',
        pub_date: null,
        metadata: { url: 'https://example.com/same', mediaSource: 'Source' },
        scores: { timeliness: 0.5, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
        finalScore: 0.7,
        reasoning: '',
      },
    ];
    const result = buildSourceUrlsFromCandidates(candidates);
    expect(result).toHaveLength(1);
  });

  it('should deduplicate by normalized URL', () => {
    const candidates = [
      {
        topic: 'Same Article',
        source: 'interest-cache' as const,
        category: 'ai_agent',
        pub_date: null,
        metadata: { url: 'https://example.com/same?utm_source=newsletter#section', mediaSource: 'Source' },
        scores: { timeliness: 1, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
        finalScore: 0.9,
        reasoning: '',
      },
      {
        topic: 'Same Article Duplicate',
        source: 'interest-cache' as const,
        category: 'ai_agent',
        pub_date: null,
        metadata: { url: 'https://example.com/same', mediaSource: 'Source' },
        scores: { timeliness: 0.5, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
        finalScore: 0.7,
        reasoning: '',
      },
    ];
    const result = buildSourceUrlsFromCandidates(candidates);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://example.com/same');
  });
});

// --- Task 3: validateCandidateSelection tests ---
import { validateCandidateSelection } from '../proactive-state';

describe('validateCandidateSelection', () => {
  const scoredCandidates = [
    { topic: 'ドジャース開幕戦勝利', source: 'interest-cache', finalScore: 0.9 },
    { topic: 'インパクト投資レポート', source: 'interest-cache', finalScore: 0.8 },
  ] as any[];

  it('should return valid when LLM candidate matches scored candidate', () => {
    const llmCandidates = [{ topic: 'ドジャース開幕戦勝利', source: 'interest-cache', score: 0.9 }];
    const result = validateCandidateSelection(llmCandidates, scoredCandidates);
    expect(result.valid).toBe(true);
  });

  it('should return valid for partial topic match (substring)', () => {
    const llmCandidates = [{ topic: 'ドジャース開幕戦', source: 'interest-cache', score: 0.9 }];
    const result = validateCandidateSelection(llmCandidates, scoredCandidates);
    expect(result.valid).toBe(true);
  });

  it('should return invalid when LLM candidate has no match', () => {
    const llmCandidates = [{ topic: '企業価値創造の新潮流', source: 'interest-cache', score: 0.81 }];
    const result = validateCandidateSelection(llmCandidates, scoredCandidates);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('企業価値創造の新潮流');
  });

  it('should return valid when no LLM candidates (NO_REPLY)', () => {
    const result = validateCandidateSelection([], scoredCandidates);
    expect(result.valid).toBe(true);
  });

  it('should return valid for word-overlap match (LLM rephrased title)', () => {
    const candidates = [
      { topic: "The Week's 10 Biggest Funding Rounds: Largest Financings Went to Defense", source: 'interest-cache', finalScore: 0.67 },
    ] as any[];
    const llmCandidates = [{ topic: "Week's Biggest Funding Rounds（Defense/Wearables/Energy）", source: 'interest-cache', score: 0.67 }];
    const result = validateCandidateSelection(llmCandidates, candidates);
    expect(result.valid).toBe(true);
  });
});

  describe('candidate identity dedup', () => {
  beforeEach(() => {
    process.env.SHARED_HISTORY_PATH = SHARED_HISTORY_PATH;
    if (existsSync(SHARED_HISTORY_PATH)) unlinkSync(SHARED_HISTORY_PATH);
  });

  afterEach(() => {
    if (existsSync(SHARED_HISTORY_PATH)) unlinkSync(SHARED_HISTORY_PATH);
    delete process.env.SHARED_HISTORY_PATH;
  });

  const scoredCandidates = [
    {
      topic: 'ニコンのカメラ、月の裏側へ',
      source: 'interest-cache',
      category: 'space',
      pub_date: null,
      metadata: { url: 'https://example.com/nikon-moon', mediaSource: 'ITmedia' },
      scores: { timeliness: 0.9, novelty: 1, continuity: 0.2, emotional_fit: 0.5, affinity: 0.4, surprise: 0.7 },
      finalScore: 0.88,
      reasoning: '',
    },
  ] as any[];

  it('should build stable candidate id from URL when present', () => {
    const id = buildCandidateId(scoredCandidates[0]);
    expect(id).toBe('url:https://example.com/nikon-moon');
  });

  it('should find the selected scored candidate from LLM output', () => {
    const selected = findSelectedCandidate(
      [{ topic: 'ニコンのカメラ、月の裏側へ', source: 'interest-cache', score: 0.88 }],
      scoredCandidates,
    );
    expect(selected?.topic).toContain('ニコン');
  });

  it('should reject duplicate candidate already sent today', () => {
    const state = createDefaultState();
    state.todayDate = new Date().toISOString().slice(0, 10);
    state.todayMessages = [{
      time: '12:00',
      summary: 'ニコンのカメラ、月の裏側へ',
      source: 'interest-cache',
      interestCategory: 'space',
      topic: 'ニコンのカメラ、月の裏側へ',
      url: 'https://example.com/nikon-moon',
      candidateId: 'url:https://example.com/nikon-moon',
    }];

    const result = validateCandidateDedup(
      [{ topic: 'ニコンのカメラ、月の裏側へ', source: 'interest-cache', score: 0.88 }],
      scoredCandidates,
      state,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('already sent today');
  });

  it('should reject duplicate candidate when URL only differs by tracking parameters', () => {
    const state = createDefaultState();
    state.todayDate = new Date().toISOString().slice(0, 10);
    state.todayMessages = [{
      time: '12:00',
      summary: 'ニコンのカメラ、月の裏側へ',
      source: 'interest-cache',
      interestCategory: 'space',
      topic: 'ニコンのカメラ、月の裏側へ',
      url: 'https://example.com/nikon-moon',
      candidateId: 'url:https://example.com/nikon-moon',
    }];

    const candidates = [{
      topic: 'ニコンのカメラ、月の裏側へ',
      source: 'interest-cache',
      category: 'space',
      pub_date: null,
      metadata: { url: 'https://example.com/nikon-moon?utm_source=feed#top' },
      scores: { timeliness: 0.9, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
      finalScore: 0.88,
      reasoning: '',
    }] as any[];

    const result = validateCandidateDedup(
      [{ topic: 'ニコンのカメラ、月の裏側へ', source: 'interest-cache', score: 0.88 }],
      candidates,
      state,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('already sent today');
  });

  it('should suppress duplicate candidate in resolveMessage', () => {
    const state = createDefaultState();
    state.lastScoredCandidates = scoredCandidates;
    state.todayDate = new Date().toISOString().slice(0, 10);
    state.todayMessages = [{
      time: '12:00',
      summary: 'ニコンのカメラ、月の裏側へ',
      source: 'interest-cache',
      topic: 'ニコンのカメラ、月の裏側へ',
      url: 'https://example.com/nikon-moon',
      candidateId: 'url:https://example.com/nikon-moon',
    }];

    const response = JSON.stringify({
      premise: {
        estimatedMode: '探索モード・高エネルギー',
        modeReason: '新着ニュース',
        targetLayer: 4,
        layerReason: '趣味',
        interventionType: '情報提供',
        interventionReason: '宇宙ニュース',
        reason: '面白い話題',
      },
      decision: 'send',
      need: '好奇心',
      reason: 'ニコン記事',
      candidates: [{ topic: 'ニコンのカメラ、月の裏側へ', source: 'interest-cache', score: 0.88 }],
      message: 'ニコンの話題だよ',
    });

    const result = resolveMessage(response, state, 'mei');
    expect(result.action).toBe('skip');
    expect(result.warnings[0]).toContain('already sent today');
  });

  it('should suppress a paraphrased duplicate candidate in resolveMessage', () => {
    const state = createDefaultState();
    state.lastScoredCandidates = [{
      topic: 'アルテミスII計画の宇宙飛行士が撮影した地球写真',
      source: 'interest-cache',
      category: 'space',
      pub_date: null,
      metadata: {},
      scores: { timeliness: 0.9, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
      finalScore: 0.88,
      reasoning: '',
    } as any];
    state.todayDate = new Date().toISOString().slice(0, 10);
    state.history.push({
      id: 'history-1',
      category: 'flashback',
      sentAt: '2026-04-11T10:00:00.000Z',
      slackTs: '123.456',
      slackChannel: 'D123',
      reaction: null,
      reactionDelta: 0,
      candidateTopic: 'アルテミスII計画 宇宙飛行士の地球写真',
      preview: 'アルテミスII計画 宇宙飛行士の地球写真',
    } as any);

    const response = JSON.stringify({
      premise: {
        estimatedMode: '探索モード・高エネルギー',
        modeReason: '新着ニュース',
        targetLayer: 4,
        layerReason: '趣味',
        interventionType: '情報提供',
        interventionReason: '宇宙ニュース',
        reason: '面白い話題',
      },
      decision: 'send',
      need: '好奇心',
      reason: '宇宙記事',
      candidates: [{ topic: 'アルテミスII計画の宇宙飛行士が撮影した地球写真', source: 'interest-cache', score: 0.88 }],
      message: '宇宙の話題だよ',
    });

    const result = resolveMessage(response, state, 'mei');
    expect(result.action).toBe('skip');
    // No URL in candidate — reason is topic-source based
    expect(result.warnings[0]).toContain('already sent with the same source');
  });

  it('should suppress a candidate seen in another bot shared history', () => {
    recordSharedSend({
      botId: 'eve',
      botName: 'イヴ',
      category: 'flashback',
      preview: 'アルテミスII計画 宇宙飛行士の地球写真',
      topic: 'アルテミスII計画 宇宙飛行士の地球写真',
    });

    const state = createDefaultState();
    state.lastScoredCandidates = [{
      topic: 'アルテミスII計画の宇宙飛行士が撮影した地球写真',
      source: 'interest-cache',
      category: 'space',
      pub_date: null,
      metadata: {},
      scores: { timeliness: 0.9, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
      finalScore: 0.88,
      reasoning: '',
    } as any];

    const response = JSON.stringify({
      decision: 'send',
      need: '好奇心',
      reason: '宇宙記事',
      candidates: [{ topic: 'アルテミスII計画の宇宙飛行士が撮影した地球写真', source: 'interest-cache', score: 0.88 }],
      message: '宇宙の話題だよ',
    });

    const result = resolveMessage(response, state, 'mei');
    expect(result.action).toBe('skip');
    // No URL in candidate — reason is topic-source based (same as duplicateHistory/duplicateSharedHistory without URL)
    expect(result.warnings[0]).toContain('already sent with the same source');
  });

  it('should suppress a candidate when the same URL already exists in history', () => {
    const state = createDefaultState();
    state.lastScoredCandidates = [{
      topic: '別タイトルの宇宙写真',
      source: 'interest-cache',
      category: 'space',
      pub_date: null,
      metadata: { url: 'https://example.com/space-article' },
      scores: { timeliness: 0.9, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
      finalScore: 0.88,
      reasoning: '',
    } as any];
    state.history.push({
      id: 'history-1',
      category: 'flashback',
      sentAt: '2026-04-11T10:00:00.000Z',
      slackTs: '123.456',
      slackChannel: 'D123',
      reaction: null,
      reactionDelta: 0,
      preview: '別の言い回しの宇宙写真',
      sourceUrls: [{ title: '別の言い回しの宇宙写真', url: 'https://example.com/space-article', source: 'Example' }],
      candidateId: 'url:https://example.com/space-article',
      candidateUrl: 'https://example.com/space-article',
    } as any);

    const response = JSON.stringify({
      decision: 'send',
      need: '好奇心',
      reason: '宇宙記事',
      candidates: [{ topic: '別タイトルの宇宙写真', source: 'interest-cache', score: 0.88 }],
      message: '宇宙の話題だよ',
    });

    const result = resolveMessage(response, state, 'mei');
    expect(result.action).toBe('skip');
    expect(result.warnings[0]).toContain('already exists in proactive history');
  });

  it('should suppress a paraphrased candidate seen in another bot shared history', () => {
    recordSharedSend({
      botId: 'eve',
      botName: 'イヴ',
      category: 'flashback',
      preview: '東京・関東近郊のおでかけイベント特集',
      topic: '東京・関東近郊のおでかけイベント特集',
    });

    const state = createDefaultState();
    state.lastScoredCandidates = [{
      topic: '東京・関東近郊の春〜GWおでかけイベント',
      source: 'interest-cache',
      category: 'events',
      pub_date: null,
      metadata: {},
      scores: { timeliness: 0.9, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
      finalScore: 0.88,
      reasoning: '',
    } as any];

    const response = JSON.stringify({
      decision: 'send',
      need: '充実',
      reason: 'おでかけ記事',
      candidates: [{ topic: '東京・関東近郊の春〜GWおでかけイベント', source: 'interest-cache', score: 0.88 }],
      message: 'おでかけイベントだよ',
    });

    const result = resolveMessage(response, state, 'mei');
    expect(result.action).toBe('skip');
    // No URL in candidate — reason is topic-source based
    expect(result.warnings[0]).toContain('already sent with the same source');
  });

  it('should suppress a candidate when the same URL exists in other bot shared history', () => {
    recordSharedSend({
      botId: 'eve',
      botName: 'イヴ',
      category: 'flashback',
      preview: '別の言い回しの宇宙写真',
      topic: '別の言い回しの宇宙写真',
      url: 'https://example.com/shared-space-article',
      candidateId: 'url:https://example.com/shared-space-article',
    });

    const state = createDefaultState();
    state.lastScoredCandidates = [{
      topic: '別タイトルの宇宙写真',
      source: 'interest-cache',
      category: 'space',
      pub_date: null,
      metadata: { url: 'https://example.com/shared-space-article' },
      scores: { timeliness: 0.9, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
      finalScore: 0.88,
      reasoning: '',
    } as any];

    const response = JSON.stringify({
      decision: 'send',
      need: '好奇心',
      reason: '宇宙記事',
      candidates: [{ topic: '別タイトルの宇宙写真', source: 'interest-cache', score: 0.88 }],
      message: '宇宙の話題だよ',
    });

    const result = resolveMessage(response, state, 'mei');
    expect(result.action).toBe('skip');
    expect(result.warnings[0]).toContain('other bot history');
  });

  it('should ignore stale other bot history outside the dedup window', () => {
    writeFileSync(SHARED_HISTORY_PATH, JSON.stringify({
      entries: [{
        botId: 'eve',
        botName: 'イヴ',
        sentAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
        category: 'flashback',
        preview: 'アルテミスII計画 宇宙飛行士の地球写真',
        topic: 'アルテミスII計画 宇宙飛行士の地球写真',
      }],
    }, null, 2));

    const state = createDefaultState();
    state.lastScoredCandidates = [{
      topic: 'アルテミスII計画の宇宙飛行士が撮影した地球写真',
      source: 'interest-cache',
      category: 'space',
      pub_date: null,
      metadata: {},
      scores: { timeliness: 0.9, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
      finalScore: 0.88,
      reasoning: '',
    } as any];

    const response = JSON.stringify({
      decision: 'send',
      need: '好奇心',
      reason: '宇宙記事',
      candidates: [{ topic: 'アルテミスII計画の宇宙飛行士が撮影した地球写真', source: 'interest-cache', score: 0.88 }],
      message: '宇宙の話題だよ',
    });

    const result = resolveMessage(response, state, 'mei');
    expect(result.action).toBe('send');
  });
});

// --- Task 1: buildScoredCandidatesSection tests ---
import { buildScoredCandidatesSection } from '../proactive-state';
import { type ScoredCandidate } from '../conversation-scorer';

describe('buildScoredCandidatesSection', () => {
  const makeCandidate = (overrides: Partial<ScoredCandidate> = {}): ScoredCandidate => ({
    topic: '【グローバル企業向けレポート公開】企業価値創造の新潮流としてのインパクト投資',
    source: 'interest-cache',
    category: 'business_strategy',
    pub_date: '2026-04-04T10:00:00Z',
    metadata: { url: 'https://example.com/report', mediaSource: 'PR TIMES' },
    scores: { timeliness: 0.8, novelty: 1.0, continuity: 0.5, emotional_fit: 0.7, affinity: 0.6, surprise: 0.3 },
    finalScore: 0.81,
    reasoning: 'test',
    ...overrides,
  });

  it('should show full topic title without truncation', () => {
    const state = { lastScoredCandidates: [makeCandidate()] } as any;
    const result = buildScoredCandidatesSection(state);
    expect(result).toContain('企業価値創造の新潮流としてのインパクト投資');
  });

  it('should include URL for interest-cache articles', () => {
    const state = { lastScoredCandidates: [makeCandidate()] } as any;
    const result = buildScoredCandidatesSection(state);
    expect(result).toContain('https://example.com/report');
  });

  it('should return empty string when no candidates', () => {
    const state = { lastScoredCandidates: [] } as any;
    const result = buildScoredCandidatesSection(state);
    expect(result).toBe('');
  });

  it('should recommend NO_REPLY when all novelty=0', () => {
    const state = {
      lastScoredCandidates: [makeCandidate({
        scores: { timeliness: 0.8, novelty: 0, continuity: 0.5, emotional_fit: 0.7, affinity: 0.6, surprise: 0.3 },
      })],
    } as any;
    const result = buildScoredCandidatesSection(state);
    expect(result).toContain('NO_REPLY');
  });
});

// --- resolveMessage / extractMessage / generateFallbackMessage ---

function makeScoredCandidate(overrides: Record<string, unknown> = {}) {
  return {
    topic: 'AIの新しい研究成果',
    source: 'interest-cache' as const,
    category: 'hobby_leisure',
    pub_date: '2026-04-05',
    metadata: { mediaSource: 'TechCrunch' },
    scores: { timeliness: 0.8, novelty: 0.9, continuity: 0.5, emotional_fit: 0.7, affinity: 0.6, surprise: 0.3 },
    finalScore: 0.75,
    reasoning: 'test',
    ...overrides,
  };
}

function makeState(overrides: Partial<ProactiveState> = {}): ProactiveState {
  return { ...createDefaultState(), ...overrides };
}

describe('resolveMessage', () => {
  it('1. allowNoReply=true + NO_REPLY response -> action: skip, error: null', () => {
    const state = makeState({ allowNoReply: true });
    const result = resolveMessage('NO_REPLY', state);
    expect(result.action).toBe('skip');
    expect(result.error).toBeNull();
    expect(result.message).toBeNull();
    expect(result.fallbackUsed).toBe(false);
  });

  it('2. allowNoReply=true + valid JSON with message -> action: send', () => {
    const state = makeState({ allowNoReply: true });
    const response = JSON.stringify({
      decision: 'send',
      need: 'test',
      reason: 'test',
      candidates: [],
      message: 'こんにちは、面白い記事があったよ',
    });
    const result = resolveMessage(response, state);
    expect(result.action).toBe('send');
    expect(result.message).toBe('こんにちは、面白い記事があったよ');
    expect(result.fallbackUsed).toBe(false);
  });

  it('3. allowNoReply=false + valid JSON with message -> action: send', () => {
    const state = makeState({ allowNoReply: false });
    const response = JSON.stringify({
      decision: 'send',
      need: 'test',
      reason: 'test',
      candidates: [],
      message: 'テストメッセージ',
    });
    const result = resolveMessage(response, state);
    expect(result.action).toBe('send');
    expect(result.message).toBe('テストメッセージ');
    expect(result.fallbackUsed).toBe(false);
  });

  it('4. allowNoReply=false + JSON with decision:send but message:null -> fallback generated, fallbackUsed: true', () => {
    const candidate = makeScoredCandidate();
    const state = makeState({
      allowNoReply: false,
      lastScoredCandidates: [candidate as any],
    });
    const response = JSON.stringify({
      decision: 'send',
      need: 'test',
      reason: 'test',
      candidates: [{ topic: candidate.topic, source: candidate.source, score: 0.8 }],
      message: null,
    });
    const result = resolveMessage(response, state, 'mei');
    expect(result.action).toBe('send');
    expect(result.fallbackUsed).toBe(true);
    expect(result.message).not.toBeNull();
    expect(result.message).toContain('AIの新しい研究成果');
  });

  it('5. allowNoReply=false + message:null + no candidates -> action: skip, error: string', () => {
    const state = makeState({ allowNoReply: false });
    const response = JSON.stringify({
      decision: 'send',
      need: 'test',
      reason: 'test',
      candidates: [],
      message: null,
    });
    const result = resolveMessage(response, state);
    expect(result.action).toBe('skip');
    expect(result.error).toBe('allowNoReply=false but no message could be generated');
  });

  it('6. allowNoReply=false + validation fails -> action: send, warnings non-empty', () => {
    const candidate = makeScoredCandidate();
    const state = makeState({
      allowNoReply: false,
      lastScoredCandidates: [candidate as any],
    });
    const response = JSON.stringify({
      decision: 'send',
      need: 'test',
      reason: 'test',
      candidates: [{ topic: '全く関係ない話題XYZXYZ', source: 'unknown', score: 0.8 }],
      message: 'メッセージ本文',
    });
    const result = resolveMessage(response, state);
    expect(result.action).toBe('send');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.message).toBe('メッセージ本文');
  });

  it('7. allowNoReply=true + validation fails -> action: skip', () => {
    const candidate = makeScoredCandidate();
    const state = makeState({
      allowNoReply: true,
      lastScoredCandidates: [candidate as any],
    });
    const response = JSON.stringify({
      decision: 'send',
      need: 'test',
      reason: 'test',
      candidates: [{ topic: '全く関係ない話題XYZXYZ', source: 'unknown', score: 0.8 }],
      message: 'メッセージ本文',
    });
    const result = resolveMessage(response, state);
    expect(result.action).toBe('skip');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('8. raw JSON string (starts with { but not valid DecisionLog) -> action: skip (not sent as raw text)', () => {
    const state = makeState({ allowNoReply: true });
    const response = '{ "some_random_key": "value", "another": 123 }';
    const result = resolveMessage(response, state);
    expect(result.action).toBe('skip');
    expect(result.message).toBeNull();
  });

  it('9. plain text message (non-JSON, non-NO_REPLY) -> action: send', () => {
    const state = makeState({ allowNoReply: true });
    const response = 'おはよう、今日はいい天気だね';
    const result = resolveMessage(response, state);
    expect(result.action).toBe('send');
    expect(result.message).toBe('おはよう、今日はいい天気だね');
    expect(result.fallbackUsed).toBe(false);
  });

  it('10. extractMessage with half-width brackets in NO_REPLY line -> still detects NO_REPLY', () => {
    // This tests that extractMessage handles NO_REPLY detection correctly
    // even when surrounded by unusual content
    const response = 'Some preamble text\nNO_REPLY';
    const result = extractMessage(response, null);
    expect(result).toBeNull();
  });

  it('11. generateFallbackMessage with mei botId -> uses mei template', () => {
    const candidate = makeScoredCandidate();
    const state = makeState({
      lastScoredCandidates: [candidate as any],
    });
    // Run multiple times to verify it always produces a mei-style message
    const results = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const msg = generateFallbackMessage(state, 'mei');
      expect(msg).not.toBeNull();
      results.add(msg!);
    }
    // All results should match mei template patterns
    for (const msg of results) {
      const isMeiTemplate =
        msg.includes('ね、Akiraさん') ||
        msg.includes('あ、Akiraさん') ||
        msg.includes('ちょっと気になったんだけど');
      expect(isMeiTemplate).toBe(true);
      expect(msg).toContain('AIの新しい研究成果');
      expect(msg).toContain('TechCrunch');
    }
  });
});
