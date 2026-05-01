import { ImplicitMemoryStore } from './store';
import type { MemoryEntry, MemoryLayer } from './types';
import { MEMORY_LAYERS, CONFIDENCE_ACTIVE_THRESHOLD } from './types';
import { calculateEffectiveConfidence } from './decay';

export interface RecallDeps {
  getEmbedding: (text: string) => Promise<number[]>;
  cosineSimilarity: (a: number[], b: number[]) => number;
}

const LAYER_LABELS: Record<MemoryLayer, string> = {
  facts: '事実',
  preferences: '嗜好',
  patterns: 'パターン',
  values: '価値観',
  expressions: '言い回し',
};

function confidenceLabel(c: number): string {
  if (c >= 0.7) return '高';
  if (c >= 0.4) return '中';
  return '低';
}

interface ScoredEntry extends MemoryEntry {
  _layer: MemoryLayer;
  _score: number;
  _effectiveConfidence: number;
}

export class MemoryRecall {
  constructor(
    private store: ImplicitMemoryStore,
    private deps: RecallDeps,
  ) {}

  async getRelevantMemories(context: string, limit: number = 10): Promise<ScoredEntry[]> {
    const contextEmbedding = await this.deps.getEmbedding(context);
    const scored: ScoredEntry[] = [];

    for (const layer of MEMORY_LAYERS) {
      const entries = this.store.getLayer(layer);
      for (const entry of entries) {
        const ec = calculateEffectiveConfidence(entry);
        if (ec < CONFIDENCE_ACTIVE_THRESHOLD) continue;
        if (!entry.embedding) continue;

        const similarity = this.deps.cosineSimilarity(contextEmbedding, entry.embedding);
        const score = ec * similarity;

        if (score > 0.3) {
          scored.push({ ...entry, _layer: layer, _score: score, _effectiveConfidence: ec });
        }
      }
    }

    scored.sort((a, b) => b._score - a._score);

    const result: ScoredEntry[] = [];
    const layerCounts: Record<string, number> = {};
    for (const entry of scored) {
      const count = layerCounts[entry._layer] ?? 0;
      if (count >= 3) continue;
      layerCounts[entry._layer] = count + 1;
      result.push(entry);
      if (result.length >= limit) break;
    }

    return result;
  }

  formatForPrompt(entries: Array<MemoryEntry & { _layer?: MemoryLayer; confidence: number }>): string {
    if (entries.length === 0) return 'まだ何も知らない';

    const grouped: Partial<Record<MemoryLayer, Array<{ content: string; confidence: number; intensity?: string }>>> = {};
    for (const entry of entries) {
      const layer: MemoryLayer = (entry as any)._layer ?? 'facts';
      if (!grouped[layer]) grouped[layer] = [];
      grouped[layer]!.push({
        content: entry.content,
        confidence: entry.confidence,
        intensity: entry.intensity,
      });
    }

    const sections: string[] = [];
    for (const layer of MEMORY_LAYERS) {
      const items = grouped[layer];
      if (!items || items.length === 0) continue;
      const label = LAYER_LABELS[layer];
      const lines = items.map((i) => `- ${i.content} (確信度: ${confidenceLabel(i.confidence)})`);
      sections.push(`### ${label}\n${lines.join('\n')}`);
    }

    return sections.join('\n\n');
  }
}
