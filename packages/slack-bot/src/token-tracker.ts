import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';
import { getDateInTz } from './timezone';

export interface TokenUsageEntry {
  botId: string;
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  context: string;
}

export class TokenTracker {
  private logger = new Logger('TokenTracker');
  private filePath: string;
  private recentEntries: TokenUsageEntry[] = [];
  private cacheLoadedUntil: number = 0; // file position already loaded

  constructor(dataDir: string = 'data') {
    this.filePath = path.resolve(dataDir, 'token-usage.jsonl');
    this.ensureDataDir(dataDir);
    this.loadRecentEntries();
  }

  record(entry: TokenUsageEntry): void {
    try {
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.filePath, line, 'utf-8');
      this.recentEntries.push(entry);
      this.pruneCache();
      this.logger.debug(`Token usage recorded: bot=${entry.botId} cost=$${entry.costUsd.toFixed(6)} context=${entry.context}`);
    } catch (err) {
      this.logger.error('Failed to record token usage', err);
    }
  }

  getHourlyUsage(botId?: string): number {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    return this.sumCost(oneHourAgo, botId);
  }

  getDailyUsage(botId?: string): number {
    const todayStart = this.getTodayStartJST();
    return this.sumCost(todayStart, botId);
  }

  isOverBudget(budgetPerHour?: number, budgetPerDay?: number): boolean {
    if (budgetPerHour !== undefined && this.getHourlyUsage() >= budgetPerHour) {
      this.logger.warn(`Hourly budget exceeded: $${this.getHourlyUsage().toFixed(4)} >= $${budgetPerHour}`);
      return true;
    }
    if (budgetPerDay !== undefined && this.getDailyUsage() >= budgetPerDay) {
      this.logger.warn(`Daily budget exceeded: $${this.getDailyUsage().toFixed(4)} >= $${budgetPerDay}`);
      return true;
    }
    return false;
  }

  // --- Private helpers ---

  private ensureDataDir(dataDir: string): void {
    try {
      const resolvedDir = path.resolve(dataDir);
      if (!fs.existsSync(resolvedDir)) {
        fs.mkdirSync(resolvedDir, { recursive: true });
        this.logger.info(`Created data directory: ${resolvedDir}`);
      }
    } catch (err) {
      this.logger.error('Failed to create data directory', err);
    }
  }

  private loadRecentEntries(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.logger.debug('Token usage file does not exist yet, starting fresh');
        return;
      }

      const content = fs.readFileSync(this.filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      // Only keep entries from last 25 hours (enough for both hourly and daily queries)
      const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as TokenUsageEntry;
          if (entry.timestamp >= cutoff) {
            this.recentEntries.push(entry);
          }
        } catch {
          // Skip malformed lines
        }
      }

      this.logger.info(`Loaded ${this.recentEntries.length} recent token usage entries`);
    } catch (err) {
      this.logger.error('Failed to load token usage file', err);
    }
  }

  private sumCost(since: string, botId?: string): number {
    let total = 0;
    for (const entry of this.recentEntries) {
      if (entry.timestamp >= since) {
        if (botId === undefined || entry.botId === botId) {
          total += entry.costUsd;
        }
      }
    }
    return total;
  }

  private getTodayStartJST(): string {
    // Get today's date in JST, return as ISO string at midnight JST (= 15:00 UTC previous day)
    const now = new Date();
    const jstDate = getDateInTz(now); // YYYY-MM-DD
    // Midnight JST = date + T00:00:00+09:00
    // Convert to UTC: subtract 9 hours
    const midnightJST = new Date(`${jstDate}T00:00:00+09:00`);
    return midnightJST.toISOString();
  }

  private pruneCache(): void {
    // Keep only last 25 hours in memory
    const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    this.recentEntries = this.recentEntries.filter(e => e.timestamp >= cutoff);
  }
}
