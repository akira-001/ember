import { describe, test, expect, beforeEach } from 'vitest';
import { HeartbeatContext, type HeartbeatEntry } from '../heartbeat-context';

describe('HeartbeatContext', () => {
  let ctx: HeartbeatContext;

  beforeEach(() => {
    ctx = new HeartbeatContext({ maxEntries: 5 });
  });

  test('starts empty', () => {
    expect(ctx.getEntries()).toEqual([]);
    expect(ctx.toPromptSection()).toBe('');
  });

  test('records a send entry', () => {
    ctx.recordSend({
      message: 'おはよう、Akiraさん。ドジャース勝ったよ！',
      category: 'hobby_leisure',
      decision: 'send',
      modeEstimate: '探索モード',
    });
    const entries = ctx.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('send');
    expect(entries[0].message).toContain('ドジャース');
  });

  test('records a skip entry', () => {
    ctx.recordSkip({
      reason: '没頭モード — 会議が続いている',
      modeEstimate: '没頭モード',
    });
    const entries = ctx.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('skip');
  });

  test('records a reaction', () => {
    ctx.recordSend({
      message: 'テスト',
      category: 'energy_break',
      decision: 'send',
      modeEstimate: '探索モード',
    });
    ctx.recordReaction({
      emoji: 'heart',
      slackTs: '123.456',
    });
    const entries = ctx.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[1].type).toBe('reaction');
  });

  test('evicts oldest when maxEntries exceeded', () => {
    for (let i = 0; i < 7; i++) {
      ctx.recordSend({
        message: `msg-${i}`,
        category: 'energy_break',
        decision: 'send',
        modeEstimate: '探索モード',
      });
    }
    expect(ctx.getEntries()).toHaveLength(5);
    expect(ctx.getEntries()[0].message).toBe('msg-2');
  });

  test('toPromptSection formats entries as markdown', () => {
    ctx.recordSend({
      message: 'おはよう',
      category: 'energy_break',
      decision: 'send',
      modeEstimate: '探索モード',
    });
    ctx.recordReaction({ emoji: 'heart', slackTs: '1' });
    const section = ctx.toPromptSection();
    expect(section).toContain('## 直近の記憶');
    expect(section).toContain('おはよう');
    expect(section).toContain('heart');
  });

  test('serialize and deserialize roundtrip', () => {
    ctx.recordSend({
      message: 'test',
      category: 'hobby_leisure',
      decision: 'send',
      modeEstimate: '探索モード',
    });
    const json = ctx.serialize();
    const restored = HeartbeatContext.deserialize(json, { maxEntries: 5 });
    expect(restored.getEntries()).toEqual(ctx.getEntries());
  });

  test('records inner_thought / plan / generate_score / evaluate_score on send', () => {
    ctx.recordSend({
      message: 'ドジャース勝ったよ',
      category: 'hobby_leisure',
      decision: 'send',
      modeEstimate: '探索モード',
      inner_thought: 'Akiraさんに伝えたい',
      plan: ['共有', '質問', '沈黙'],
      generate_score: [0.85, 0.5, 0.2],
      evaluate_score: 0.78,
    });
    const e = ctx.getEntries()[0];
    expect(e.inner_thought).toBe('Akiraさんに伝えたい');
    expect(e.plan).toEqual(['共有', '質問', '沈黙']);
    expect(e.generate_score).toEqual([0.85, 0.5, 0.2]);
    expect(e.evaluate_score).toBe(0.78);
  });

  test('records inner_thought / scores on skip too', () => {
    ctx.recordSkip({
      reason: '会議連続',
      modeEstimate: '没頭モード',
      inner_thought: '邪魔したくない',
      plan: ['MCP記事', '沈黙'],
      generate_score: [0.3, 0.78],
      evaluate_score: 0.22,
    });
    const e = ctx.getEntries()[0];
    expect(e.type).toBe('skip');
    expect(e.inner_thought).toBe('邪魔したくない');
    expect(e.evaluate_score).toBe(0.22);
  });

  test('toPromptSection includes inner_thought and evaluate_score when present', () => {
    ctx.recordSend({
      message: 'おはよう',
      category: 'energy_break',
      decision: 'send',
      modeEstimate: '探索モード',
      inner_thought: '挨拶したい',
      evaluate_score: 0.65,
    });
    const section = ctx.toPromptSection();
    expect(section).toContain('内なる声: 挨拶したい');
    expect(section).toContain('score=0.65');
  });

  test('toPromptSection omits inner hint when fields absent (backward compat)', () => {
    ctx.recordSend({
      message: 'おはよう',
      category: 'energy_break',
      decision: 'send',
      modeEstimate: '探索モード',
    });
    const section = ctx.toPromptSection();
    expect(section).not.toContain('内なる声');
    expect(section).not.toContain('score=');
  });
});
