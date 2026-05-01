import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRecall } from '../../src/implicit-memory/recall';
import { ImplicitMemoryStore } from '../../src/implicit-memory/store';
import { createMemoryEntry } from '../../src/implicit-memory/types';
import { join } from 'path';
import os from 'os';
import { unlinkSync, existsSync } from 'fs';

describe('MemoryRecall', () => {
  let store: ImplicitMemoryStore;
  let recall: MemoryRecall;
  let tmpPath: string;

  const mockGetEmbedding = vi.fn();
  const mockCosineSimilarity = vi.fn();

  beforeEach(() => {
    tmpPath = join(os.tmpdir(), `recall-test-${Date.now()}.json`);
    store = new ImplicitMemoryStore(tmpPath, 'mei');
    recall = new MemoryRecall(store, {
      getEmbedding: mockGetEmbedding,
      cosineSimilarity: mockCosineSimilarity,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  });

  it('returns relevant memories sorted by score', async () => {
    const e1 = createMemoryEntry({ content: 'ゴルフをする', context: '', source: 'slack_message', layer: 'facts' });
    e1.embedding = [1, 0, 0];
    e1.confidence = 0.8;
    store.add('facts', e1);

    const e2 = createMemoryEntry({ content: '猫を飼っている', context: '', source: 'slack_message', layer: 'facts' });
    e2.embedding = [0, 1, 0];
    e2.confidence = 0.9;
    store.add('facts', e2);

    mockGetEmbedding.mockResolvedValue([0.9, 0.1, 0]);
    mockCosineSimilarity
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.2);

    const results = await recall.getRelevantMemories('週末のゴルフの話');
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('ゴルフをする');
  });

  it('excludes entries with effective confidence below threshold', async () => {
    const old = createMemoryEntry({ content: '古い記憶', context: '', source: 'slack_message', layer: 'facts' });
    old.embedding = [1, 0, 0];
    old.confidence = 0.1;
    store.add('facts', old);

    mockGetEmbedding.mockResolvedValue([1, 0, 0]);
    mockCosineSimilarity.mockReturnValue(0.9);

    const results = await recall.getRelevantMemories('test');
    expect(results).toHaveLength(0);
  });

  it('formatForPrompt generates correct section', () => {
    const entries = [
      { ...createMemoryEntry({ content: 'ゴルフをする', context: '', source: 'slack_message', layer: 'facts' }), confidence: 0.8, _layer: 'facts' as const },
      { ...createMemoryEntry({ content: '箱根が好き', context: '', source: 'listening', layer: 'preferences', intensity: 'strong' as const }), confidence: 0.7, _layer: 'preferences' as const },
      { ...createMemoryEntry({ content: '「まあいいか」は良くない', context: '', source: 'proactive', layer: 'expressions' }), confidence: 0.5, _layer: 'expressions' as const },
    ];

    const prompt = recall.formatForPrompt(entries);
    expect(prompt).toContain('### 事実');
    expect(prompt).toContain('ゴルフをする');
    expect(prompt).toContain('確信度: 高');
    expect(prompt).toContain('### 嗜好');
    expect(prompt).toContain('箱根が好き');
    expect(prompt).toContain('### 言い回し');
    expect(prompt).toContain('確信度: 中');
  });

  it('formatForPrompt returns fallback when empty', () => {
    const prompt = recall.formatForPrompt([]);
    expect(prompt).toContain('まだ何も知らない');
  });
});
