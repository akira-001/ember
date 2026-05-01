import { describe, test, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';
import {
  recordReminiscence,
  getPendingReminiscences,
  markFollowedUp,
  formatReminiscencePromptSection,
  _resetForTests,
  _readForTests,
} from '../reminiscence-notes';

const TEST_NOTES_PATH = join(process.cwd(), 'data', 'reminiscence-notes.test.json');

beforeAll(() => {
  process.env.REMINISCENCE_NOTES_PATH = TEST_NOTES_PATH;
});

afterAll(() => {
  delete process.env.REMINISCENCE_NOTES_PATH;
  if (existsSync(TEST_NOTES_PATH)) rmSync(TEST_NOTES_PATH);
});

const NOW = new Date('2026-04-26T10:00:00.000Z');
const ONE_DAY = 24 * 60 * 60 * 1000;

describe('reminiscence-notes', () => {
  beforeEach(() => {
    _resetForTests();
  });

  test('recordReminiscence stores a note with 7-day follow-up window', () => {
    const note = recordReminiscence({
      botId: 'eve',
      topic: '温泉+車中泊',
      preview: '温泉と車中泊の組み合わせ',
      akiraSignal: 'reaction_positive',
      signalDetail: '+1',
      now: NOW,
    });
    expect(note.topic).toBe('温泉+車中泊');
    expect(note.followUpStatus).toBe('pending');
    expect(note.followUpAttempts).toBe(0);
    const eligible = new Date(note.followUpEligibleAt);
    const expectedEligible = new Date(NOW.getTime() + 7 * ONE_DAY);
    expect(eligible.getTime()).toBe(expectedEligible.getTime());
  });

  test('recordReminiscence dedups same bot + same topic when still pending', () => {
    recordReminiscence({ botId: 'eve', topic: '温泉+車中泊', preview: 'a', akiraSignal: 'reaction_positive', now: NOW });
    recordReminiscence({ botId: 'eve', topic: '温泉+車中泊', preview: 'b', akiraSignal: 'text_engaged', now: new Date(NOW.getTime() + ONE_DAY) });
    const data = _readForTests();
    expect(data.notes).toHaveLength(1);
    expect(data.notes[0].akiraSignal).toBe('text_engaged'); // refreshed
  });

  test('getPendingReminiscences excludes notes from the requesting bot', () => {
    recordReminiscence({ botId: 'eve', topic: 'A', preview: '', akiraSignal: 'reaction_positive', now: new Date(NOW.getTime() - 8 * ONE_DAY) });
    recordReminiscence({ botId: 'mei', topic: 'B', preview: '', akiraSignal: 'reaction_positive', now: new Date(NOW.getTime() - 8 * ONE_DAY) });

    const forMei = getPendingReminiscences({ excludeBotId: 'mei', now: NOW });
    expect(forMei.map(n => n.topic)).toEqual(['A']);

    const forEve = getPendingReminiscences({ excludeBotId: 'eve', now: NOW });
    expect(forEve.map(n => n.topic)).toEqual(['B']);
  });

  test('getPendingReminiscences returns nothing before the 7-day window opens', () => {
    recordReminiscence({ botId: 'eve', topic: 'A', preview: '', akiraSignal: 'reaction_positive', now: NOW });
    // 6 days later — before 7-day window opens
    const result = getPendingReminiscences({ excludeBotId: 'mei', now: new Date(NOW.getTime() + 6 * ONE_DAY) });
    expect(result).toHaveLength(0);
  });

  test('getPendingReminiscences enforces the 30-day cutoff', () => {
    // 31 days ago → past the 30-day cutoff
    recordReminiscence({ botId: 'eve', topic: 'A', preview: '', akiraSignal: 'reaction_positive', now: new Date(NOW.getTime() - 31 * ONE_DAY) });
    const result = getPendingReminiscences({ excludeBotId: 'mei', now: NOW });
    expect(result).toHaveLength(0);
  });

  test('markFollowedUp transitions status and increments attempts', () => {
    const note = recordReminiscence({ botId: 'eve', topic: 'A', preview: '', akiraSignal: 'reaction_positive', now: new Date(NOW.getTime() - 8 * ONE_DAY) });
    markFollowedUp(note.noteId, 'mei', 'done', NOW);
    const data = _readForTests();
    expect(data.notes[0].followUpStatus).toBe('done');
    expect(data.notes[0].followUpAttempts).toBe(1);
    expect(data.notes[0].followedUpByBotId).toBe('mei');

    // Done notes are excluded from future scans
    const result = getPendingReminiscences({ excludeBotId: 'mei', now: NOW });
    expect(result).toHaveLength(0);
  });

  test('formatReminiscencePromptSection returns empty string when no candidates', () => {
    expect(formatReminiscencePromptSection({ botId: 'mei', now: NOW })).toBe('');
  });

  test('formatReminiscencePromptSection includes section header and topic when candidates exist', () => {
    recordReminiscence({ botId: 'eve', topic: '温泉+車中泊', preview: '〜の話題', akiraSignal: 'reaction_positive', now: new Date(NOW.getTime() - 8 * ONE_DAY) });
    const section = formatReminiscencePromptSection({ botId: 'mei', now: NOW });
    expect(section).toContain('reminiscence v0');
    expect(section).toContain('温泉+車中泊');
    expect(section).toContain('eve発信');
    expect(section).toContain('スタンプ');
  });
});
