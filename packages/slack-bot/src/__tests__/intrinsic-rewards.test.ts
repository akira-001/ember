import { describe, it, expect } from 'vitest';
import {
  computeImmediateRewards,
  computeDeferredRewards,
  computeIntrinsicBoost,
  createDefaultIntrinsicConfig,
  filterEnabledSignals,
  type IntrinsicSignal,
  type IntrinsicConfig,
} from '../intrinsic-rewards.js';

// --- Helper factories ---

function makeCandidate(overrides: Partial<{
  category: string;
  source: string;
  topic: string;
  metadata: Record<string, unknown>;
}> = {}) {
  return {
    category: overrides.category ?? 'dodgers',
    source: overrides.source ?? 'rss',
    topic: overrides.topic ?? '大谷翔平がホームラン',
    metadata: overrides.metadata ?? {},
  };
}

function makeState(overrides: Partial<{
  history: Array<{ interestCategory?: string; sentAt: string; reaction: string | null; preview?: string }>;
  todayMessages: Array<{ time: string; summary: string; source: string }>;
  consecutiveNoReaction: number;
  calendarDensity: number;
}> = {}) {
  return {
    history: overrides.history ?? [],
    todayMessages: overrides.todayMessages ?? [],
    consecutiveNoReaction: overrides.consecutiveNoReaction ?? 0,
    calendarDensity: overrides.calendarDensity ?? 0,
  };
}

// --- computeImmediateRewards ---

