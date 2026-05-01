import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  randn,
  gammaSample,
  betaSample,
  sampleWeights,
  updatePriors,
  rescalePriors,
  createInitialLearningState,
  type WeightPrior,
  type LearningState,
  type Reaction,
} from '../thompson-sampling';

describe('thompson-sampling', () => {
  describe('randn', () => {
    it('should return a finite number', () => {
      const val = randn();
      expect(Number.isFinite(val)).toBe(true);
    });

    it('should produce values roughly centered around 0', () => {
      const samples = Array.from({ length: 5000 }, () => randn());
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      expect(Math.abs(mean)).toBeLessThan(0.1);
    });
  });

  describe('betaSample', () => {
    it('should return values between 0 and 1 for standard case', () => {
      for (let i = 0; i < 100; i++) {
        const val = betaSample(2, 5);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    });

    it('should handle alpha < 1', () => {
      for (let i = 0; i < 100; i++) {
        const val = betaSample(0.5, 2);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    });

    it('should produce roughly uniform distribution when alpha=1, beta=1', () => {
      const samples = Array.from({ length: 2000 }, () => betaSample(1, 1));
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      // Uniform[0,1] has mean 0.5
      expect(mean).toBeGreaterThan(0.35);
      expect(mean).toBeLessThan(0.65);
    });

    it('should have correct mean for Beta(2,5)', () => {
      const samples = Array.from({ length: 3000 }, () => betaSample(2, 5));
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      // E[Beta(2,5)] = 2/7 ≈ 0.286
      expect(mean).toBeGreaterThan(0.18);
      expect(mean).toBeLessThan(0.38);
    });
  });

  describe('gammaSample', () => {
    it('should return positive values for shape < 1', () => {
      for (let i = 0; i < 50; i++) {
        const val = gammaSample(0.5);
        expect(val).toBeGreaterThan(0);
      }
    });

    it('should return positive values for shape = 1', () => {
      for (let i = 0; i < 50; i++) {
        const val = gammaSample(1);
        expect(val).toBeGreaterThan(0);
      }
    });

    it('should return positive values for shape > 1', () => {
      for (let i = 0; i < 50; i++) {
        const val = gammaSample(5);
        expect(val).toBeGreaterThan(0);
      }
    });

    it('should fallback to shape value when iteration limit is hit', () => {
      // Mock Math.random to return values that cause v <= 0 in the inner loop.
      // randn() uses Math.random() twice: u and v.
      // For shape=3: d = 3 - 1/3 = 2.667, c = 1/sqrt(9*d) ≈ 0.204
      // We need v = 1 + c*x <= 0, so x <= -1/c ≈ -4.9
      // randn uses Box-Muller: sqrt(-2*ln(u))*cos(2*PI*v_bm)
      // With u≈0 (tiny), sqrt(-2*ln(u)) is large. With v_bm≈0.5, cos(PI)=-1
      // So randn ≈ -sqrt(-2*ln(tiny)) which is a large negative number
      const originalRandom = Math.random;
      let callCount = 0;
      Math.random = () => {
        callCount++;
        // Alternate: first call (u in randn) = very small → large sqrt term
        // second call (v in randn) = 0.5 → cos(PI) = -1
        // This makes randn() return a large negative, causing v <= 0
        // Third call would be the u for acceptance check, but we never get there
        if (callCount % 2 === 1) return 1e-8;   // u in Box-Muller → very large magnitude
        return 0.5;                               // v in Box-Muller → cos(PI) = -1
      };

      try {
        const result = gammaSample(3);
        // Should fallback to shape (expected value) = 3
        expect(result).toBe(3);
        // Should have hit the iteration limit (1000 iterations * inner loop calls)
        expect(callCount).toBeGreaterThan(100);
      } finally {
        Math.random = originalRandom;
      }
    });
  });

  describe('sampleWeights', () => {
    it('should return weights that sum to 1.0', () => {
      const priors: Record<string, WeightPrior> = {
        a: { alpha: 2, beta: 5 },
        b: { alpha: 3, beta: 3 },
        c: { alpha: 5, beta: 2 },
      };
      const weights = sampleWeights(priors);
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 5);
    });

    it('should return roughly equal weights for equal priors', () => {
      const priors: Record<string, WeightPrior> = {
        a: { alpha: 5, beta: 5 },
        b: { alpha: 5, beta: 5 },
        c: { alpha: 5, beta: 5 },
      };
      // Run multiple times and check average
      const avgWeights: Record<string, number> = { a: 0, b: 0, c: 0 };
      const N = 1000;
      for (let i = 0; i < N; i++) {
        const w = sampleWeights(priors);
        for (const k of Object.keys(w)) {
          avgWeights[k] += w[k] / N;
        }
      }
      // Each should be ~0.333
      for (const k of Object.keys(avgWeights)) {
        expect(avgWeights[k]).toBeGreaterThan(0.2);
        expect(avgWeights[k]).toBeLessThan(0.47);
      }
    });

    it('should give higher weight to axis with high alpha, low beta', () => {
      const priors: Record<string, WeightPrior> = {
        high: { alpha: 20, beta: 2 },
        low: { alpha: 2, beta: 20 },
      };
      let highWins = 0;
      const N = 200;
      for (let i = 0; i < N; i++) {
        const w = sampleWeights(priors);
        if (w.high > w.low) highWins++;
      }
      expect(highWins / N).toBeGreaterThan(0.8);
    });
  });

  describe('updatePriors', () => {
    let state: LearningState;

    beforeEach(() => {
      state = createInitialLearningState();
    });

    it('should increase alpha for positive reaction on high-score axes', () => {
      const scores: Record<string, number> = {
        timeliness: 0.8,
        novelty: 0.5,
        continuity: 0.1,  // below 0.3 threshold
        emotional_fit: 0.6,
        affinity: 0.4,
        surprise: 0.2,  // below 0.3 threshold
      };
      const newState = updatePriors(state, scores, 'tech', 'positive');
      // timeliness had alpha=5, score=0.8, should be 5.8
      expect(newState.priors.timeliness.alpha).toBeCloseTo(5.8);
      // continuity score=0.1 < 0.3, should stay at alpha=4
      expect(newState.priors.continuity.alpha).toBe(4);
      // surprise score=0.2 < 0.3, should stay at alpha=2
      expect(newState.priors.surprise.alpha).toBe(2);
    });

    it('should increase beta for negative reaction', () => {
      const scores: Record<string, number> = {
        timeliness: 0.8,
        novelty: 0.5,
        continuity: 0.4,
        emotional_fit: 0.6,
        affinity: 0.4,
        surprise: 0.3,
      };
      const newState = updatePriors(state, scores, 'tech', 'negative');
      // timeliness: beta = 5 + 0.8 * 0.7 = 5.56
      expect(newState.priors.timeliness.beta).toBeCloseTo(5.56);
      // alpha should stay the same
      expect(newState.priors.timeliness.alpha).toBe(5);
    });

    it('should slightly increase beta for neutral reaction', () => {
      const scores: Record<string, number> = {
        timeliness: 0.8,
        novelty: 0.5,
        continuity: 0.4,
        emotional_fit: 0.6,
        affinity: 0.4,
        surprise: 0.3,
      };
      const newState = updatePriors(state, scores, 'tech', 'neutral');
      // timeliness: beta = 5 + 0.8 * 0.2 = 5.16
      expect(newState.priors.timeliness.beta).toBeCloseTo(5.16);
    });

    it('should skip axes with score < 0.3', () => {
      const scores: Record<string, number> = {
        timeliness: 0.29,
        novelty: 0.0,
        continuity: 0.1,
        emotional_fit: 0.2,
        affinity: 0.15,
        surprise: 0.05,
      };
      const newState = updatePriors(state, scores, 'tech', 'positive');
      // All below threshold, nothing should change
      expect(newState.priors.timeliness.alpha).toBe(state.priors.timeliness.alpha);
      expect(newState.priors.novelty.alpha).toBe(state.priors.novelty.alpha);
    });

    it('should increment totalSelections and categorySelections', () => {
      const scores: Record<string, number> = {
        timeliness: 0.5,
        novelty: 0.5,
        continuity: 0.5,
        emotional_fit: 0.5,
        affinity: 0.5,
        surprise: 0.5,
      };
      const newState = updatePriors(state, scores, 'baseball', 'positive');
      expect(newState.totalSelections).toBe(1);
      expect(newState.categorySelections['baseball']).toBe(1);

      // Increment again for same category
      const newState2 = updatePriors(newState, scores, 'baseball', 'positive');
      expect(newState2.totalSelections).toBe(2);
      expect(newState2.categorySelections['baseball']).toBe(2);

      // Different category
      const newState3 = updatePriors(newState2, scores, 'tech', 'neutral');
      expect(newState3.totalSelections).toBe(3);
      expect(newState3.categorySelections['baseball']).toBe(2);
      expect(newState3.categorySelections['tech']).toBe(1);
    });

    it('should not mutate the original state', () => {
      const scores: Record<string, number> = {
        timeliness: 0.8,
        novelty: 0.5,
        continuity: 0.5,
        emotional_fit: 0.5,
        affinity: 0.5,
        surprise: 0.5,
      };
      const originalAlpha = state.priors.timeliness.alpha;
      updatePriors(state, scores, 'tech', 'positive');
      expect(state.priors.timeliness.alpha).toBe(originalAlpha);
    });

    describe('intrinsicBoost', () => {
      const scores: Record<string, number> = {
        timeliness: 0.8,
        novelty: 0.5,
        continuity: 0.4,
        emotional_fit: 0.6,
        affinity: 0.4,
        surprise: 0.3,
      };

      it('positive + intrinsicBoost=0.3 should increase alpha more than without boost', () => {
        const withoutBoost = updatePriors(state, scores, 'tech', 'positive');
        const withBoost = updatePriors(state, scores, 'tech', 'positive', 0.3);
        // timeliness: without = 5 + 0.8 = 5.8, with = 5 + 0.8 * 1.3 = 6.04
        expect(withBoost.priors.timeliness.alpha).toBeGreaterThan(withoutBoost.priors.timeliness.alpha);
        expect(withBoost.priors.timeliness.alpha).toBeCloseTo(5 + 0.8 * 1.3);
      });

      it('negative + intrinsicBoost=0.3 should increase beta less than without boost', () => {
        const withoutBoost = updatePriors(state, scores, 'tech', 'negative');
        const withBoost = updatePriors(state, scores, 'tech', 'negative', 0.3);
        // timeliness: without = 5 + 0.8*0.7 = 5.56, with = 5 + 0.8*0.7*(1-0.15) = 5.476
        expect(withBoost.priors.timeliness.beta).toBeLessThan(withoutBoost.priors.timeliness.beta);
        expect(withBoost.priors.timeliness.beta).toBeCloseTo(5 + 0.8 * 0.7 * (1 - 0.3 * 0.5));
      });

      it('neutral + intrinsicBoost=0.2 should become mildly positive (alpha increases)', () => {
        const result = updatePriors(state, scores, 'tech', 'neutral', 0.2);
        // timeliness: alpha = 5 + 0.8 * 0.2 * 0.3 = 5.048
        expect(result.priors.timeliness.alpha).toBeGreaterThan(5);
        expect(result.priors.timeliness.alpha).toBeCloseTo(5 + 0.8 * 0.2 * 0.3);
        // beta should stay unchanged
        expect(result.priors.timeliness.beta).toBe(5);
      });

      it('neutral + intrinsicBoost=0.1 should stay neutral (beta increases)', () => {
        const result = updatePriors(state, scores, 'tech', 'neutral', 0.1);
        // intrinsicBoost=0.1 <= 0.15, so beta += score * 0.2
        expect(result.priors.timeliness.beta).toBeCloseTo(5 + 0.8 * 0.2);
        // alpha unchanged
        expect(result.priors.timeliness.alpha).toBe(5);
      });

      it('intrinsicBoost=0 (default) should behave identically to no boost', () => {
        const withDefault = updatePriors(state, scores, 'tech', 'positive', 0);
        const withoutParam = updatePriors(state, scores, 'tech', 'positive');
        expect(withDefault.priors.timeliness.alpha).toBe(withoutParam.priors.timeliness.alpha);
        expect(withDefault.priors.timeliness.beta).toBe(withoutParam.priors.timeliness.beta);
      });
    });
  });

  describe('rescalePriors', () => {
    it('should not change priors under maxSum', () => {
      const state = createInitialLearningState();
      const rescaled = rescalePriors(state, 50);
      expect(rescaled.priors.timeliness.alpha).toBe(5);
      expect(rescaled.priors.timeliness.beta).toBe(5);
    });

    it('should rescale when alpha+beta > maxSum', () => {
      const state = createInitialLearningState();
      // Manually inflate timeliness
      state.priors.timeliness = { alpha: 40, beta: 20 };
      const rescaled = rescalePriors(state, 50);
      const sum = rescaled.priors.timeliness.alpha + rescaled.priors.timeliness.beta;
      expect(sum).toBeLessThanOrEqual(50);
    });

    it('should preserve ratio when rescaling', () => {
      const state = createInitialLearningState();
      state.priors.timeliness = { alpha: 40, beta: 20 };
      const originalRatio = 40 / 20;
      const rescaled = rescalePriors(state, 50);
      const newRatio = rescaled.priors.timeliness.alpha / rescaled.priors.timeliness.beta;
      expect(newRatio).toBeCloseTo(originalRatio, 3);
    });

    it('should not mutate the original state', () => {
      const state = createInitialLearningState();
      state.priors.timeliness = { alpha: 40, beta: 20 };
      rescalePriors(state, 50);
      expect(state.priors.timeliness.alpha).toBe(40);
    });
  });

  describe('createInitialLearningState', () => {
    it('should have correct default priors', () => {
      const state = createInitialLearningState();
      expect(state.priors.timeliness).toEqual({ alpha: 5, beta: 5 });
      expect(state.priors.novelty).toEqual({ alpha: 4, beta: 6 });
      expect(state.priors.continuity).toEqual({ alpha: 4, beta: 6 });
      expect(state.priors.emotional_fit).toEqual({ alpha: 3, beta: 7 });
      expect(state.priors.affinity).toEqual({ alpha: 2, beta: 8 });
      expect(state.priors.surprise).toEqual({ alpha: 2, beta: 8 });
    });

    it('should have zero totalSelections', () => {
      const state = createInitialLearningState();
      expect(state.totalSelections).toBe(0);
    });

    it('should have empty categorySelections', () => {
      const state = createInitialLearningState();
      expect(state.categorySelections).toEqual({});
    });

    it('should have version 1', () => {
      const state = createInitialLearningState();
      expect(state.version).toBe(1);
    });

    it('should have a valid ISO8601 lastUpdated', () => {
      const state = createInitialLearningState();
      expect(() => new Date(state.lastUpdated)).not.toThrow();
      expect(new Date(state.lastUpdated).toISOString()).toBe(state.lastUpdated);
    });
  });
});
