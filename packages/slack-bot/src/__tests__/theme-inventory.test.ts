import { describe, it, expect } from 'vitest';
import { classifyProactiveTheme } from '../proactive-themes';
import {
  buildThemeInventorySnapshot,
  formatThemeInventorySection,
  getThemeInventoryBonus,
} from '../theme-inventory';

function buildDodgersObs(daysAgo: number, reactionDelta: number | null = null) {
  const theme = classifyProactiveTheme({
    text: '大谷の今季成績と記録が伸びている',
    topic: '大谷の今季成績と記録が伸びている',
    interestCategory: 'dodgers',
  });
  return {
    sentAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    topic: '大谷の今季成績と記録が伸びている',
    source: 'interest-cache',
    category: 'dodgers',
    themePath: theme.path,
    themeKey: theme.key,
    reactionDelta: reactionDelta ?? undefined,
  };
}

describe('theme inventory', () => {
  it('boosts underfilled themes more than overused ones', () => {
    const underTheme = classifyProactiveTheme({
      text: '京セラ向けの提案と見積をまとめる',
      topic: '京セラ向けの提案と見積をまとめる',
    });
    const underSnapshot = buildThemeInventorySnapshot({
      candidatePool: [{
        topic: '京セラ向けの提案と見積をまとめる',
        source: 'interest-cache',
        category: 'business_strategy',
        metadata: {},
      }],
      history: [],
    });

    const overTheme = classifyProactiveTheme({
      text: '大谷の今季成績と記録が伸びている',
      topic: '大谷の今季成績と記録が伸びている',
      interestCategory: 'dodgers',
    });
    const overSnapshot = buildThemeInventorySnapshot({
      candidatePool: [{
        topic: '大谷の今季成績と記録が伸びている',
        source: 'interest-cache',
        category: 'dodgers',
        metadata: {},
      }],
      history: [
        buildDodgersObs(1, 1),
        buildDodgersObs(2, 1),
        buildDodgersObs(3, 1),
        buildDodgersObs(4, -1),
        buildDodgersObs(5, 1),
      ],
    });

    expect(getThemeInventoryBonus(underTheme.path, underSnapshot)).toBeGreaterThan(
      getThemeInventoryBonus(overTheme.path, overSnapshot),
    );
  });

  it('renders a concise inventory summary', () => {
    const theme = classifyProactiveTheme({
      text: 'ラーメンを食べたい',
      topic: 'ラーメンを食べたい',
    });
    const snapshot = buildThemeInventorySnapshot({
      candidatePool: [{
        topic: 'ラーメンを食べたい',
        source: 'interest-cache',
        category: 'hobby_leisure',
        metadata: {},
      }],
      history: [],
    });

    expect(snapshot.records.some((record) => record.themeKey === theme.key)).toBe(true);
    expect(formatThemeInventorySection(snapshot)).toContain('テーマ在庫メモ');
  });
});
