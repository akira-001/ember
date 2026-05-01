import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryAbsorber } from '../../src/implicit-memory/absorber';
import { ImplicitMemoryStore } from '../../src/implicit-memory/store';
import { Reconciler } from '../../src/implicit-memory/reconciler';
import { DenialDetector } from '../../src/implicit-memory/denial-detector';
import { MemoryRecall } from '../../src/implicit-memory/recall';
import { join } from 'path';
import os from 'os';
import { unlinkSync, existsSync } from 'fs';

describe('Implicit Memory Integration', () => {
  let store: ImplicitMemoryStore;
  let absorber: MemoryAbsorber;
  let recall: MemoryRecall;
  let tmpPath: string;

  const mockExtract = vi.fn();
  const mockGetEmbedding = vi.fn();
  const mockCosineSimilarity = vi.fn();
  const mockJudge = vi.fn();

  beforeEach(() => {
    tmpPath = join(os.tmpdir(), `integration-test-${Date.now()}.json`);
    store = new ImplicitMemoryStore(tmpPath, 'mei');

    const reconciler = new Reconciler(store, {
      judge: mockJudge,
      getEmbedding: mockGetEmbedding,
      cosineSimilarity: mockCosineSimilarity,
    });

    absorber = new MemoryAbsorber({
      store,
      reconciler,
      denialDetector: new DenialDetector(),
      extract: mockExtract,
      getEmbedding: mockGetEmbedding,
    });

    recall = new MemoryRecall(store, {
      getEmbedding: mockGetEmbedding,
      cosineSimilarity: mockCosineSimilarity,
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  });

  it('full pipeline: absorb → store → recall → prompt', async () => {
    mockExtract.mockResolvedValue({
      facts: [{ content: 'ゴルフをする', context: '週末の予定' }],
      preferences: [{ content: '箱根の温泉が好き', context: '旅行の話', intensity: 'strong' }],
      patterns: [],
      values: [],
      expressions: [],
    });
    mockGetEmbedding.mockResolvedValue([1, 0, 0]);
    mockCosineSimilarity.mockReturnValue(0.3);

    await absorber.absorbImmediate({
      text: '週末はゴルフ行って、帰りに箱根で温泉入った。最高だった。',
      source: 'slack_message',
      context: 'Slack DM',
    });

    expect(store.getLayer('facts')).toHaveLength(1);
    expect(store.getLayer('preferences')).toHaveLength(1);

    mockCosineSimilarity.mockReturnValue(0.8);
    const memories = await recall.getRelevantMemories('ゴルフの話');
    expect(memories.length).toBeGreaterThan(0);

    const prompt = recall.formatForPrompt(memories);
    expect(prompt).toContain('ゴルフをする');
  });

  it('denial → correction → updated recall', async () => {
    store.add('facts', {
      id: 'cat-1',
      content: '猫を1匹飼っている',
      context: '',
      source: 'slack_message',
      confidence: 0.7,
      learnedAt: new Date().toISOString(),
      lastReinforcedAt: new Date().toISOString(),
      reinforceCount: 2,
      embedding: [1, 0, 0],
    });

    mockGetEmbedding.mockResolvedValue([0.95, 0.05, 0]);
    mockCosineSimilarity.mockReturnValue(0.85);

    await absorber.absorbImmediate({
      text: '1匹じゃなくて2匹だよ',
      source: 'slack_message',
      context: 'DM',
    });

    const facts = store.getLayer('facts');
    const old = facts.find((f) => f.id === 'cat-1')!;
    expect(old.confidence).toBe(0.1);

    const corrected = facts.find((f) => f.id !== 'cat-1');
    expect(corrected).toBeTruthy();
    expect(corrected!.content).toBe('2匹');
    expect(corrected!.confidence).toBe(0.8);

    expect(store.getCorrections()).toHaveLength(1);
  });

  it('contradiction detection updates confidence over time', async () => {
    store.add('preferences', {
      id: 'pref-1',
      content: '草津の温泉が好き',
      context: '',
      source: 'proactive',
      confidence: 0.7,
      learnedAt: new Date().toISOString(),
      lastReinforcedAt: new Date().toISOString(),
      reinforceCount: 0,
      embedding: [1, 0, 0],
    });

    mockExtract.mockResolvedValue({
      facts: [],
      preferences: [{ content: '最近は箱根ばっかり行ってる', context: '旅行の話' }],
      patterns: [],
      values: [],
      expressions: [],
    });
    mockGetEmbedding.mockResolvedValue([0.8, 0.2, 0]);
    mockCosineSimilarity.mockReturnValue(0.8);
    mockJudge.mockResolvedValue('B');

    await absorber.absorbImmediate({
      text: '最近は箱根ばっかり行ってるよ',
      source: 'slack_message',
      context: '',
    });

    const prefs = store.getLayer('preferences');
    expect(prefs).toHaveLength(2);
    expect(prefs.find((p) => p.id === 'pref-1')!.confidence).toBe(0.5);
    expect(prefs.find((p) => p.id !== 'pref-1')!.confidence).toBe(0.6);
    expect(store.getCorrections()).toHaveLength(1);
  });
});
