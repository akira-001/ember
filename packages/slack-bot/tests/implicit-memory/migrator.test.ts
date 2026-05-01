import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migrateFromUserInsights } from '../../src/implicit-memory/migrator';
import { ImplicitMemoryStore } from '../../src/implicit-memory/store';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

describe('migrateFromUserInsights', () => {
  let insightsPath: string;
  let memoryPath: string;

  beforeEach(() => {
    insightsPath = join(os.tmpdir(), `insights-${Date.now()}.json`);
    memoryPath = join(os.tmpdir(), `memory-${Date.now()}.json`);
  });

  afterEach(() => {
    for (const p of [insightsPath, memoryPath]) {
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('migrates insights to facts layer', () => {
    writeFileSync(insightsPath, JSON.stringify([
      {
        insight: 'ゴルフが好き',
        learnedAt: '2026-03-01T00:00:00Z',
        source: 'proactive',
        arousal: 0.7,
        reinforceCount: 3,
        embedding: [1, 0, 0],
      },
      {
        insight: '猫を飼っている',
        learnedAt: '2026-02-15T00:00:00Z',
        source: 'proactive',
        arousal: 0.5,
        reinforceCount: 1,
      },
    ]));

    const count = migrateFromUserInsights(insightsPath, memoryPath, 'mei');
    expect(count).toBe(2);

    const store = new ImplicitMemoryStore(memoryPath, 'mei');
    const facts = store.getLayer('facts');
    expect(facts).toHaveLength(2);
    expect(facts[0].content).toBe('ゴルフが好き');
    expect(facts[0].confidence).toBe(0.7);
    expect(facts[0].source).toBe('proactive');
    expect(facts[0].reinforceCount).toBe(3);
    expect(facts[0].embedding).toEqual([1, 0, 0]);
    expect(facts[1].content).toBe('猫を飼っている');
  });

  it('skips migration if insights file does not exist', () => {
    const count = migrateFromUserInsights('/nonexistent/path.json', memoryPath, 'mei');
    expect(count).toBe(0);
  });

  it('skips migration if memory already has entries', () => {
    writeFileSync(insightsPath, JSON.stringify([{ insight: 'test', learnedAt: '2026-01-01T00:00:00Z', source: 'proactive', arousal: 0.5, reinforceCount: 0 }]));

    const store = new ImplicitMemoryStore(memoryPath, 'mei');
    store.add('facts', {
      id: 'existing',
      content: 'already here',
      context: '',
      source: 'slack_message',
      confidence: 0.8,
      learnedAt: new Date().toISOString(),
      lastReinforcedAt: new Date().toISOString(),
      reinforceCount: 0,
    });

    const count = migrateFromUserInsights(insightsPath, memoryPath, 'mei');
    expect(count).toBe(0);
  });
});
