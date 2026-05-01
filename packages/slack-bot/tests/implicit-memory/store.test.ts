import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ImplicitMemoryStore } from '../../src/implicit-memory/store';
import { createMemoryEntry, createEmptyImplicitMemory, type MemoryEntry } from '../../src/implicit-memory/types';
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import os from 'os';

describe('ImplicitMemoryStore', () => {
  let store: ImplicitMemoryStore;
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = join(os.tmpdir(), `implicit-memory-test-${Date.now()}.json`);
    store = new ImplicitMemoryStore(tmpPath, 'mei');
  });

  afterEach(() => {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  });

  it('returns empty memory when file does not exist', () => {
    const mem = store.getAll();
    expect(mem.facts).toEqual([]);
    expect(mem.corrections).toEqual([]);
  });

  it('adds an entry to the correct layer', () => {
    const entry = createMemoryEntry({
      content: 'ゴルフをする',
      context: '週末の話',
      source: 'slack_message',
      layer: 'facts',
    });
    store.add('facts', entry);
    const mem = store.getAll();
    expect(mem.facts).toHaveLength(1);
    expect(mem.facts[0].content).toBe('ゴルフをする');
  });

  it('persists to disk and reloads', () => {
    const entry = createMemoryEntry({
      content: '朝型',
      context: '活動時間の話',
      source: 'listening',
      layer: 'preferences',
      intensity: 'strong',
    });
    store.add('preferences', entry);

    const store2 = new ImplicitMemoryStore(tmpPath, 'mei');
    const mem = store2.getAll();
    expect(mem.preferences).toHaveLength(1);
    expect(mem.preferences[0].content).toBe('朝型');
    expect(mem.preferences[0].intensity).toBe('strong');
  });

  it('updates an entry by id', () => {
    const entry = createMemoryEntry({
      content: '草津が好き',
      context: '温泉の話',
      source: 'proactive',
      layer: 'preferences',
    });
    store.add('preferences', entry);
    store.update('preferences', entry.id, { confidence: 0.3 });

    const mem = store.getAll();
    expect(mem.preferences[0].confidence).toBe(0.3);
  });

  it('removes an entry by id', () => {
    const entry = createMemoryEntry({
      content: '猫を飼っている',
      context: '写真の話',
      source: 'slack_message',
      layer: 'facts',
    });
    store.add('facts', entry);
    store.remove('facts', entry.id);

    const mem = store.getAll();
    expect(mem.facts).toHaveLength(0);
  });

  it('adds a correction entry', () => {
    store.addCorrection({
      id: 'corr-1',
      originalMemoryId: 'mem-1',
      trigger: 'contradiction',
      before: '草津が好き',
      after: '最近は箱根派',
      reason: '箱根によく行っている発言を観測',
      correctedAt: new Date().toISOString(),
    });

    const mem = store.getAll();
    expect(mem.corrections).toHaveLength(1);
    expect(mem.corrections[0].trigger).toBe('contradiction');
  });

  it('getLayer returns entries for a specific layer', () => {
    store.add('facts', createMemoryEntry({ content: 'fact1', context: '', source: 'slack_message', layer: 'facts' }));
    store.add('values', createMemoryEntry({ content: 'value1', context: '', source: 'listening', layer: 'values' }));

    expect(store.getLayer('facts')).toHaveLength(1);
    expect(store.getLayer('values')).toHaveLength(1);
    expect(store.getLayer('patterns')).toHaveLength(0);
  });

  it('getStats returns correct counts', () => {
    store.add('facts', createMemoryEntry({ content: 'f1', context: '', source: 'slack_message', layer: 'facts' }));
    store.add('facts', createMemoryEntry({ content: 'f2', context: '', source: 'slack_message', layer: 'facts' }));
    store.add('patterns', createMemoryEntry({ content: 'p1', context: '', source: 'listening', layer: 'patterns' }));

    const stats = store.getStats();
    expect(stats.facts).toBe(2);
    expect(stats.patterns).toBe(1);
    expect(stats.preferences).toBe(0);
    expect(stats.total).toBe(3);
  });
});
