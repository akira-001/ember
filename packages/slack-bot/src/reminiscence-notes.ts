import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

/**
 * Reminiscence notes — Nomi structured-note style (#2 retro 2026-04-25).
 *
 * Stores the (topic + Akira signal + time) tuple from messages that earned a
 * positive reaction or text_engaged. Other bots can scan pending notes during
 * their proactive turn and follow up "with how the topic landed" — replacing
 * the broken push-everything pattern with reminiscence.
 *
 * Observation-only in v1: notes are recorded automatically but follow-up is a
 * suggestion in the prompt, not a forced behavior.
 */

function notesFilePath(): string {
  return process.env.REMINISCENCE_NOTES_PATH
    || join(process.cwd(), 'data', 'reminiscence-notes.json');
}
const MAX_NOTES = 200;
const FOLLOW_UP_WINDOW_DAYS = 7;
const FOLLOW_UP_CUTOFF_DAYS = 30; // notes older than this stop being eligible
const MAX_FOLLOW_UP_ATTEMPTS = 3;

export type ReminiscenceSignal = 'reaction_positive' | 'text_positive' | 'text_engaged';
export type ReminiscenceStatus = 'pending' | 'done' | 'declined';

export interface ReminiscenceNote {
  noteId: string;
  createdAt: string;
  originalBotId: string;
  originalCategory?: string;
  topic: string;
  preview: string;
  url?: string;
  akiraSignal: ReminiscenceSignal;
  signalDetail?: string; // emoji or text snippet
  inner_thought?: string;
  followUpEligibleAt: string;
  followUpStatus: ReminiscenceStatus;
  followUpAttempts: number;
  lastAttemptAt?: string;
  followedUpByBotId?: string;
  followedUpAt?: string;
}

interface NotesFile {
  notes: ReminiscenceNote[];
}

function load(): NotesFile {
  try {
    if (existsSync(notesFilePath())) {
      return JSON.parse(readFileSync(notesFilePath(), 'utf-8'));
    }
  } catch {
    // Corrupted file — start fresh
  }
  return { notes: [] };
}

