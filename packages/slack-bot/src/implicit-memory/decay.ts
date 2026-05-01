import type { MemoryEntry } from './types';
import { DECAY_HALF_LIFE_DAYS, DECAY_FLOOR } from './types';

export function calculateEffectiveConfidence(entry: MemoryEntry): number {
  const now = Date.now();
  const lastReinforced = new Date(entry.lastReinforcedAt).getTime();
  const daysSinceReinforced = (now - lastReinforced) / (24 * 60 * 60 * 1000);

  const halfLife = DECAY_HALF_LIFE_DAYS * (1 + entry.reinforceCount * 0.2);
  const decay = Math.pow(0.5, daysSinceReinforced / halfLife);

  return Math.max(entry.confidence * decay, DECAY_FLOOR);
}
