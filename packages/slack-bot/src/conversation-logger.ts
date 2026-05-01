import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { exec } from 'child_process';
import { join } from 'path';
import { getDateInTz, getTimeInTz } from './timezone';

const LOG_DIR = join(process.cwd(), 'data', 'conversations');
const COGMEM_PROJECT = process.env.COGMEM_PROJECT || '/Users/akira/workspace/ember';
const COGMEM_LOG_DIR = join(COGMEM_PROJECT, 'memory', 'logs');
const CROSS_HISTORY_DIR = join(process.cwd(), 'data');
const CROSS_HISTORY_MAX = 20;

export interface ConversationLogEntry {
  timestamp: string;
  role: 'user' | 'bot' | string;
  user?: string;
  channel: string;
  text: string;
  files?: string[];
}

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogPath(): string {
  const dateStr = getDateInTz(); // YYYY-MM-DD
  return join(LOG_DIR, `${dateStr}.jsonl`);
}

export function logConversation(entry: ConversationLogEntry): void {
  try {
    ensureLogDir();
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(getLogPath(), line, 'utf-8');
  } catch {
    // Don't let logging errors break the bot
  }
}

export function logUserMessage(user: string, channel: string, text: string, files?: string[]): void {
  logConversation({
    timestamp: new Date().toISOString(),
    role: 'user',
    user,
    channel,
    text,
    files: files?.length ? files : undefined,
  });
}

export function logBotMessage(botId: string, channel: string, text: string): void {
  logConversation({
    timestamp: new Date().toISOString(),
    role: botId,
    channel,
    text,
  });
}

export function logMeiMessage(channel: string, text: string): void {
  logBotMessage('mei', channel, text);
}

/**
 * Write a conversation exchange in cogmem-compatible markdown format.
 * Each exchange (user message + bot response) becomes a single entry.
 */
export function logCogmemEntry(
  botId: string,
  userText: string,
  botText: string,
  channel: string,
): void {
  try {
    if (!existsSync(COGMEM_LOG_DIR)) {
      mkdirSync(COGMEM_LOG_DIR, { recursive: true });
    }
    const now = new Date();
    const dateStr = getDateInTz(now);
    const timeStr = getTimeInTz(now);
    const logPath = join(COGMEM_LOG_DIR, `${dateStr}.md`);

    // Determine category based on content
    const category = detectCategory(userText, botText);

    // Truncate long messages to keep log entries manageable
    const maxLen = 500;
    const userSnippet = userText.length > maxLen ? userText.substring(0, maxLen) + '...' : userText;
    const botSnippet = botText.length > maxLen ? botText.substring(0, maxLen) + '...' : botText;

    const arousal = detectArousal(userText, botText);
    const entry = `\n### [${category}] ${timeStr} ${botId} — ${userSnippet.split('\n')[0].substring(0, 60)}
*Arousal: ${arousal.toFixed(1)} | Emotion: Conversation*
Akira: ${userSnippet}
${botId}: ${botSnippet}

---
`;

    appendFileSync(logPath, entry, 'utf-8');

    // Async index update for cogmem search against open-claude DB
    exec(`cogmem index --file "${logPath}"`, { timeout: 15000, cwd: COGMEM_PROJECT }, (err) => {
      if (err) {
        // Silent fail — cron will catch up
      }
    });
  } catch {
    // Don't let logging errors break the bot
  }
}

// ---------------------------------------------------------------------------
// Cross-channel user history (JSON file per user)
// ---------------------------------------------------------------------------

export interface CrossHistoryEntry {
  ts: string;       // ISO timestamp
  ch: string;       // channel ID
  botId: string;
  user: string;     // user message (truncated)
  bot: string;      // bot response (truncated)
}

function getCrossHistoryPath(userId: string): string {
  return join(CROSS_HISTORY_DIR, `user-history-${userId}.json`);
}

/**
 * Append a conversation exchange to the user's cross-channel history.
 * Keeps the most recent CROSS_HISTORY_MAX entries.
 */
export function appendCrossHistory(
  userId: string,
  channel: string,
  botId: string,
  userText: string,
  botText: string,
): void {
  try {
    const filePath = getCrossHistoryPath(userId);
    let history: CrossHistoryEntry[] = [];

    if (existsSync(filePath)) {
      try {
        history = JSON.parse(readFileSync(filePath, 'utf-8'));
      } catch {
        history = [];
      }
    }

    history.push({
      ts: new Date().toISOString(),
      ch: channel,
      botId,
      user: userText.substring(0, 80),
      bot: botText.substring(0, 100),
    });

    // Keep only the most recent entries
    if (history.length > CROSS_HISTORY_MAX) {
      history = history.slice(-CROSS_HISTORY_MAX);
    }

    writeFileSync(filePath, JSON.stringify(history, null, 2));
  } catch {
    // Don't let logging errors break the bot
  }
}

