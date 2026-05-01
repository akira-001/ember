/**
 * Thompson Sampling — Beta distribution-based weight learning
 * for conversation scoring axes.
 */

export interface WeightPrior {
  alpha: number;
  beta: number;
}

export interface LearningState {
  priors: Record<string, WeightPrior>;
  totalSelections: number;
  categorySelections: Record<string, number>;
  lastUpdated: string; // ISO8601
  version: number;
}

export type Reaction = 'positive' | 'neutral' | 'negative';

/**
 * Box-Muller transform for standard normal samples.
 */
export function randn(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Marsaglia-Tsang method for Gamma(shape, 1) samples.
 * Iteration limit of 1000 with fallback to shape (expected value).
 * For shape < 1: gammaSample(shape + 1) * Math.pow(Math.random(), 1/shape)
 */
export function gammaSample(shape: number): number {
  if (shape < 1) {
    const g = gammaSample(shape + 1);
    return g * Math.pow(Math.random(), 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  for (let i = 0; i < 1000; i++) {
    let x: number = 0, v: number = 0;
    let innerAttempts = 0;
    do {
      x = randn();
      v = 1 + c * x;
      innerAttempts++;
      if (innerAttempts > 100) break;
    } while (v <= 0);

    if (v <= 0) continue; // inner loop exhausted, try outer again

    v = v * v * v;
    const u = Math.random();

    if (u < 1 - 0.0331 * (x * x) * (x * x)) {
      return d * v;
    }

    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }

  // Fallback: return expected value
  return shape;
}

/**
 * Beta(alpha, beta) sample via two gamma samples.
 */
export function betaSample(alpha: number, beta: number): number {
  const x = gammaSample(alpha);
  const y = gammaSample(beta);
  if (x + y === 0) return 0.5;
  return x / (x + y);
}

/**
 * Sample weights from each axis's Beta distribution, normalize to sum 1.0.
 */
export function sampleWeights(priors: Record<string, WeightPrior>): Record<string, number> {
  const raw: Record<string, number> = {};
  let sum = 0;

  for (const [key, prior] of Object.entries(priors)) {
    const sample = betaSample(prior.alpha, prior.beta);
    raw[key] = sample;
    sum += sample;
  }

  const weights: Record<string, number> = {};
  for (const key of Object.keys(raw)) {
    weights[key] = sum > 0 ? raw[key] / sum : 1 / Object.keys(raw).length;
  }

  return weights;
}

/**
 * Credit assignment: update priors based on reaction.
 * Returns a NEW LearningState (does not mutate input).
 */
export function updatePriors(
  learningState: LearningState,
  chosen: Record<string, number>,
  category: string,
  reaction: Reaction,
  intrinsicBoost: number = 0,
): LearningState {
  const newPriors: Record<string, WeightPrior> = {};

  for (const [axis, prior] of Object.entries(learningState.priors)) {
    const score = chosen[axis] ?? 0;
    let newAlpha = prior.alpha;
    let newBeta = prior.beta;

    if (score >= 0.3) {
      if (reaction === 'positive') {
        newAlpha += score * (1 + intrinsicBoost);
      } else if (reaction === 'negative') {
        newBeta += score * 0.7 * (1 - intrinsicBoost * 0.5);
      } else {
        // neutral: if intrinsic boost > 0.15, treat as mildly positive
        if (intrinsicBoost > 0.15) {
          newAlpha += score * intrinsicBoost * 0.3;
        } else {
          newBeta += score * 0.2;
        }
      }
    }

    newPriors[axis] = { alpha: newAlpha, beta: newBeta };
  }

  const newCategorySelections = { ...learningState.categorySelections };
  newCategorySelections[category] = (newCategorySelections[category] ?? 0) + 1;

  return {
    priors: newPriors,
    totalSelections: learningState.totalSelections + 1,
    categorySelections: newCategorySelections,
    lastUpdated: new Date().toISOString(),
    version: learningState.version,
  };
}

/**
 * If any axis's alpha+beta > maxSum, proportionally rescale.
 * Preserves ratio. Returns NEW LearningState.
 */
export function rescalePriors(learningState: LearningState, maxSum = 50): LearningState {
  const newPriors: Record<string, WeightPrior> = {};

  for (const [axis, prior] of Object.entries(learningState.priors)) {
    const sum = prior.alpha + prior.beta;
    if (sum > maxSum) {
      const scale = maxSum / sum;
      newPriors[axis] = {
        alpha: prior.alpha * scale,
        beta: prior.beta * scale,
      };
    } else {
      newPriors[axis] = { alpha: prior.alpha, beta: prior.beta };
    }
  }

  return {
    priors: newPriors,
    totalSelections: learningState.totalSelections,
    categorySelections: { ...learningState.categorySelections },
    lastUpdated: learningState.lastUpdated,
    version: learningState.version,
  };
}

/**
 * Returns default initial learning state with predefined priors.
 */
export function createInitialLearningState(): LearningState {
  return {
    priors: {
      timeliness:    { alpha: 5, beta: 5 },
      novelty:       { alpha: 4, beta: 6 },
      continuity:    { alpha: 4, beta: 6 },
      emotional_fit: { alpha: 3, beta: 7 },
      affinity:      { alpha: 2, beta: 8 },
      surprise:      { alpha: 2, beta: 8 },
    },
    totalSelections: 0,
    categorySelections: {},
    lastUpdated: new Date().toISOString(),
    version: 1,
  };
}
