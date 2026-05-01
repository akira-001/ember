import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { ProactiveAgent } from '../proactive-agent';
import { createDefaultState, type ProactiveState } from '../proactive-state';
import { recordSharedSend } from '../shared-proactive-history';

const TEST_STATE_PATH = join(__dirname, '../../data/test-agent-class-state.json');
const TEST_INSIGHTS_PATH = join(__dirname, '../../data/test-agent-class-insights.json');
const SHARED_HISTORY_PATH = join(__dirname, '../../data/test-agent-class-shared-history.json');

// Mock Slack app
function createMockApp() {
  const postedMessages: any[] = [];
  return {
    client: {
      chat: {
        postMessage: vi.fn(async (opts: any) => {
          postedMessages.push(opts);
          return { ok: true, ts: `mock-ts-${postedMessages.length}` };
        }),
      },
    },
    postedMessages,
  };
}

function createMockInference(response: string) {
  return vi.fn(async (_prompt: string) => response);
}

describe('ProactiveAgent', () => {
  let mockApp: ReturnType<typeof createMockApp>;

  beforeEach(() => {
    mockApp = createMockApp();
    // Use isolated file paths to avoid race conditions with other test files
    process.env.SHARED_HISTORY_PATH = SHARED_HISTORY_PATH;
    cleanup();
  });

  afterEach(() => {
    cleanup();
    delete process.env.SHARED_HISTORY_PATH;
  });

  function cleanup() {
    for (const f of [TEST_STATE_PATH, TEST_INSIGHTS_PATH, SHARED_HISTORY_PATH]) {
      if (existsSync(f)) unlinkSync(f);
    }
  }

  function createAgent(inferenceResponse: string = 'NO_REPLY') {
    const inference = createMockInference(inferenceResponse);
    const agent = new ProactiveAgent({
      app: mockApp as any,
      statePath: TEST_STATE_PATH,
      insightsPath: TEST_INSIGHTS_PATH,
      slackTarget: 'U_TEST',
      inferenceFn: inference,
      collectDataFn: async () => '{"gmail": {"count": 0}, "calendar": {"today": []}, "errors": []}',
      botId: 'mei',
      botName: 'メイ',
    });
    return { agent, inference };
  }

  describe('run()', () => {
    it('should not send message when LLM returns NO_REPLY', async () => {
      const { agent } = createAgent('NO_REPLY');
      await agent.run();
      expect(mockApp.client.chat.postMessage).not.toHaveBeenCalled();
    });

    it('should send message when LLM returns a suggestion', async () => {
      const { agent } = createAgent('メール溜まってない？確認してみたら？');
      await agent.run();
      expect(mockApp.client.chat.postMessage).toHaveBeenCalledOnce();
      const call = mockApp.client.chat.postMessage.mock.calls[0][0];
      expect(call.channel).toBe('U_TEST');
      expect(call.text).toContain('メール溜まってない');
    });

    it('should save message ts to history after sending', async () => {
      const { agent } = createAgent('おはよう！今日の予定確認した？');
      await agent.run();
      const state: ProactiveState = JSON.parse(readFileSync(TEST_STATE_PATH, 'utf-8'));
      expect(state.history).toHaveLength(1);
      expect(state.history[0].slackTs).toBe('mock-ts-1');
      expect(state.stats.totalSent).toBe(1);
    });

    it('should persist URL metadata for sent messages when the selected candidate has a URL', async () => {
      const state = createDefaultState();
      state.lastScoredCandidates = [{
        topic: 'URL付きの宇宙写真',
        source: 'interest-cache',
        category: 'space',
        pub_date: null,
        metadata: { url: 'https://example.com/space-article' },
        scores: { timeliness: 0.9, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
        finalScore: 0.88,
        reasoning: '',
      } as any];
      writeFileSync(TEST_STATE_PATH, JSON.stringify(state));

      const { agent } = createAgent(JSON.stringify({
        decision: 'send',
        need: '好奇心',
        reason: '宇宙記事',
        candidates: [{ topic: 'URL付きの宇宙写真', source: 'interest-cache', score: 0.88 }],
        message: 'URL付きの宇宙写真だよ',
      }));

      await agent.run();
      const saved: ProactiveState = JSON.parse(readFileSync(TEST_STATE_PATH, 'utf-8'));
      expect(saved.history).toHaveLength(1);
      expect(saved.history[0].candidateUrl).toBe('https://example.com/space-article');
      expect(saved.history[0].sourceUrls?.[0]?.url).toBe('https://example.com/space-article');
      const shared = JSON.parse(readFileSync(SHARED_HISTORY_PATH, 'utf-8'));
      expect(shared.entries.at(-1).url).toBe('https://example.com/space-article');
    });

    it('should persist URL metadata from the message when candidate matching fails', async () => {
      const state = createDefaultState();
      state.allowNoReply = false;
      state.lastScoredCandidates = [{
        topic: '別候補',
        source: 'interest-cache',
        category: 'tech',
        pub_date: null,
        metadata: {},
        scores: { timeliness: 0.9, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
        finalScore: 0.88,
        reasoning: '',
      } as any];
      writeFileSync(TEST_STATE_PATH, JSON.stringify(state));

      const { agent } = createAgent(JSON.stringify({
        decision: 'send',
        need: '好奇心',
        reason: '温泉記事',
        candidates: [{ topic: '温泉ソムリエが選ぶBEST5', source: 'topic', score: 0.65 }],
        message: 'YouTubeで *温泉ソムリエが選ぶ「泊まって良かった温泉旅館BEST5」* が出てたよ。\n\nhttps://www.youtube.com/watch?v=piEr8qwWgBU',
      }));

      await agent.run();
      const saved: ProactiveState = JSON.parse(readFileSync(TEST_STATE_PATH, 'utf-8'));
      expect(saved.history).toHaveLength(1);
      expect(saved.history[0].candidateUrl).toBe('https://www.youtube.com/watch?v=piEr8qwWgBU');
      expect(saved.history[0].candidateId).toBe('url:https://www.youtube.com/watch?v=piEr8qwWgBU');
      expect(saved.history[0].sourceUrls?.[0]?.url).toBe('https://www.youtube.com/watch?v=piEr8qwWgBU');
      const shared = JSON.parse(readFileSync(SHARED_HISTORY_PATH, 'utf-8'));
      expect(shared.entries.at(-1).url).toBe('https://www.youtube.com/watch?v=piEr8qwWgBU');
    });

    it('should block resend for the same topic and source within 24 hours even without URL', async () => {
      const state = createDefaultState();
      const recentSentAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      state.history.push({
        id: 'old-1',
        category: 'flashback',
        interestCategory: 'movie_theater',
        sentAt: recentSentAt,
        slackTs: 'old-ts-1',
        slackChannel: 'U_TEST',
        reaction: null,
        reactionDelta: 0,
        preview: 'ハムネット って映画、今やってるみたい。',
        fullText: 'ハムネット って映画、今やってるみたい。',
        sourceUrls: [],
        candidateId: 'topic:interest-cache:movie_theater:deadbeef',
        candidateTopic: 'ハムネット つくば',
        candidateSource: 'interest-cache',
        skill: 'general',
        sources: [],
      } as any);
      state.lastScoredCandidates = [{
        topic: 'ハムネット つくば',
        source: 'interest-cache',
        category: 'movie_theater',
        pub_date: null,
        metadata: {},
        scores: { timeliness: 0.9, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
        finalScore: 0.88,
        reasoning: '',
      } as any];
      writeFileSync(TEST_STATE_PATH, JSON.stringify(state));

      const { agent } = createAgent(JSON.stringify({
        decision: 'send',
        need: '楽しみ',
        reason: '映画情報',
        candidates: [{ topic: 'ハムネット つくば', source: 'interest-cache', score: 0.88 }],
        message: 'ハムネット って映画、今やってるみたい。',
      }));

      await agent.run();

      expect(mockApp.client.chat.postMessage).not.toHaveBeenCalled();
      const saved: ProactiveState = JSON.parse(readFileSync(TEST_STATE_PATH, 'utf-8'));
      expect(saved.lastDecisionLog?.reason).toBe('映画情報');
      expect(saved.lastDecisionLog?.candidates?.[0]?.topic).toBe('ハムネット つくば');
    });

    it('should block movie topics for a longer window when URL is missing', async () => {
      const state = createDefaultState();
      const recentSentAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      state.history.push({
        id: 'old-2',
        category: 'flashback',
        interestCategory: 'movie_theater',
        sentAt: recentSentAt,
        slackTs: 'old-ts-2',
        slackChannel: 'U_TEST',
        reaction: null,
        reactionDelta: 0,
        preview: 'ハムネット の上映情報だよ。',
        fullText: 'ハムネット の上映情報だよ。',
        sourceUrls: [],
        candidateId: 'topic:interest-cache:movie_theater:cafebabe',
        candidateTopic: 'ハムネット つくば',
        candidateSource: 'interest-cache',
        skill: 'general',
        sources: [],
      } as any);
      state.lastScoredCandidates = [{
        topic: 'ハムネット つくば',
        source: 'interest-cache',
        category: 'movie_theater',
        pub_date: null,
        metadata: {},
        scores: { timeliness: 0.9, novelty: 1, continuity: 0, emotional_fit: 0, affinity: 0, surprise: 0 },
        finalScore: 0.88,
        reasoning: '',
      } as any];
      writeFileSync(TEST_STATE_PATH, JSON.stringify(state));

      const { agent } = createAgent(JSON.stringify({
        decision: 'send',
        need: '楽しみ',
        reason: '映画情報',
        candidates: [{ topic: 'ハムネット つくば', source: 'interest-cache', score: 0.88 }],
        message: 'ハムネット って映画、知ってる？',
      }));

      await agent.run();

      expect(mockApp.client.chat.postMessage).not.toHaveBeenCalled();
      const saved: ProactiveState = JSON.parse(readFileSync(TEST_STATE_PATH, 'utf-8'));
      expect(saved.lastDecisionLog?.reason).toBe('映画情報');
      expect(saved.lastDecisionLog?.candidates?.[0]?.topic).toBe('ハムネット つくば');
    });

    it('should not send when in cooldown', async () => {
      const state = createDefaultState();
      state.cooldown.until = new Date(Date.now() + 3600000).toISOString();
      writeFileSync(TEST_STATE_PATH, JSON.stringify(state));
      const { agent } = createAgent('何か話しかけたい');
      await agent.run();
      expect(mockApp.client.chat.postMessage).not.toHaveBeenCalled();
    });

    it('should update lastCheckAt even on NO_REPLY', async () => {
      const { agent } = createAgent('NO_REPLY');
      await agent.run();
      const state: ProactiveState = JSON.parse(readFileSync(TEST_STATE_PATH, 'utf-8'));
      expect(state.lastCheckAt).not.toBeNull();
    });

    it('should pass collected data to inference', async () => {
      const collectData = vi.fn(async () => '{"gmail": {"count": 5}}');
      const inference = createMockInference('NO_REPLY');
      const agent = new ProactiveAgent({
        app: mockApp as any,
        statePath: TEST_STATE_PATH,
        slackTarget: 'U_TEST',
        inferenceFn: inference,
        collectDataFn: collectData,
      });
      await agent.run();
      expect(collectData).toHaveBeenCalledOnce();
      expect(inference).toHaveBeenCalledOnce();
      const prompt = inference.mock.calls[0][0];
      expect(prompt).toContain('gmail');
      expect(prompt).toContain('5');
    });

    it('should include other bots in the prompt and record shared sends', async () => {
      recordSharedSend({
        botId: 'eve',
        botName: 'イヴ',
        category: 'flashback',
        preview: 'Eveが先に出してた話題',
      });

      const promptSpy = vi.fn(async (_prompt: string) => 'NO_REPLY');
      const agent = new ProactiveAgent({
        app: mockApp as any,
        statePath: TEST_STATE_PATH,
        insightsPath: TEST_INSIGHTS_PATH,
        slackTarget: 'U_TEST',
        inferenceFn: promptSpy,
        collectDataFn: async () => '{"gmail": {"count": 0}, "calendar": {"today": []}, "errors": []}',
        botId: 'mei',
        botName: 'メイ',
      });

      await agent.run();

      const prompt = promptSpy.mock.calls[0][0];
      expect(prompt).toContain('他のボットが最近送ったメッセージ');
      expect(prompt).toContain('Eveが先に出してた話題');

      const sendAgent = new ProactiveAgent({
        app: mockApp as any,
        statePath: TEST_STATE_PATH,
        insightsPath: TEST_INSIGHTS_PATH,
        slackTarget: 'U_TEST',
        inferenceFn: async () => 'メール確認してみたら？',
        collectDataFn: async () => '{"gmail": {"count": 0}, "calendar": {"today": []}, "errors": []}',
        botId: 'mei',
        botName: 'メイ',
      });

      await sendAgent.run();

      const shared = JSON.parse(readFileSync(SHARED_HISTORY_PATH, 'utf-8'));
      expect(shared.entries.some((e: any) => e.botId === 'mei')).toBe(true);
    });
  });

  describe('handleReaction()', () => {
    it('should update state when reaction matches a history entry', async () => {
      const { agent } = createAgent('テスト提案');
      await agent.run();
      await agent.handleReaction('heart', 'mock-ts-1', 'D_TEST');
      const state: ProactiveState = JSON.parse(readFileSync(TEST_STATE_PATH, 'utf-8'));
      expect(state.history[0].reaction).toBe('heart');
      expect(state.stats.positiveReactions).toBe(1);
    });

    it('should ignore reactions on non-proactive messages', async () => {
      const { agent } = createAgent('NO_REPLY');
      await agent.run();
      await agent.handleReaction('heart', 'unknown-ts', 'D_TEST');
      const state: ProactiveState = JSON.parse(readFileSync(TEST_STATE_PATH, 'utf-8'));
      expect(state.stats.positiveReactions).toBe(0);
    });
  });

  describe('getInsightsPath()', () => {
    it('should return the configured insights path', () => {
      const { agent } = createAgent();
      expect(agent.getInsightsPath()).toBe(TEST_INSIGHTS_PATH);
    });
  });

  describe('isProactiveMessage()', () => {
    it('should return true for sent message ts', async () => {
      const { agent } = createAgent('テスト');
      await agent.run();
      expect(agent.isProactiveMessage('mock-ts-1')).toBe(true);
    });

    it('should return false for unknown ts', async () => {
      const { agent } = createAgent('NO_REPLY');
      await agent.run();
      expect(agent.isProactiveMessage('unknown')).toBe(false);
    });
  });
});
