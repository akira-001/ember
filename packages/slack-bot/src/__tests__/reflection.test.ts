import { describe, it, expect } from 'vitest';
import { shouldReflect, buildReflectionPrompt, parseReflectionResponse, applyReflection, type ReflectionContext, type ReflectionOutput } from '../reflection';
import type { HeartbeatEntry } from '../heartbeat-context';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function makeContext(overrides: Partial<ReflectionContext> = {}): ReflectionContext {
  return {
    heartbeatEntries: [],
    lastReflectionAt: null,
    currentTime: new Date('2026-04-08T15:00:00+09:00'),
    ...overrides,
  };
}

describe('shouldReflect', () => {
  it('returns false when no entries and recent reflection', () => {
    const ctx = makeContext({
      lastReflectionAt: new Date('2026-04-08T14:00:00+09:00'),
    });
    expect(shouldReflect(ctx)).toBe(false);
  });

  it('returns true when 24+ hours since last reflection', () => {
    const ctx = makeContext({
      lastReflectionAt: new Date('2026-04-07T10:00:00+09:00'),
      heartbeatEntries: [
        { type: 'send' as const, timestamp: '2026-04-08T12:00:00+09:00', timeDisplay: '12:00' },
        { type: 'send' as const, timestamp: '2026-04-08T13:00:00+09:00', timeDisplay: '13:00' },
      ],
    });
    expect(shouldReflect(ctx)).toBe(true);
  });

  it('returns true when strong positive reaction received', () => {
    const ctx = makeContext({
      lastReflectionAt: new Date('2026-04-08T08:00:00+09:00'),
      heartbeatEntries: [
        { type: 'reaction' as const, timestamp: '2026-04-08T14:30:00+09:00', timeDisplay: '14:30', emoji: '❤️' },
      ],
    });
    expect(shouldReflect(ctx)).toBe(true);
  });

  it('returns true when negative reaction received', () => {
    const ctx = makeContext({
      lastReflectionAt: new Date('2026-04-08T08:00:00+09:00'),
      heartbeatEntries: [
        { type: 'reaction' as const, timestamp: '2026-04-08T14:30:00+09:00', timeDisplay: '14:30', emoji: '😤' },
      ],
    });
    expect(shouldReflect(ctx)).toBe(true);
  });

  it('returns true when first time and has entries', () => {
    const ctx = makeContext({
      lastReflectionAt: null,
      heartbeatEntries: [
        { type: 'send' as const, timestamp: '2026-04-08T12:00:00+09:00', timeDisplay: '12:00' },
      ],
    });
    expect(shouldReflect(ctx)).toBe(true);
  });

  it('returns false when first time but no entries', () => {
    const ctx = makeContext({ lastReflectionAt: null, heartbeatEntries: [] });
    expect(shouldReflect(ctx)).toBe(false);
  });

  it('returns false when within cooldown even with strong reaction', () => {
    const ctx = makeContext({
      lastReflectionAt: new Date('2026-04-08T14:00:00+09:00'), // 1 hour ago (within 6h cooldown)
      heartbeatEntries: [
        { type: 'reaction' as const, timestamp: '2026-04-08T14:30:00+09:00', timeDisplay: '14:30', emoji: '❤️' },
      ],
    });
    expect(shouldReflect(ctx)).toBe(false);
  });
});

describe('buildReflectionPrompt', () => {
  it('includes heartbeat entries in prompt', () => {
    const entries: HeartbeatEntry[] = [
      { type: 'send', timestamp: '2026-04-08T12:00:00+09:00', timeDisplay: '12:00', message: 'ドジャース勝ったよ！', category: 'hobby_leisure' },
      { type: 'reaction', timestamp: '2026-04-08T12:05:00+09:00', timeDisplay: '12:05', emoji: '❤️' },
    ];
    const prompt = buildReflectionPrompt(entries, '## Recent Observations\n\n（まだ記録なし）', 'mei');
    expect(prompt).toContain('ドジャース');
    expect(prompt).toContain('❤️');
    expect(prompt).toContain('Recent Observations');
  });

  it('returns empty string when no entries', () => {
    expect(buildReflectionPrompt([], '', 'mei')).toBe('');
  });

  it('includes failure patterns when provided', () => {
    const entries: HeartbeatEntry[] = [
      { type: 'send', timestamp: '2026-04-08T12:00:00+09:00', timeDisplay: '12:00' },
    ];
    const prompt = buildReflectionPrompt(entries, '', 'mei', ['hobby カテゴリで3回失敗']);
    expect(prompt).toContain('失敗パターン');
    expect(prompt).toContain('hobby カテゴリで3回失敗');
  });
});

describe('parseReflectionResponse', () => {
  it('parses valid JSON response', () => {
    const response = '{"observations": ["趣味の話題は昼が良い"], "successPatterns": ["ドジャースネタは鉄板"], "avoidPatterns": []}';
    const result = parseReflectionResponse(response);
    expect(result.observations).toEqual(['趣味の話題は昼が良い']);
    expect(result.successPatterns).toEqual(['ドジャースネタは鉄板']);
    expect(result.avoidPatterns).toEqual([]);
  });

  it('extracts JSON from surrounding text', () => {
    const response = 'Here is my analysis:\n{"observations": ["test"], "successPatterns": [], "avoidPatterns": []}\nDone.';
    const result = parseReflectionResponse(response);
    expect(result.observations).toEqual(['test']);
  });

  it('returns empty arrays on invalid JSON', () => {
    const result = parseReflectionResponse('not json');
    expect(result.observations).toEqual([]);
    expect(result.successPatterns).toEqual([]);
    expect(result.avoidPatterns).toEqual([]);
  });
});

describe('applyReflection', () => {
  it('appends observations to MEMORY.md', () => {
    const dir = join(tmpdir(), `reflection-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const memoryPath = join(dir, 'MEMORY.md');
    writeFileSync(memoryPath, `# Mei - MEMORY

## Recent Observations

（まだ記録なし）

## Success Patterns

（まだ記録なし）

## Patterns to Avoid

（まだ記録なし）
`);

    const output: ReflectionOutput = {
      observations: ['趣味の話題は昼に送ると反応が良い'],
      successPatterns: ['ドジャースの試合結果は即座に共有すると喜ばれる'],
      avoidPatterns: [],
    };

    applyReflection(output, memoryPath);
    const result = readFileSync(memoryPath, 'utf-8');
    expect(result).toContain('趣味の話題は昼に送ると反応が良い');
    expect(result).toContain('ドジャースの試合結果');
  });

  it('does not modify file when all arrays are empty', () => {
    const dir = join(tmpdir(), `reflection-test-empty-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const memoryPath = join(dir, 'MEMORY.md');
    const original = '# MEMORY\n\n## Recent Observations\n\n（まだ記録なし）\n';
    writeFileSync(memoryPath, original);

    applyReflection({ observations: [], successPatterns: [], avoidPatterns: [] }, memoryPath);
    expect(readFileSync(memoryPath, 'utf-8')).toBe(original);
  });
});