/**
 * Load and format the user's cross-channel history as a prompt section.
 * Returns empty string if no history exists.
 */
export function loadCrossHistoryPrompt(userId: string): string {
  try {
    const filePath = getCrossHistoryPath(userId);
    if (!existsSync(filePath)) return '';

    const history: CrossHistoryEntry[] = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (history.length === 0) return '';

    const lines = history.map(e => {
      const time = e.ts.substring(0, 16);
      return `[${time}] #${e.ch} (${e.botId})\nAkira: ${e.user}\n${e.botId}: ${e.bot}`;
    });

    return `## 最近のAkiraとの会話（全チャンネル横断・直近${history.length}件）\n${lines.join('\n\n')}`;
  } catch {
    return '';
  }
}

/**
 * Load Akira's messages (role === 'user') from the last 24 hours across all bots/channels.
 * Reads today's and yesterday's jsonl files, filters by ISO timestamp >= now-24h.
 * Used by proactive-agent to give bots a shared 24h view of what Akira said —
 * the first step toward Mei/Eve/Haru sharing state (#1 retro 2026-04-25, Q5).
 */
export function loadAkiraMessagesLast24h(opts: { now?: Date; maxEntries?: number } = {}): Array<{
  timestamp: string;
  channel: string;
  text: string;
}> {
  const now = opts.now ?? new Date();
  const maxEntries = opts.maxEntries ?? 50;
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Read today's and yesterday's logs (24h may span midnight in JST)
  const today = getDateInTz(now);
  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterday = getDateInTz(yesterdayDate);
  const candidates = today === yesterday ? [today] : [yesterday, today];

  const messages: Array<{ timestamp: string; channel: string; text: string }> = [];
  for (const date of candidates) {
    const path = join(LOG_DIR, `${date}.jsonl`);
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as ConversationLogEntry;
          if (entry.role !== 'user') continue;
          if (!entry.timestamp || new Date(entry.timestamp) < cutoff) continue;
          messages.push({
            timestamp: entry.timestamp,
            channel: entry.channel,
            text: entry.text,
          });
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Skip unreadable file
    }
  }

  // Most recent last; cap to maxEntries from the end
  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return messages.slice(-maxEntries);
}

/**
 * Format the last-24h Akira messages as a prompt section.
 * Returns empty string if no messages found.
 */
export function formatAkiraMessagesLast24hPrompt(opts: { now?: Date; maxEntries?: number } = {}): string {
  const messages = loadAkiraMessagesLast24h(opts);
  if (messages.length === 0) return '';

  const lines = messages.map(m => {
    const time = m.timestamp.substring(11, 16); // HH:MM (UTC, sufficient for relative ordering)
    const text = m.text.length > 160 ? m.text.substring(0, 160) + '…' : m.text;
    return `- [${time} #${m.channel}] ${text}`;
  });
  return `## Akiraさんの直近24時間の発言（全bot共有 / 既知化情報重複防止用）\n${lines.join('\n')}\n`;
}

function detectArousal(userText: string, botText: string): number {
  const combined = (userText + ' ' + botText).toLowerCase();
  let arousal = 0.5; // baseline for conversations
  if (/なるほど|そうか|発見|わかった|すごい/.test(combined)) arousal = Math.max(arousal, 0.7);
  if (/待って|違う|でもそれ|間違/.test(combined)) arousal = Math.max(arousal, 0.7);
  if (/ありがとう|助かった|完璧/.test(combined)) arousal = Math.max(arousal, 0.6);
  if (/問題|エラー|失敗|バグ/.test(combined)) arousal = Math.max(arousal, 0.6);
  return arousal;
}

function detectCategory(userText: string, botText: string): string {
  const combined = (userText + ' ' + botText).toLowerCase();
  if (/スケジュール|予定|カレンダー|会議|meeting/.test(combined)) return 'SCHEDULE';
  if (/コード|実装|バグ|エラー|デプロイ|開発/.test(combined)) return 'DEV';
  if (/旅行|温泉|キャンプ|遊び|ドジャース|野球/.test(combined)) return 'FUN';
  if (/タスク|todo|やること|確認|レビュー/.test(combined)) return 'TASK';
  if (/提案|アイデア|戦略|分析/.test(combined)) return 'IDEA';
  return 'CHAT';
}
