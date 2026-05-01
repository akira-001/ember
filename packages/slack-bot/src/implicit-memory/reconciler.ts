import { randomUUID } from 'crypto';
import { ImplicitMemoryStore } from './store';
import type { MemoryEntry, MemoryLayer, CorrectionEntry } from './types';
import {
  CONTRADICTION_PENALTY,
  PATTERN_SHIFT_PENALTY,
  REINFORCEMENT_BOOST,
  CONFIDENCE_MAX,
  DENIAL_CONFIDENCE,
  DIRECT_TEACHING_CONFIDENCE,
  DEFAULT_CONFIDENCE,
  CONTRADICTION_SIMILARITY_THRESHOLD,
  MEMORY_LAYERS,
} from './types';

export interface ReconcilerDeps {
  judge: (prompt: { existing: string; new: string; prompt: string }) => Promise<string>;
  getEmbedding: (text: string) => Promise<number[]>;
  cosineSimilarity: (a: number[], b: number[]) => number;
}

export type ReconcileResult = 'new' | 'reinforcement' | 'contradiction';

export class Reconciler {
  constructor(
    private store: ImplicitMemoryStore,
    private deps: ReconcilerDeps,
  ) {}

  async checkAndReconcile(layer: MemoryLayer, newEntry: MemoryEntry): Promise<ReconcileResult> {
    const existing = this.store.getLayer(layer);

    let bestMatch: MemoryEntry | null = null;
    let bestSim = 0;

    for (const entry of existing) {
      if (!entry.embedding || !newEntry.embedding) continue;
      const sim = this.deps.cosineSimilarity(entry.embedding, newEntry.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = entry;
      }
    }

    if (!bestMatch || bestSim < CONTRADICTION_SIMILARITY_THRESHOLD) {
      this.store.add(layer, newEntry);
      return 'new';
    }

    const judgment = await this.deps.judge({
      existing: bestMatch.content,
      new: newEntry.content,
      prompt: `この2つの情報は:
A) 同じことを言っている（裏付け）
B) 矛盾している（片方が間違い）
C) 関連するが矛盾ではない（補足情報）
1文字で回答: A/B/C`,
    });

    const answer = judgment.trim().charAt(0).toUpperCase();

    if (answer === 'A') {
      const newConfidence = Math.min(bestMatch.confidence + REINFORCEMENT_BOOST, CONFIDENCE_MAX);
      this.store.update(layer, bestMatch.id, {
        confidence: newConfidence,
        reinforceCount: bestMatch.reinforceCount + 1,
        lastReinforcedAt: new Date().toISOString(),
      });
      return 'reinforcement';
    }

    if (answer === 'B') {
      const newConfidence = Math.max(
        Math.round((bestMatch.confidence - CONTRADICTION_PENALTY) * 1e10) / 1e10,
        0,
      );
      this.store.update(layer, bestMatch.id, { confidence: newConfidence });
      this.store.add(layer, newEntry);
      this.store.addCorrection({
        id: randomUUID(),
        originalMemoryId: bestMatch.id,
        trigger: 'contradiction',
        before: bestMatch.content,
        after: newEntry.content,
        reason: `新しい情報「${newEntry.content}」が既存の「${bestMatch.content}」と矛盾`,
        correctedAt: new Date().toISOString(),
      });
      return 'contradiction';
    }

    this.store.add(layer, newEntry);
    return 'new';
  }

  async handleExplicitDenial(deniedText: string, correctedContent?: string): Promise<void> {
    const embedding = await this.deps.getEmbedding(deniedText);

    for (const layer of MEMORY_LAYERS) {
      const entries = [...this.store.getLayer(layer)];
      for (const entry of entries) {
        if (!entry.embedding) continue;
        const sim = this.deps.cosineSimilarity(embedding, entry.embedding);
        if (sim >= CONTRADICTION_SIMILARITY_THRESHOLD) {
          this.store.update(layer, entry.id, { confidence: DENIAL_CONFIDENCE });

          if (correctedContent) {
            const correctedEntry: MemoryEntry = {
              id: randomUUID(),
              content: correctedContent,
              context: `明示的な訂正: 「${entry.content}」→「${correctedContent}」`,
              source: entry.source,
              confidence: DIRECT_TEACHING_CONFIDENCE,
              learnedAt: new Date().toISOString(),
              lastReinforcedAt: new Date().toISOString(),
              reinforceCount: 0,
              embedding: await this.deps.getEmbedding(correctedContent),
            };
            this.store.add(layer, correctedEntry);
          }

          this.store.addCorrection({
            id: randomUUID(),
            originalMemoryId: entry.id,
            trigger: 'explicit_denial',
            before: entry.content,
            after: correctedContent ?? '(否定のみ、正解不明)',
            reason: `ユーザーが明示的に否定: 「${deniedText}」`,
            correctedAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  async detectPatternShift(observation: MemoryEntry): Promise<void> {
    const patterns = [...this.store.getLayer('patterns')];

    for (const pattern of patterns) {
      if (!pattern.embedding || !observation.embedding) continue;
      const sim = this.deps.cosineSimilarity(pattern.embedding, observation.embedding);
      if (sim < CONTRADICTION_SIMILARITY_THRESHOLD) continue;

      const judgment = await this.deps.judge({
        existing: pattern.content,
        new: observation.content,
        prompt: `この観測は既存のパターンと:
A) 一致している
B) 矛盾している（パターンが変化した可能性）
1文字で回答: A/B`,
      });

      const answer = judgment.trim().charAt(0).toUpperCase();

      if (answer === 'B') {
        const newConfidence = Math.max(pattern.confidence - PATTERN_SHIFT_PENALTY, 0);
        this.store.update('patterns', pattern.id, { confidence: newConfidence });
        this.store.add('patterns', observation);
        this.store.addCorrection({
          id: randomUUID(),
          originalMemoryId: pattern.id,
          trigger: 'pattern_shift',
          before: pattern.content,
          after: observation.content,
          reason: `パターン変化: 「${observation.content}」が「${pattern.content}」と不整合`,
          correctedAt: new Date().toISOString(),
        });
      }
    }
  }
}