describe('computeImmediateRewards', () => {
  describe('M1-a Goal Alignment', () => {
    it('fires when topic matches high-arousal insight', () => {
      const candidate = makeCandidate({ topic: '大谷翔平がホームラン' });
      const insights = [{ insight: '大谷翔平', arousal: 0.8 }];
      const signals = computeImmediateRewards(candidate, makeState(), insights, 'send');
      const m1a = signals.find((s) => s.id === 'M1-a');
      expect(m1a).toBeDefined();
      expect(m1a!.value).toBe(0.1);
    });

    it('does not fire when no insight matches topic', () => {
      const candidate = makeCandidate({ topic: '天気予報' });
      const insights = [{ insight: '大谷翔平', arousal: 0.8 }];
      const signals = computeImmediateRewards(candidate, makeState(), insights, 'send');
      expect(signals.find((s) => s.id === 'M1-a')).toBeUndefined();
    });

    it('does not fire when arousal < 0.7', () => {
      const candidate = makeCandidate({ topic: '大谷翔平がホームラン' });
      const insights = [{ insight: '大谷翔平の活躍', arousal: 0.5 }];
      const signals = computeImmediateRewards(candidate, makeState(), insights, 'send');
      expect(signals.find((s) => s.id === 'M1-a')).toBeUndefined();
    });
  });

  describe('M2-a Wellbeing Timing', () => {
    it('fires on busy day with light topic', () => {
      const candidate = makeCandidate({ metadata: { emotion_type: 'light' } });
      const state = makeState({ calendarDensity: 3 });
      const signals = computeImmediateRewards(candidate, state, [], 'send');
      const m2a = signals.find((s) => s.id === 'M2-a');
      expect(m2a).toBeDefined();
      expect(m2a!.value).toBe(0.15);
    });

    it('does not fire on busy day with heavy topic', () => {
      const candidate = makeCandidate({ metadata: { emotion_type: 'heavy' } });
      const state = makeState({ calendarDensity: 3 });
      const signals = computeImmediateRewards(candidate, state, [], 'send');
      expect(signals.find((s) => s.id === 'M2-a')).toBeUndefined();
    });

    it('fires on busy day with NO_REPLY', () => {
      const state = makeState({ calendarDensity: 2 });
      const signals = computeImmediateRewards(null, state, [], 'no_reply');
      const m2a = signals.find((s) => s.id === 'M2-a');
      expect(m2a).toBeDefined();
      expect(m2a!.value).toBe(0.15);
    });

    it('does not fire when not busy', () => {
      const candidate = makeCandidate({ metadata: { emotion_type: 'light' } });
      const state = makeState({ calendarDensity: 1 });
      const signals = computeImmediateRewards(candidate, state, [], 'send');
      expect(signals.find((s) => s.id === 'M2-a')).toBeUndefined();
    });
  });

  describe('M2-b Appropriate Silence', () => {
    it('fires on NO_REPLY with consecutiveNoReaction >= 2', () => {
      const state = makeState({ consecutiveNoReaction: 3 });
      const signals = computeImmediateRewards(null, state, [], 'no_reply');
      const m2b = signals.find((s) => s.id === 'M2-b');
      expect(m2b).toBeDefined();
      expect(m2b!.value).toBe(0.1);
    });

    it('does not fire on NO_REPLY with consecutiveNoReaction < 2', () => {
      const state = makeState({ consecutiveNoReaction: 1 });
      const signals = computeImmediateRewards(null, state, [], 'no_reply');
      expect(signals.find((s) => s.id === 'M2-b')).toBeUndefined();
    });

    it('does not fire on send decision', () => {
      const candidate = makeCandidate();
      const state = makeState({ consecutiveNoReaction: 5 });
      const signals = computeImmediateRewards(candidate, state, [], 'send');
      expect(signals.find((s) => s.id === 'M2-b')).toBeUndefined();
    });
  });

  describe('M4-a Information Novelty', () => {
    it('fires when topic not in any history preview', () => {
      const candidate = makeCandidate({ topic: '新しいニュース' });
      const state = makeState({
        history: [
          { sentAt: '2026-03-27T10:00:00Z', reaction: null, preview: '古いニュース' },
        ],
      });
      const signals = computeImmediateRewards(candidate, state, [], 'send');
      expect(signals.find((s) => s.id === 'M4-a')).toBeDefined();
    });

    it('does not fire when topic is substring of existing preview', () => {
      const candidate = makeCandidate({ topic: '大谷翔平' });
      const state = makeState({
        history: [
          { sentAt: '2026-03-27T10:00:00Z', reaction: null, preview: '大谷翔平がホームラン打った' },
        ],
      });
      const signals = computeImmediateRewards(candidate, state, [], 'send');
      expect(signals.find((s) => s.id === 'M4-a')).toBeUndefined();
    });

    it('fires when history is empty', () => {
      const candidate = makeCandidate({ topic: '何でも新しい' });
      const signals = computeImmediateRewards(candidate, makeState(), [], 'send');
      expect(signals.find((s) => s.id === 'M4-a')).toBeDefined();
    });
  });

  describe('M4-b Cross-Domain Connection', () => {
    it('fires when category starts with _cross', () => {
      const candidate = makeCandidate({ category: '_cross' });
      const signals = computeImmediateRewards(candidate, makeState(), [], 'send');
      expect(signals.find((s) => s.id === 'M4-b')).toBeDefined();
    });

    it('fires when category starts with _wildcard', () => {
      const candidate = makeCandidate({ category: '_wildcard' });
      const signals = computeImmediateRewards(candidate, makeState(), [], 'send');
      expect(signals.find((s) => s.id === 'M4-b')).toBeDefined();
    });

    it('does not fire for normal category', () => {
      const candidate = makeCandidate({ category: 'dodgers' });
      const signals = computeImmediateRewards(candidate, makeState(), [], 'send');
      expect(signals.find((s) => s.id === 'M4-b')).toBeUndefined();
    });
  });

  describe('Combined signals', () => {
    it('multiple signals fire simultaneously', () => {
      const candidate = makeCandidate({
        category: '_cross',
        topic: '大谷翔平の新記録',
        metadata: { emotion_type: 'light' },
      });
      const state = makeState({ calendarDensity: 3 });
      const insights = [{ insight: '大谷翔平', arousal: 0.9 }];
      const signals = computeImmediateRewards(candidate, state, insights, 'send');
      const ids = signals.map((s) => s.id);
      expect(ids).toContain('M1-a');
      expect(ids).toContain('M2-a');
      expect(ids).toContain('M4-a');
      expect(ids).toContain('M4-b');
      expect(signals.length).toBeGreaterThanOrEqual(4);
    });
  });
});

// --- computeDeferredRewards ---

describe('computeDeferredRewards', () => {
  describe('M3-a New Insight Acquired', () => {
    it('fires when newInsightAcquired is true', () => {
      const signals = computeDeferredRewards('text', true, 1);
      const m3a = signals.find((s) => s.id === 'M3-a');
      expect(m3a).toBeDefined();
      expect(m3a!.value).toBe(0.2);
    });

    it('does not fire when newInsightAcquired is false', () => {
      const signals = computeDeferredRewards('text', false, 1);
      expect(signals.find((s) => s.id === 'M3-a')).toBeUndefined();
    });
  });

  describe('M5-a Conversation Elicited', () => {
    it('fires when replyType is text', () => {
      const signals = computeDeferredRewards('text', false, 1);
      expect(signals.find((s) => s.id === 'M5-a')).toBeDefined();
    });

    it('does not fire when replyType is reaction', () => {
      const signals = computeDeferredRewards('reaction', false, 1);
      expect(signals.find((s) => s.id === 'M5-a')).toBeUndefined();
    });

    it('does not fire when replyType is none', () => {
      const signals = computeDeferredRewards('none', false, 1);
      expect(signals.find((s) => s.id === 'M5-a')).toBeUndefined();
    });
  });

  describe('M5-b Deep Engagement', () => {
    it('fires when replyCount >= 2', () => {
      const signals = computeDeferredRewards('text', false, 2);
      expect(signals.find((s) => s.id === 'M5-b')).toBeDefined();
    });

    it('does not fire when replyCount < 2', () => {
      const signals = computeDeferredRewards('text', false, 1);
      expect(signals.find((s) => s.id === 'M5-b')).toBeUndefined();
    });
  });

  describe('Combined', () => {
    it('text reply + new insight → both M3-a and M5-a fire', () => {
      const signals = computeDeferredRewards('text', true, 1);
      const ids = signals.map((s) => s.id);
      expect(ids).toContain('M3-a');
      expect(ids).toContain('M5-a');
    });
  });
});

