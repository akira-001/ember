import { describe, it, expect } from 'vitest';
import {
  MEMORY_LAYERS,
  DEFAULT_CONFIDENCE,
  DIRECT_TEACHING_CONFIDENCE,
  DENIAL_CONFIDENCE,
  REINFORCEMENT_BOOST,
  CONTRADICTION_PENALTY,
  PATTERN_SHIFT_PENALTY,
  CONFIDENCE_MAX,
  CONFIDENCE_ACTIVE_THRESHOLD,
  SIMILARITY_THRESHOLD,
  CONTRADICTION_SIMILARITY_THRESHOLD,
  type MemoryEntry,
  type MemorySource,
  type MemoryLayer,
  type CorrectionEntry,
  type ImplicitMemory,
  type AbsorbInput,
  createMemoryEntry,
} from '../../src/implicit-memory/types';

describe('ImplicitMemory types', () => {
  it('MEMORY_LAYERS contains all 5 layers', () => {
    expect(MEMORY_LAYERS).toEqual(['facts', 'preferences', 'patterns', 'values', 'expressions']);
  });

  it('constants have correct values', () => {
    expect(DEFAULT_CONFIDENCE).toBe(0.6);
    expect(DIRECT_TEACHING_CONFIDENCE).toBe(0.8);
    expect(DENIAL_CONFIDENCE).toBe(0.1);
    expect(REINFORCEMENT_BOOST).toBe(0.1);
    expect(CONTRADICTION_PENALTY).toBe(0.2);
    expect(PATTERN_SHIFT_PENALTY).toBe(0.15);
    expect(CONFIDENCE_MAX).toBe(0.95);
    expect(CONFIDENCE_ACTIVE_THRESHOLD).toBe(0.2);
    expect(SIMILARITY_THRESHOLD).toBe(0.7);
    expect(CONTRADICTION_SIMILARITY_THRESHOLD).toBe(0.7);
  });

  it('createMemoryEntry returns correct defaults', () => {
    const entry = createMemoryEntry({
      content: 'ゴルフをする',
      context: 'Slackで週末の予定を話していた',
      source: 'slack_message',
      layer: 'facts',
    });
    expect(entry.id).toBeTruthy();
    expect(entry.content).toBe('ゴルフをする');
    expect(entry.context).toBe('Slackで週末の予定を話していた');
    expect(entry.source).toBe('slack_message');
    expect(entry.confidence).toBe(0.6);
    expect(entry.reinforceCount).toBe(0);
    expect(entry.learnedAt).toBeTruthy();
    expect(entry.lastReinforcedAt).toBe(entry.learnedAt);
  });

  it('createMemoryEntry accepts custom confidence', () => {
    const entry = createMemoryEntry({
      content: 'test',
      context: 'test',
      source: 'proactive',
      layer: 'facts',
      confidence: 0.8,
    });
    expect(entry.confidence).toBe(0.8);
  });

  it('createMemoryEntry sets intensity for preferences', () => {
    const entry = createMemoryEntry({
      content: '箱根より草津派',
      context: '温泉の話題で',
      source: 'listening',
      layer: 'preferences',
      intensity: 'strong',
    });
    expect(entry.intensity).toBe('strong');
  });
});
