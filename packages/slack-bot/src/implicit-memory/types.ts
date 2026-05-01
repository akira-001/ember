import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Memory layers
// ---------------------------------------------------------------------------

export const MEMORY_LAYERS = ['facts', 'preferences', 'patterns', 'values', 'expressions'] as const;
export type MemoryLayer = (typeof MEMORY_LAYERS)[number];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIDENCE = 0.6;
export const DIRECT_TEACHING_CONFIDENCE = 0.8;
export const DENIAL_CONFIDENCE = 0.1;
export const REINFORCEMENT_BOOST = 0.1;
export const CONTRADICTION_PENALTY = 0.2;
export const PATTERN_SHIFT_PENALTY = 0.15;
export const CONFIDENCE_MAX = 0.95;
export const CONFIDENCE_ACTIVE_THRESHOLD = 0.2;
export const SIMILARITY_THRESHOLD = 0.7;
export const CONTRADICTION_SIMILARITY_THRESHOLD = 0.7;
export const DECAY_HALF_LIFE_DAYS = 90;
export const DECAY_FLOOR = 0.05;
export const BATCH_BUFFER_MS = 30_000;
export const DAILY_ABSORB_LIMIT = 200;

// ---------------------------------------------------------------------------
// Source types
// ---------------------------------------------------------------------------

export type MemorySource =
  | 'listening'
  | 'slack_message'
  | 'slack_reaction'
  | 'proactive'
  | 'calendar'
  | 'email'
  | 'rss'
  | 'inferred';

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  content: string;
  context: string;
  source: MemorySource;
  confidence: number;
  intensity?: 'strong' | 'moderate' | 'slight';
  learnedAt: string;
  lastReinforcedAt: string;
  reinforceCount: number;
  embedding?: number[];
}

export interface CorrectionEntry {
  id: string;
  originalMemoryId: string;
  trigger: 'explicit_denial' | 'contradiction' | 'pattern_shift';
  before: string;
  after: string;
  reason: string;
  correctedAt: string;
}

export interface ImplicitMemory {
  facts: MemoryEntry[];
  preferences: MemoryEntry[];
  patterns: MemoryEntry[];
  values: MemoryEntry[];
  expressions: MemoryEntry[];
  corrections: CorrectionEntry[];
}

export interface AbsorbInput {
  text: string;
  source: MemorySource;
  context: string;
}

export interface ExtractedMemory {
  content: string;
  context: string;
  intensity?: 'strong' | 'moderate' | 'slight';
}

export interface ExtractionResult {
  facts: ExtractedMemory[];
  preferences: ExtractedMemory[];
  patterns: ExtractedMemory[];
  values: ExtractedMemory[];
  expressions: ExtractedMemory[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMemoryEntry(params: {
  content: string;
  context: string;
  source: MemorySource;
  layer: MemoryLayer;
  confidence?: number;
  intensity?: 'strong' | 'moderate' | 'slight';
}): MemoryEntry {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    content: params.content,
    context: params.context,
    source: params.source,
    confidence: params.confidence ?? DEFAULT_CONFIDENCE,
    intensity: params.intensity,
    learnedAt: now,
    lastReinforcedAt: now,
    reinforceCount: 0,
  };
}

export function createEmptyImplicitMemory(): ImplicitMemory {
  return {
    facts: [],
    preferences: [],
    patterns: [],
    values: [],
    expressions: [],
    corrections: [],
  };
}
