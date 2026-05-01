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
  });
});
