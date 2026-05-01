import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Reconciler } from '../../src/implicit-memory/reconciler';
import { ImplicitMemoryStore } from '../../src/implicit-memory/store';
import { createMemoryEntry } from '../../src/implicit-memory/types';
import { join } from 'path';
import os from 'os';
import { unlinkSync, existsSync } from 'fs';

describe('Reconciler', () => {
  let store: ImplicitMemoryStore;
  let reconciler: Reconciler;
  let tmpPath: string;

  const mockJudge = vi.fn();
  const mockGetEmbedding = vi.fn();
  const mockCosineSimilarity = vi.fn();

  beforeEach(() => {
    tmpPath = join(os.tmpdir(), `reconciler-test-${Date.now()}.json`);
    store = new ImplicitMemoryStore(tmpPath, 'mei');
    reconciler = new Reconciler(store, {
      judge: mockJudge,
      getEmbedding: mockGetEmbedding,
      cosineSimilarity: mockCosineSimilarity,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  });

  describe('checkAndReconcile', () => {
    it('stores new entry when no similar exists', async () => {
      mockGetEmbedding.mockResolvedValue([1, 0, 0]);
      mockCosineSimilarity.mockReturnValue(0.3);

      const entry = createMemoryEntry({
        content: 'ゴルフをする',
        context: '週末の話',
        source: 'slack_message',
        layer: 'facts',
      });
      entry.embedding = [1, 0, 0];

      const result = await reconciler.checkAndReconcile('facts', entry);
      expect(result).toBe('new');
      expect(store.getLayer('facts')).toHaveLength(1);
    });

    it('reinforces when similar entry exists and LLM says reinforcement', async () => {
      const existing = createMemoryEntry({
        content: 'ゴルフが好き',
        context: '趣味の話',
        source: 'slack_message',
        layer: 'facts',
      });
      existing.embedding = [1, 0, 0];
      existing.confidence = 0.6;
      store.add('facts', existing);

      mockCosineSimilarity.mockReturnValue(0.85);
      mockJudge.mockResolvedValue('A');

      const newEntry = createMemoryEntry({
        content: 'ゴルフによく行く',
        context: '別の会話で',
        source: 'listening',
        layer: 'facts',
      });
      newEntry.embedding = [0.9, 0.1, 0];

      const result = await reconciler.checkAndReconcile('facts', newEntry);
      expect(result).toBe('reinforcement');

      const facts = store.getLayer('facts');
      expect(facts).toHaveLength(1);
      expect(facts[0].confidence).toBe(0.7);
      expect(facts[0].reinforceCount).toBe(1);
    });

    it('handles contradiction: lowers old confidence, adds new entry, records correction', async () => {
      const existing = createMemoryEntry({
        content: '草津の温泉が好き',
        context: '温泉の話',
        source: 'proactive',
        layer: 'preferences',
      });
      existing.embedding = [1, 0, 0];
      existing.confidence = 0.7;
      store.add('preferences', existing);

      mockCosineSimilarity.mockReturnValue(0.8);
      mockJudge.mockResolvedValue('B');

      const newEntry = createMemoryEntry({
        content: '最近は箱根ばっかり行ってる',
        context: '旅行の話',
        source: 'slack_message',
        layer: 'preferences',
      });
      newEntry.embedding = [0.8, 0.2, 0];

      const result = await reconciler.checkAndReconcile('preferences', newEntry);
      expect(result).toBe('contradiction');

      const prefs = store.getLayer('preferences');
      expect(prefs).toHaveLength(2);

      const oldEntry = prefs.find((e) => e.id === existing.id)!;
      expect(oldEntry.confidence).toBe(0.5);

      const addedEntry = prefs.find((e) => e.id !== existing.id)!;
      expect(addedEntry.content).toBe('最近は箱根ばっかり行ってる');
      expect(addedEntry.confidence).toBe(0.6);

      const corrections = store.getCorrections();
      expect(corrections).toHaveLength(1);
      expect(corrections[0].trigger).toBe('contradiction');
      expect(corrections[0].before).toBe('草津の温泉が好き');
      expect(corrections[0].after).toBe('最近は箱根ばっかり行ってる');
    });

    it('adds supplementary info when LLM says related but not contradictory', async () => {
      const existing = createMemoryEntry({
        content: '温泉が好き',
        context: '',
        source: 'proactive',
        layer: 'preferences',
      });
      existing.embedding = [1, 0, 0];
      store.add('preferences', existing);

      mockCosineSimilarity.mockReturnValue(0.75);
      mockJudge.mockResolvedValue('C');

      const newEntry = createMemoryEntry({
        content: '露天風呂が特に好き',
        context: '',
        source: 'listening',
        layer: 'preferences',
      });
      newEntry.embedding = [0.9, 0.1, 0];

      const result = await reconciler.checkAndReconcile('preferences', newEntry);
      expect(result).toBe('new');
      expect(store.getLayer('preferences')).toHaveLength(2);
    });
  });

  describe('handleExplicitDenial', () => {
    it('lowers confidence of related memories and records correction', async () => {
      const existing = createMemoryEntry({
        content: '猫を1匹飼っている',
        context: '',
        source: 'slack_message',
        layer: 'facts',
      });
      existing.embedding = [1, 0, 0];
      store.add('facts', existing);

      mockGetEmbedding.mockResolvedValue([0.95, 0.05, 0]);
      mockCosineSimilarity.mockReturnValue(0.85);

      await reconciler.handleExplicitDenial(
        '猫は2匹いるんだよ',
        '猫は2匹いる',
      );

      const facts = store.getLayer('facts');
      expect(facts[0].confidence).toBe(0.1);

      expect(facts).toHaveLength(2);
      expect(facts[1].content).toBe('猫は2匹いる');
      expect(facts[1].confidence).toBe(0.8);

      const corrections = store.getCorrections();
      expect(corrections).toHaveLength(1);
      expect(corrections[0].trigger).toBe('explicit_denial');
    });
  });

  describe('detectPatternShift', () => {
    it('lowers confidence of inconsistent pattern', async () => {
      const pattern = createMemoryEntry({
        content: '仕事の後は疲れている',
        context: '行動パターン',
        source: 'proactive',
        layer: 'patterns',
      });
      pattern.embedding = [1, 0, 0];
      pattern.confidence = 0.8;
      store.add('patterns', pattern);

      mockCosineSimilarity.mockReturnValue(0.8);
      mockJudge.mockResolvedValue('B');

      const observation = createMemoryEntry({
        content: '仕事後に元気にジョギングしていた',
        context: '夕方の話',
        source: 'listening',
        layer: 'patterns',
      });
      observation.embedding = [0.8, 0.2, 0];

      await reconciler.detectPatternShift(observation);

      const patterns = store.getLayer('patterns');
      const oldPattern = patterns.find((p) => p.id === pattern.id)!;
      expect(oldPattern.confidence).toBe(0.65);

      expect(patterns).toHaveLength(2);

      const corrections = store.getCorrections();
      expect(corrections).toHaveLength(1);
      expect(corrections[0].trigger).toBe('pattern_shift');
    });
  });
});
