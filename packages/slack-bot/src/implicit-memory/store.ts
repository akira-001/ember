import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { ImplicitMemory, MemoryEntry, MemoryLayer, CorrectionEntry } from './types';
import { createEmptyImplicitMemory, MEMORY_LAYERS } from './types';

interface PersistedData {
  [botId: string]: ImplicitMemory;
}

export class ImplicitMemoryStore {
  private memory: ImplicitMemory;

  constructor(
    private filePath: string,
    private botId: string,
  ) {
    this.memory = this.load();
  }

  getAll(): ImplicitMemory {
    return this.memory;
  }

  getLayer(layer: MemoryLayer): MemoryEntry[] {
    return this.memory[layer];
  }

  getCorrections(): CorrectionEntry[] {
    return this.memory.corrections;
  }

  add(layer: MemoryLayer, entry: MemoryEntry): void {
    this.memory[layer].push(entry);
    this.save();
  }

  update(layer: MemoryLayer, id: string, updates: Partial<MemoryEntry>): void {
    const entries = this.memory[layer];
    const idx = entries.findIndex((e) => e.id === id);
    if (idx === -1) return;
    entries[idx] = { ...entries[idx], ...updates };
    this.save();
  }

  remove(layer: MemoryLayer, id: string): void {
    this.memory[layer] = this.memory[layer].filter((e) => e.id !== id);
    this.save();
  }

  findById(layer: MemoryLayer, id: string): MemoryEntry | undefined {
    return this.memory[layer].find((e) => e.id === id);
  }

  addCorrection(correction: CorrectionEntry): void {
    this.memory.corrections.push(correction);
    this.save();
  }

  getStats(): Record<MemoryLayer | 'corrections' | 'total', number> {
    const stats: any = {};
    let total = 0;
    for (const layer of MEMORY_LAYERS) {
      stats[layer] = this.memory[layer].length;
      total += this.memory[layer].length;
    }
    stats.corrections = this.memory.corrections.length;
    stats.total = total;
    return stats;
  }

  getAllEntries(): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    for (const layer of MEMORY_LAYERS) {
      entries.push(...this.memory[layer]);
    }
    return entries;
  }

  private load(): ImplicitMemory {
    if (!existsSync(this.filePath)) return createEmptyImplicitMemory();
    try {
      const data: PersistedData = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      const botData = data[this.botId];
      if (!botData) return createEmptyImplicitMemory();
      return {
        facts: botData.facts ?? [],
        preferences: botData.preferences ?? [],
        patterns: botData.patterns ?? [],
        values: botData.values ?? [],
        expressions: botData.expressions ?? [],
        corrections: botData.corrections ?? [],
      };
    } catch {
      return createEmptyImplicitMemory();
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    let data: PersistedData = {};
    if (existsSync(this.filePath)) {
      try {
        data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      } catch {
        data = {};
      }
    }
    data[this.botId] = this.memory;
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
