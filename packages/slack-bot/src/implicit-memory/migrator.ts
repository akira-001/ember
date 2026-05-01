import { readFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { ImplicitMemoryStore } from './store';
import type { MemoryEntry } from './types';
import { Logger } from '../logger';

interface LegacyInsight {
  insight: string;
  learnedAt: string;
  source: string;
  arousal: number;
  reinforceCount: number;
  embedding?: number[];
}

const logger = new Logger('ImplicitMemoryMigrator');

export function migrateFromUserInsights(
  insightsPath: string,
  memoryPath: string,
  botId: string,
): number {
  if (!existsSync(insightsPath)) {
    logger.info('No user-insights.json found, skipping migration');
    return 0;
  }

  const store = new ImplicitMemoryStore(memoryPath, botId);

  const stats = store.getStats();
  if (stats.total > 0) {
    logger.info(`ImplicitMemory already has ${stats.total} entries, skipping migration`);
    return 0;
  }

  let insights: LegacyInsight[];
  try {
    insights = JSON.parse(readFileSync(insightsPath, 'utf-8'));
  } catch {
    logger.error('Failed to parse user-insights.json');
    return 0;
  }

  let migrated = 0;
  for (const insight of insights) {
    const entry: MemoryEntry = {
      id: randomUUID(),
      content: insight.insight,
      context: 'マイグレーション: user-insights.json から移行',
      source: (insight.source as any) || 'proactive',
      confidence: insight.arousal ?? 0.5,
      learnedAt: insight.learnedAt,
      lastReinforcedAt: insight.learnedAt,
      reinforceCount: insight.reinforceCount ?? 0,
      embedding: insight.embedding,
    };
    store.add('facts', entry);
    migrated++;
  }

  logger.info(`Migrated ${migrated} insights from user-insights.json to implicit-memory.json`);
  return migrated;
}
