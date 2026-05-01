import { Logger } from './logger';
import { getDateInTz } from './timezone';

export interface RateLimitConfig {
  messagesPerMinutePerBot: number;
  botToBotMaxTurns: number;
  botToBotDailyLimit: number;
  botToBotCooldownMs: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  messagesPerMinutePerBot: 5,
  botToBotMaxTurns: 6,
  botToBotDailyLimit: 50,
  botToBotCooldownMs: 60000,
};

// Debate mode overrides
const DEBATE_CONFIG = {
  messagesPerMinutePerBot: 10,
  botToBotMaxTurns: 50,  // hard cap
  botToBotDailyLimit: 150,
};

interface ThreadTurnRecord {
  turns: number;
  botIds: string[];
  timestamps: number[];
}

export class RateLimiter {
  private config: RateLimitConfig;
  private logger = new Logger('RateLimiter');

  // Per-bot sliding window: botId -> array of send timestamps (ms)
  private sendTimestamps: Map<string, number[]> = new Map();

  // Bot-to-bot thread tracking: threadTs -> turn record
  private threadTurns: Map<string, ThreadTurnRecord> = new Map();

  // Daily bot-to-bot turn counter
  private dailyTurns: number = 0;
  private dailyResetDate: string = ''; // YYYY-MM-DD in JST

  // Cooldown tracking
  private cooldownUntil: number = 0;

  // Debate mode: threads that are in debate mode (relaxed limits)
  private debateThreads: Set<string> = new Set();

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dailyResetDate = this.getTodayJST();
    this.logger.info('RateLimiter initialized', this.config);
  }

  // --- Per-bot message rate ---

  canSend(botId: string, threadTs?: string): boolean {
    this.pruneOldTimestamps(botId);
    const timestamps = this.sendTimestamps.get(botId) || [];
    const limit = (threadTs && this.debateThreads.has(threadTs))
      ? DEBATE_CONFIG.messagesPerMinutePerBot
      : this.config.messagesPerMinutePerBot;
    return timestamps.length < limit;
  }

  recordSend(botId: string): void {
    if (!this.sendTimestamps.has(botId)) {
      this.sendTimestamps.set(botId, []);
    }
    this.sendTimestamps.get(botId)!.push(Date.now());
    this.logger.debug(`Recorded send for bot ${botId}`);
  }

  // --- Bot-to-bot conversation limits ---

  canBotToBotTurn(threadTs: string): boolean {
    this.checkDailyReset();

    const isDebate = this.debateThreads.has(threadTs);

    // Skip cooldown check for debates
    if (!isDebate && this.isInCooldown()) {
      this.logger.debug('Bot-to-bot blocked: cooldown active');
      return false;
    }

    const dailyLimit = isDebate ? DEBATE_CONFIG.botToBotDailyLimit : this.config.botToBotDailyLimit;
    if (this.dailyTurns >= dailyLimit) {
      this.logger.debug('Bot-to-bot blocked: daily limit reached');
      return false;
    }

    const maxTurns = isDebate ? DEBATE_CONFIG.botToBotMaxTurns : this.config.botToBotMaxTurns;
    const record = this.threadTurns.get(threadTs);
    if (record && record.turns >= maxTurns) {
      this.logger.debug(`Bot-to-bot blocked: thread ${threadTs} hit max turns (${record.turns})`);
      return false;
    }

    return true;
  }

  markDebateThread(threadTs: string): void {
    this.debateThreads.add(threadTs);
    this.logger.info(`Marked thread as debate: ${threadTs}`);
  }

  unmarkDebateThread(threadTs: string): void {
    this.debateThreads.delete(threadTs);
    this.logger.info(`Unmarked debate thread: ${threadTs}`);
  }

  recordBotToBotTurn(threadTs: string, botId: string): void {
    this.checkDailyReset();

    if (!this.threadTurns.has(threadTs)) {
      this.threadTurns.set(threadTs, { turns: 0, botIds: [], timestamps: [] });
    }

    const record = this.threadTurns.get(threadTs)!;
    record.turns++;
    record.botIds.push(botId);
    record.timestamps.push(Date.now());
    this.dailyTurns++;

    this.logger.debug(`Bot-to-bot turn recorded: thread=${threadTs} bot=${botId} turns=${record.turns} daily=${this.dailyTurns}`);
  }

  getBotToBotTurns(threadTs: string): number {
    return this.threadTurns.get(threadTs)?.turns ?? 0;
  }

  isDailyLimitReached(): boolean {
    this.checkDailyReset();
    return this.dailyTurns >= this.config.botToBotDailyLimit;
  }

  isInCooldown(): boolean {
    return Date.now() < this.cooldownUntil;
  }

  startCooldown(): void {
    this.cooldownUntil = Date.now() + this.config.botToBotCooldownMs;
    this.logger.info(`Cooldown started, expires at ${new Date(this.cooldownUntil).toISOString()}`);
  }

  // --- Stats ---

  getStats(): { messagesSent: Record<string, number>; botToBotTurnsToday: number } {
    this.checkDailyReset();

    const messagesSent: Record<string, number> = {};
    this.sendTimestamps.forEach((timestamps, botId) => {
      messagesSent[botId] = timestamps.length;
    });

    return {
      messagesSent,
      botToBotTurnsToday: this.dailyTurns,
    };
  }

  // --- Cleanup ---

  cleanup(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    // Clean per-bot timestamps
    const botIdsToDelete: string[] = [];
    this.sendTimestamps.forEach((timestamps, botId) => {
      const filtered = timestamps.filter(ts => ts > oneHourAgo);
      if (filtered.length === 0) {
        botIdsToDelete.push(botId);
      } else {
        this.sendTimestamps.set(botId, filtered);
      }
    });
    botIdsToDelete.forEach(id => this.sendTimestamps.delete(id));

    // Clean thread records older than 1 hour
    const threadsToDelete: string[] = [];
    this.threadTurns.forEach((record, threadTs) => {
      const lastTimestamp = record.timestamps[record.timestamps.length - 1];
      if (lastTimestamp && lastTimestamp < oneHourAgo) {
        threadsToDelete.push(threadTs);
      }
    });
    threadsToDelete.forEach(ts => this.threadTurns.delete(ts));

    this.logger.debug('Cleanup completed');
  }

  // --- Private helpers ---

  private pruneOldTimestamps(botId: string): void {
    const timestamps = this.sendTimestamps.get(botId);
    if (!timestamps) return;

    const oneMinuteAgo = Date.now() - 60 * 1000;
    const filtered = timestamps.filter(ts => ts > oneMinuteAgo);
    this.sendTimestamps.set(botId, filtered);
  }

  private getTodayJST(): string {
    // Get current date in configured timezone
    const now = new Date();
    return getDateInTz(now);
  }

  private checkDailyReset(): void {
    const today = this.getTodayJST();
    if (today !== this.dailyResetDate) {
      this.logger.info(`Daily reset: ${this.dailyResetDate} -> ${today}, clearing ${this.dailyTurns} turns`);
      this.dailyTurns = 0;
      this.dailyResetDate = today;
    }
  }
}
