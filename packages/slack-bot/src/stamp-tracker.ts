import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';
import type { BotRegistry } from './bot-registry';
import { emojiToDelta } from './proactive-state';

export interface StampEntry {
  botId: string;
  emoji: string;
  messageTs: string;
  channel: string;
  timestamp: string;
}

export interface WeeklyScore {
  scores: Record<string, number>;
  weekStart: string;
  stamps: StampEntry[];
}

interface WeeklyHistory {
  weeks: WeeklyScore[];
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export class StampTracker {
  private dataPath: string;
  private historyPath: string;
  private currentWeek: WeeklyScore;
  private logger: Logger;
  private registry?: BotRegistry;

  constructor(registry?: BotRegistry, dataDir?: string) {
    const dir = dataDir || 'data';
    this.dataPath = path.resolve(dir, 'stamp-scores.json');
    this.historyPath = path.resolve(dir, 'stamp-history.json');
    this.logger = new Logger('StampTracker');
    this.registry = registry;

    // Ensure data directory exists
    const resolvedDir = path.dirname(this.dataPath);
    if (!fs.existsSync(resolvedDir)) {
      fs.mkdirSync(resolvedDir, { recursive: true });
    }

    this.currentWeek = this.load();
    this.checkWeekRollover();
  }

  record(botId: string, emoji: string, messageTs: string, channel: string): void {
    this.checkWeekRollover();

    const entry: StampEntry = {
      botId,
      emoji,
      messageTs,
      channel,
      timestamp: new Date().toISOString(),
    };

    this.currentWeek.stamps.push(entry);
    const delta = emojiToDelta(emoji);
    const increment = delta >= 0 ? 1 : -1;
    this.currentWeek.scores[botId] = (this.currentWeek.scores[botId] || 0) + increment;

    this.logger.info(`Stamp recorded: ${emoji} (${increment > 0 ? '+' : ''}${increment}) for ${botId}`, {
      botId,
      emoji,
      delta,
      increment,
      channel,
      scores: this.currentWeek.scores,
    });

    this.save();
  }

  getScores(): Record<string, number> {
    this.checkWeekRollover();
    return { ...this.currentWeek.scores };
  }

  getLeader(): { botId: string; score: number; margin: number } | null {
    this.checkWeekRollover();
    const entries = Object.entries(this.currentWeek.scores);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1]);
    if (entries.length < 2) {
      return { botId: entries[0][0], score: entries[0][1], margin: entries[0][1] };
    }
    if (entries[0][1] === entries[1][1]) return null; // tied
    return { botId: entries[0][0], score: entries[0][1], margin: entries[0][1] - entries[1][1] };
  }

  getBreakdown(botId: string): Record<string, number> {
    this.checkWeekRollover();
    const breakdown: Record<string, number> = {};

    for (const stamp of this.currentWeek.stamps) {
      if (stamp.botId === botId) {
        breakdown[stamp.emoji] = (breakdown[stamp.emoji] || 0) + 1;
      }
    }

    return breakdown;
  }

  buildScoreSummary(): string {
    this.checkWeekRollover();
    const lines: string[] = ['今週のスタンプスコア（月曜リセット）:'];

    const botIds = this.registry
      ? this.registry.getBotIds()
      : Object.keys(this.currentWeek.scores);

    for (const botId of botIds) {
      const displayName = this.registry?.getDisplayName(botId) ?? botId;
      const score = this.currentWeek.scores[botId] || 0;
      const breakdown = this.formatBreakdown(botId);
      lines.push(` ${displayName}: ${score}スタンプ${breakdown ? `（${breakdown}）` : ''}`);
    }

    const leader = this.getLeader();
    if (!leader) {
      lines.push(' → 同点');
    } else {
      const leaderName = this.registry?.getDisplayName(leader.botId) ?? leader.botId;
      lines.push(` → ${leaderName}が${leader.margin}スタンプリード中`);
    }

    return lines.join('\n');
  }

  buildStrategyContext(): string {
    this.checkWeekRollover();
    const lines: string[] = [];

    const lastWeek = this.getLastWeekFromHistory();
    if (lastWeek) {
      const entries = Object.entries(lastWeek.scores);
      entries.sort((a, b) => b[1] - a[1]);

      if (entries.length >= 2 && entries[0][1] !== entries[1][1]) {
        const winnerName = this.registry?.getDisplayName(entries[0][0]) ?? entries[0][0];
        const scoreSummary = entries
          .map(([id, s]) => `${this.registry?.getDisplayName(id) ?? id}${s}`)
          .join(' vs ');
        lines.push(`先週の振り返り: ${scoreSummary}で${winnerName}の勝ち。`);
      } else {
        const scoreSummary = entries
          .map(([id, s]) => `${this.registry?.getDisplayName(id) ?? id}${s}`)
          .join(' vs ');
        lines.push(`先週の振り返り: ${scoreSummary}で引き分け。`);
      }

      // Breakdown per bot
      for (const [botId] of entries) {
        const stamps = this.groupStampsByEmoji(lastWeek.stamps, botId);
        if (stamps.length > 0) {
          const name = this.registry?.getDisplayName(botId) ?? botId;
          lines.push(` ${name}が多くもらったスタンプ: ${stamps.join(', ')}`);
        }
      }
    } else {
      lines.push('先週のデータなし（初週または履歴なし）。');
    }

    // Current week progress
    const entries = Object.entries(this.currentWeek.scores);
    const scoreSummary = entries
      .map(([id, s]) => `${this.registry?.getDisplayName(id) ?? id}${s}`)
      .join(' vs ');
    lines.push(`今週の途中経過: ${scoreSummary || 'まだデータなし'}。`);
    lines.push('今週の戦略を考えよう。');

    return lines.join('\n');
  }

  private checkWeekRollover(): void {
    const currentWeekStart = this.getCurrentWeekStart();

    if (this.currentWeek.weekStart !== currentWeekStart) {
      this.logger.info('Week rollover detected', {
        previousWeekStart: this.currentWeek.weekStart,
        newWeekStart: currentWeekStart,
        finalScore: this.currentWeek.scores,
      });

      if (this.currentWeek.stamps.length > 0) {
        this.archiveWeek(this.currentWeek);
      }

      this.currentWeek = {
        scores: {},
        weekStart: currentWeekStart,
        stamps: [],
      };

      this.save();
    }
  }

  private getCurrentWeekStart(): string {
    const now = new Date();
    const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
    const dayOfWeek = jstNow.getUTCDay();
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const mondayJst = new Date(jstNow);
    mondayJst.setUTCDate(mondayJst.getUTCDate() - daysSinceMonday);
    mondayJst.setUTCHours(0, 0, 0, 0);
    const mondayUtc = new Date(mondayJst.getTime() - JST_OFFSET_MS);
    return mondayUtc.toISOString();
  }

  private save(): void {
    try {
      fs.writeFileSync(this.dataPath, JSON.stringify(this.currentWeek, null, 2), 'utf-8');
      this.logger.debug('Saved stamp scores');
    } catch (err) {
      this.logger.error('Failed to save stamp scores', err);
    }
  }

  private load(): WeeklyScore {
    try {
      if (fs.existsSync(this.dataPath)) {
        const raw = fs.readFileSync(this.dataPath, 'utf-8');
        const data = JSON.parse(raw) as any;
        return this.migrateWeeklyScore(data);
      }
    } catch (err) {
      this.logger.error('Failed to load stamp scores, starting fresh', err);
    }

    return {
      scores: {},
      weekStart: this.getCurrentWeekStart(),
      stamps: [],
    };
  }

  /** Migrate legacy format (mei/eve fixed fields → scores Record) */
  private migrateWeeklyScore(data: any): WeeklyScore {
    if ('mei' in data && !('scores' in data)) {
      data.scores = {};
      for (const stamp of (data.stamps || [])) {
        data.scores[stamp.botId] = (data.scores[stamp.botId] || 0) + 1;
      }
      if ((data.mei || 0) > (data.scores['mei'] || 0)) data.scores['mei'] = data.mei;
      if ((data.eve || 0) > (data.scores['eve'] || 0)) data.scores['eve'] = data.eve;
      delete data.mei;
      delete data.eve;
      this.logger.info('Migrated legacy stamp format', { scores: data.scores });
    }
    return data as WeeklyScore;
  }

  private archiveWeek(week: WeeklyScore): void {
    try {
      let history: WeeklyHistory = { weeks: [] };

      if (fs.existsSync(this.historyPath)) {
        const raw = fs.readFileSync(this.historyPath, 'utf-8');
        history = JSON.parse(raw) as WeeklyHistory;
        // Migrate legacy history entries
        history.weeks = history.weeks.map(w => this.migrateWeeklyScore(w));
      }

      history.weeks.push(week);

      if (history.weeks.length > 12) {
        history.weeks = history.weeks.slice(-12);
      }

      fs.writeFileSync(this.historyPath, JSON.stringify(history, null, 2), 'utf-8');
      this.logger.info('Archived week to history', {
        weekStart: week.weekStart,
        scores: week.scores,
      });
    } catch (err) {
      this.logger.error('Failed to archive week', err);
    }
  }

  private getLastWeekFromHistory(): WeeklyScore | null {
    try {
      if (!fs.existsSync(this.historyPath)) return null;

      const raw = fs.readFileSync(this.historyPath, 'utf-8');
      const history = JSON.parse(raw) as WeeklyHistory;

      if (history.weeks.length === 0) return null;
      return this.migrateWeeklyScore(history.weeks[history.weeks.length - 1]);
    } catch {
      return null;
    }
  }

  private formatBreakdown(botId: string): string {
    const breakdown = this.getBreakdown(botId);
    const entries = Object.entries(breakdown);

    if (entries.length === 0) return '';

    entries.sort((a, b) => b[1] - a[1]);

    return entries.map(([emoji, count]) => `${emoji}\u00d7${count}`).join(', ');
  }

  private groupStampsByEmoji(stamps: StampEntry[], botId: string): string[] {
    const grouped: Record<string, number> = {};

    for (const stamp of stamps) {
      if (stamp.botId === botId) {
        grouped[stamp.emoji] = (grouped[stamp.emoji] || 0) + 1;
      }
    }

    return Object.entries(grouped)
      .sort((a, b) => b[1] - a[1])
      .map(([emoji, count]) => `${emoji}\u00d7${count}`);
  }
}
