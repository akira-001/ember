import { describe, it, expect } from 'vitest';
import { calculateEffectiveConfidence } from '../../src/implicit-memory/decay';
import type { MemoryEntry } from '../../src/implicit-memory/types';

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'test',
    content: 'test',
    context: 'test',
    source: 'slack_message',
    confidence: 0.8,
    learnedAt: new Date().toISOString(),
    lastReinforcedAt: new Date().toISOString(),
    reinforceCount: 0,
    ...overrides,
  };
}

describe('calculateEffectiveConfidence', () => {
  it('returns full confidence for recent entry', () => {
    const entry = makeEntry({ confidence: 0.8 });
    const result = calculateEffectiveConfidence(entry);
    expect(result).toBeCloseTo(0.8, 1);
  });

  it('decays over time with base half-life of 90 days', () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const entry = makeEntry({
      confidence: 0.8,
      lastReinforcedAt: ninetyDaysAgo,
      reinforceCount: 0,
    });
    const result = calculateEffectiveConfidence(entry);
    expect(result).toBeCloseTo(0.4, 1);
  });

  it('reinforceCount extends half-life', () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const entry = makeEntry({
      confidence: 0.8,
      lastReinforcedAt: ninetyDaysAgo,
      reinforceCount: 5,
    });
    const result = calculateEffectiveConfidence(entry);
    expect(result).toBeCloseTo(0.566, 1);
  });

  it('never goes below DECAY_FLOOR (0.05)', () => {
    const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const entry = makeEntry({
      confidence: 0.3,
      lastReinforcedAt: yearAgo,
      reinforceCount: 0,
    });
    const result = calculateEffectiveConfidence(entry);
    expect(result).toBeGreaterThanOrEqual(0.05);
  });
});