// --- computeIntrinsicBoost ---

describe('computeIntrinsicBoost', () => {
  it('computes sum * lambda for normal case', () => {
    const signals: IntrinsicSignal[] = [
      { id: 'M1-a', mission: 1, value: 0.1, reason: 'test' },
      { id: 'M4-a', mission: 4, value: 0.1, reason: 'test' },
    ];
    expect(computeIntrinsicBoost(signals, 0.3)).toBeCloseTo(0.06);
  });

  it('clamps high: returns 0.5 when sum * lambda > 0.5', () => {
    const signals: IntrinsicSignal[] = [
      { id: 'M1-a', mission: 1, value: 5.0, reason: 'test' },
    ];
    expect(computeIntrinsicBoost(signals, 1.0)).toBe(0.5);
  });

  it('clamps low: returns -0.3 for negative values', () => {
    const signals: IntrinsicSignal[] = [
      { id: 'X', mission: 1, value: -1.0, reason: 'test' },
    ];
    expect(computeIntrinsicBoost(signals, 1.0)).toBe(-0.3);
  });

  it('returns 0 for empty signals', () => {
    expect(computeIntrinsicBoost([], 0.3)).toBe(0);
  });

  it('returns 0 when lambda is 0', () => {
    const signals: IntrinsicSignal[] = [
      { id: 'M1-a', mission: 1, value: 0.5, reason: 'test' },
    ];
    expect(computeIntrinsicBoost(signals, 0)).toBe(0);
  });
});

// --- filterEnabledSignals ---

describe('filterEnabledSignals', () => {
  const signals: IntrinsicSignal[] = [
    { id: 'M1-a', mission: 1, value: 0.1, reason: 'a' },
    { id: 'M2-a', mission: 2, value: 0.15, reason: 'b' },
    { id: 'M4-a', mission: 4, value: 0.1, reason: 'c' },
  ];

  it('returns all when all are enabled', () => {
    const config: IntrinsicConfig = { lambda: 0.3, enabledSignals: ['M1-a', 'M2-a', 'M4-a'] };
    expect(filterEnabledSignals(signals, config)).toHaveLength(3);
  });

  it('filters correctly when some are disabled', () => {
    const config: IntrinsicConfig = { lambda: 0.3, enabledSignals: ['M1-a'] };
    const result = filterEnabledSignals(signals, config);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('M1-a');
  });

  it('returns none when enabledSignals is empty', () => {
    const config: IntrinsicConfig = { lambda: 0.3, enabledSignals: [] };
    expect(filterEnabledSignals(signals, config)).toHaveLength(0);
  });
});

// --- createDefaultIntrinsicConfig ---

describe('createDefaultIntrinsicConfig', () => {
  it('returns correct defaults', () => {
    const config = createDefaultIntrinsicConfig();
    expect(config.lambda).toBe(0.3);
    expect(config.enabledSignals).toEqual([
      'M1-a', 'M2-a', 'M2-b', 'M3-a', 'M3-b', 'M4-a', 'M4-b', 'M5-a', 'M5-b',
      'R1', 'R2', 'R3', 'R4', 'R5',
      'L1-collect', 'L2-collect', 'L3-collect', 'L4-collect', 'L5-collect', 'L-action',
    ]);
  });
});

// --- analyzeReplyForMissions ---

import { analyzeReplyForMissions } from '../intrinsic-rewards.js';

describe('analyzeReplyForMissions', () => {
  it('returns empty signals and null profileUpdate for empty reply', async () => {
    const result = await analyzeReplyForMissions('', 'test message');
    expect(result).toEqual({ signals: [], profileUpdate: null });
  });

  it('returns empty signals and null profileUpdate for very short reply', async () => {
    const result = await analyzeReplyForMissions('OK', 'test message');
    expect(result).toEqual({ signals: [], profileUpdate: null });
  });

  // Note: MLX integration tests require running MLX server.
  // These are tested manually via curl or integration tests.
});