function save(data: NotesFile): void {
  const dir = dirname(notesFilePath());
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Atomic write via tmp + rename, same pattern as shared-proactive-history.ts
  // to avoid concurrent readers seeing truncated JSON.
  const tmp = `${notesFilePath()}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  try {
    renameSync(tmp, notesFilePath());
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

export interface RecordReminiscenceInput {
  botId: string;
  category?: string;
  topic: string;
  preview: string;
  url?: string;
  akiraSignal: ReminiscenceSignal;
  signalDetail?: string;
  inner_thought?: string;
  now?: Date;
}

/**
 * Record a topic that earned a positive Akira signal. The follow-up window
 * opens 7 days later (Nomi's "let it breathe before re-mentioning" pattern).
 * Idempotent on (originalBotId, topic) — re-recording a still-pending note
 * just refreshes the eligibility timestamp instead of duplicating.
 */
export function recordReminiscence(input: RecordReminiscenceInput): ReminiscenceNote {
  const data = load();
  const now = input.now ?? new Date();
  const eligibleAt = new Date(now.getTime() + FOLLOW_UP_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Dedup: same bot, same topic, still pending → refresh
  const existing = data.notes.find(
    n => n.originalBotId === input.botId
      && n.topic.trim() === input.topic.trim()
      && n.followUpStatus === 'pending'
  );
  if (existing) {
    existing.akiraSignal = input.akiraSignal;
    existing.signalDetail = input.signalDetail;
    existing.followUpEligibleAt = eligibleAt.toISOString();
    save(data);
    return existing;
  }

  const note: ReminiscenceNote = {
    noteId: randomUUID(),
    createdAt: now.toISOString(),
    originalBotId: input.botId,
    originalCategory: input.category,
    topic: input.topic,
    preview: input.preview.substring(0, 200),
    url: input.url,
    akiraSignal: input.akiraSignal,
    signalDetail: input.signalDetail,
    inner_thought: input.inner_thought,
    followUpEligibleAt: eligibleAt.toISOString(),
    followUpStatus: 'pending',
    followUpAttempts: 0,
  };
  data.notes.push(note);

  // Cap to MAX_NOTES (drop oldest done/declined first, then oldest pending)
  if (data.notes.length > MAX_NOTES) {
    const sorted = [...data.notes].sort((a, b) => {
      const aDone = a.followUpStatus !== 'pending' ? 0 : 1;
      const bDone = b.followUpStatus !== 'pending' ? 0 : 1;
      if (aDone !== bDone) return aDone - bDone;
      return a.createdAt.localeCompare(b.createdAt);
    });
    data.notes = sorted.slice(-MAX_NOTES);
  }

  save(data);
  return note;
}

/**
 * Find pending reminiscences eligible for a bot to follow up on.
 * Filters: status=pending, eligibleAt <= now <= createdAt + cutoff,
 * not from the requesting bot (cross-bot reminiscence is the design),
 * attempts < MAX_FOLLOW_UP_ATTEMPTS.
 */
export function getPendingReminiscences(opts: {
  excludeBotId: string;
  now?: Date;
  limit?: number;
}): ReminiscenceNote[] {
  const data = load();
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 5;
  const cutoffMs = FOLLOW_UP_CUTOFF_DAYS * 24 * 60 * 60 * 1000;

  return data.notes
    .filter(n => n.followUpStatus === 'pending')
    .filter(n => n.originalBotId !== opts.excludeBotId)
    .filter(n => new Date(n.followUpEligibleAt) <= now)
    .filter(n => now.getTime() - new Date(n.createdAt).getTime() <= cutoffMs)
    .filter(n => n.followUpAttempts < MAX_FOLLOW_UP_ATTEMPTS)
    .sort((a, b) => a.followUpEligibleAt.localeCompare(b.followUpEligibleAt))
    .slice(0, limit);
}

/**
 * Mark a note as followed up. Increments attempts and records who/when.
 * If status is 'done' the note will be ignored by future scans.
 */
export function markFollowedUp(noteId: string, byBotId: string, status: ReminiscenceStatus = 'done', now?: Date): void {
  const data = load();
  const note = data.notes.find(n => n.noteId === noteId);
  if (!note) return;
  const ts = (now ?? new Date()).toISOString();
  note.followUpAttempts += 1;
  note.lastAttemptAt = ts;
  note.followedUpByBotId = byBotId;
  note.followedUpAt = ts;
  note.followUpStatus = status;
  save(data);
}

/**
 * Build the prompt section showing pending reminiscences from other bots.
 * Returns empty string when no candidates exist.
 */
export function formatReminiscencePromptSection(opts: {
  botId: string;
  now?: Date;
  limit?: number;
}): string {
  const candidates = getPendingReminiscences({ excludeBotId: opts.botId, now: opts.now, limit: opts.limit });
  if (candidates.length === 0) return '';

  const lines = candidates.map(n => {
    const daysAgo = Math.floor((Date.now() - new Date(n.createdAt).getTime()) / (24 * 60 * 60 * 1000));
    const signalLabel = n.akiraSignal === 'reaction_positive' ? 'スタンプ' : n.akiraSignal === 'text_positive' ? 'ポジティブ返信' : '返信あり';
    return `- [${daysAgo}日前 / ${n.originalBotId}発信 / ${signalLabel}] ${n.topic} — ${n.preview.substring(0, 80)}`;
  });

  return `\n## 過去の反応話題（reminiscence v0 — その後どう？型のフォロー候補）\n` +
    `他のbotが過去 7〜30 日に Akiraさんの反応を取った話題。今回の発話で「あれその後どう？」「先週の話だけど〜」と自然に触れるのが効く可能性。**強制ではない**、文脈にハマる時だけ採用。\n` +
    `${lines.join('\n')}\n`;
}

// Test-only helpers for resetting state
export function _resetForTests(): void {
  const p = notesFilePath();
  if (existsSync(p)) unlinkSync(p);
}
export function _readForTests(): NotesFile {
  return load();
}
