import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryAbsorber } from '../../src/implicit-memory/absorber';
import { ImplicitMemoryStore } from '../../src/implicit-memory/store';
import { DenialDetector } from '../../src/implicit-memory/denial-detector';
import { Reconciler } from '../../src/implicit-memory/reconciler';
import { join } from 'path';
import os from 'os';
import { unlinkSync, existsSync } from 'fs';

describe('MemoryAbsorber', () => {
  let store: ImplicitMemoryStore;
  let absorber: MemoryAbsorber;
  let tmpPath: string;

  const mockExtract = vi.fn();
  const mockGetEmbedding = vi.fn();
  const mockCosineSimilarity = vi.fn();
  const mockJudge = vi.fn();

  beforeEach(() => {
    tmpPath = join(os.tmpdir(), `absorber-test-${Date.now()}.json`);
    store = new ImplicitMemoryStore(tmpPath, 'mei');

    const reconciler = new Reconciler(store, {
      judge: mockJudge,
      getEmbedding: mockGetEmbedding,
      cosineSimilarity: mockCosineSimilarity,
    });
    const denialDetector = new DenialDetector();

    absorber = new MemoryAbsorber({
      store,
      reconciler,
      denialDetector,
      extract: mockExtract,
      getEmbedding: mockGetEmbedding,
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  });

  it('extracts memories and stores them via reconciler', async () => {
    mockExtract.mockResolvedValue({
      facts: [{ content: 'ゴルフをする', context: '週末の話' }],
      preferences: [],
      patterns: [],
      values: [],
      expressions: [],
    });
    mockGetEmbedding.mockResolvedValue([1, 0, 0]);
    mockCosineSimilarity.mockReturnValue(0.3);

    await absorber.absorbImmediate({
      text: '週末はゴルフに行ってきた',
      source: 'slack_message',
      context: 'Slack DM',
    });

    expect(store.getLayer('facts')).toHaveLength(1);
    expect(store.getLayer('facts')[0].content).toBe('ゴルフをする');
  });

  it('skips extraction for short responses', async () => {
    await absorber.absorbImmediate({
      text: 'うん',
      source: 'slack_message',
      context: '',
    });

    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('skips extraction for OK/はい/etc', async () => {
    for (const text of ['OK', 'はい', 'おk', 'うん', 'そうだね']) {
      mockExtract.mockClear();
      await absorber.absorbImmediate({ text, source: 'slack_message', context: '' });
      expect(mockExtract).not.toHaveBeenCalled();
    }
  });

  it('detects denial and delegates to reconciler', async () => {
    mockGetEmbedding.mockResolvedValue([1, 0, 0]);

    store.add('facts', {
      id: 'test-id',
      content: '犬を飼っている',
      context: '',
      source: 'slack_message',
      confidence: 0.7,
      learnedAt: new Date().toISOString(),
      lastReinforcedAt: new Date().toISOString(),
      reinforceCount: 0,
      embedding: [1, 0, 0],
    });

    mockCosineSimilarity.mockReturnValue(0.85);

    await absorber.absorbImmediate({
      text: 'それは犬じゃなくて猫だよ',
      source: 'slack_message',
      context: 'DM',
    });

    const facts = store.getLayer('facts');
    const denied = facts.find((f) => f.id === 'test-id');
    expect(denied?.confidence).toBe(0.1);
  });

  it('tracks daily absorb count', async () => {
    mockExtract.mockResolvedValue({
      facts: [{ content: 'test', context: '' }],
      preferences: [], patterns: [], values: [], expressions: [],
    });
    mockGetEmbedding.mockResolvedValue([1, 0, 0]);
    mockCosineSimilarity.mockReturnValue(0.3);

    await absorber.absorbImmediate({
      text: 'テスト文章です',
      source: 'slack_message',
      context: '',
    });

    expect(absorber.getDailyAbsorbCount()).toBe(1);
  });
});
