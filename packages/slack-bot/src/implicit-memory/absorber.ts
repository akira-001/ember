import type { AbsorbInput, ExtractionResult, MemoryLayer, MemorySource } from './types';
import { createMemoryEntry, MEMORY_LAYERS, DAILY_ABSORB_LIMIT, BATCH_BUFFER_MS } from './types';
import { ImplicitMemoryStore } from './store';
import { Reconciler } from './reconciler';
import { DenialDetector } from './denial-detector';

const SKIP_PATTERNS = /^(うん|はい|OK|おk|そうだね|了解|ありがとう|おはよう|おやすみ|お疲れ|いいね)$/i;
const MIN_TEXT_LENGTH = 5;

export interface AbsorberDeps {
  store: ImplicitMemoryStore;
  reconciler: Reconciler;
  denialDetector: DenialDetector;
  extract: (text: string, context: string) => Promise<ExtractionResult>;
  getEmbedding: (text: string) => Promise<number[]>;
}

export class MemoryAbsorber {
  private store: ImplicitMemoryStore;
  private reconciler: Reconciler;
  private denialDetector: DenialDetector;
  private extractFn: AbsorberDeps['extract'];
  private getEmbeddingFn: AbsorberDeps['getEmbedding'];

  private dailyCount = 0;
  private dailyResetDate: string = new Date().toISOString().slice(0, 10);

  private buffer: AbsorbInput[] = [];
  private bufferTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: AbsorberDeps) {
    this.store = deps.store;
    this.reconciler = deps.reconciler;
    this.denialDetector = deps.denialDetector;
    this.extractFn = deps.extract;
    this.getEmbeddingFn = deps.getEmbedding;
  }

  absorb(input: AbsorbInput): void {
    if (this.shouldSkip(input.text)) return;

    const denial = this.denialDetector.detect(input.text);
    if (denial) {
      this.reconciler.handleExplicitDenial(input.text, denial.correctedContent).catch(() => {});
      return;
    }

    this.buffer.push(input);
    if (!this.bufferTimer) {
      this.bufferTimer = setTimeout(() => this.flushBuffer(), BATCH_BUFFER_MS);
    }
  }

  async absorbImmediate(input: AbsorbInput): Promise<void> {
    if (this.shouldSkip(input.text)) return;

    const denial = this.denialDetector.detect(input.text);
    if (denial) {
      await this.reconciler.handleExplicitDenial(input.text, denial.correctedContent);
      return;
    }

    await this.processText(input.text, input.source, input.context);
  }

  getDailyAbsorbCount(): number {
    this.checkDailyReset();
    return this.dailyCount;
  }

  dispose(): void {
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }
  }

  private async flushBuffer(): Promise<void> {
    this.bufferTimer = null;
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0);
    const combinedText = batch.map((b) => b.text).join('\n');
    const source = batch[0].source;
    const context = batch.map((b) => b.context).filter(Boolean).join('; ');

    await this.processText(combinedText, source, context);
  }

  private async processText(text: string, source: MemorySource, context: string): Promise<void> {
    this.checkDailyReset();
    if (this.dailyCount >= DAILY_ABSORB_LIMIT) return;

    try {
      const extracted = await this.extractFn(text, context);
      this.dailyCount++;

      for (const layer of MEMORY_LAYERS) {
        const items = extracted[layer];
        if (!items || items.length === 0) continue;

        for (const item of items) {
          const entry = createMemoryEntry({
            content: item.content,
            context: item.context || context,
            source,
            layer,
            intensity: item.intensity,
          });

          try {
            entry.embedding = await this.getEmbeddingFn(item.content);
          } catch {
            // Continue without embedding
          }

          if (layer === 'patterns') {
            await this.reconciler.detectPatternShift(entry);
          } else {
            await this.reconciler.checkAndReconcile(layer, entry);
          }
        }
      }
    } catch {
      // Silently fail — human-like learning doesn't crash on bad input
    }
  }

  private shouldSkip(text: string): boolean {
    if (text.length < MIN_TEXT_LENGTH) return true;
    if (SKIP_PATTERNS.test(text.trim())) return true;
    return false;
  }

  private checkDailyReset(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dailyResetDate) {
      this.dailyCount = 0;
      this.dailyResetDate = today;
    }
  }
}
