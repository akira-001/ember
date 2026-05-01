import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { loadAkiraMessagesLast24h, formatAkiraMessagesLast24hPrompt } from '../conversation-logger';

const LOG_DIR = join(process.cwd(), 'data', 'conversations');

function writeLog(date: string, lines: any[]): void {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  const path = join(LOG_DIR, `${date}.jsonl`);
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'));
}

function clearLogs(dates: string[]): void {
  for (const d of dates) {
    const p = join(LOG_DIR, `${d}.jsonl`);
    if (existsSync(p)) rmSync(p);
  }
}

describe('loadAkiraMessagesLast24h', () => {
  const fakeNow = new Date('2026-04-25T18:00:00.000Z'); // 03:00 JST 4/26

  // JST: 4/25 = entries before fakeNow JST midnight; 4/26 = today's date in JST.
  // We compute these via the same helper logic the code uses.
  const today = '2026-04-26';
  const yesterday = '2026-04-25';

  beforeEach(() => {
    clearLogs([today, yesterday]);
  });

  afterEach(() => {
    clearLogs([today, yesterday]);
  });

  test('returns user messages within the last 24h, sorted oldest-first', () => {
    writeLog(yesterday, [
      // 25h ago — outside window
      { timestamp: '2026-04-24T16:00:00.000Z', role: 'user', user: 'U3SFGQXNH', channel: 'D1', text: 'too old' },
      // 23h ago — inside
      { timestamp: '2026-04-24T19:00:00.000Z', role: 'user', user: 'U3SFGQXNH', channel: 'D1', text: 'within window' },
      // bot message ignored
      { timestamp: '2026-04-24T19:01:00.000Z', role: 'mei', channel: 'D1', text: 'bot reply' },
    ]);
    writeLog(today, [
      { timestamp: '2026-04-25T17:30:00.000Z', role: 'user', user: 'U3SFGQXNH', channel: 'D2', text: 'recent' },
    ]);

    const result = loadAkiraMessagesLast24h({ now: fakeNow });
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('within window');
    expect(result[1].text).toBe('recent');
  });

  test('returns empty array when no logs exist', () => {
    expect(loadAkiraMessagesLast24h({ now: fakeNow })).toEqual([]);
  });

  test('caps result to maxEntries (newest kept)', () => {
    const lines = [];
    for (let i = 0; i < 60; i++) {
      lines.push({
        timestamp: `2026-04-25T${String(i % 24).padStart(2, '0')}:00:00.000Z`,
        role: 'user',
        user: 'U3SFGQXNH',
        channel: 'D1',
        text: `msg-${i}`,
      });
    }
    writeLog(today, lines);
    const result = loadAkiraMessagesLast24h({ now: fakeNow, maxEntries: 5 });
    expect(result).toHaveLength(5);
  });

  test('formatAkiraMessagesLast24hPrompt returns empty string when no messages', () => {
    expect(formatAkiraMessagesLast24hPrompt({ now: fakeNow })).toBe('');
  });

  test('formatAkiraMessagesLast24hPrompt produces section header when messages exist', () => {
    writeLog(today, [
      { timestamp: '2026-04-25T17:30:00.000Z', role: 'user', user: 'U3SFGQXNH', channel: 'D2', text: 'hello' },
    ]);
    const prompt = formatAkiraMessagesLast24hPrompt({ now: fakeNow });
    expect(prompt).toContain('Akiraさんの直近24時間の発言');
    expect(prompt).toContain('hello');
  });
});
