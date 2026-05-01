import { describe, it, expect, beforeEach } from 'vitest';
import { BotRegistry } from '../bot-registry';
import type { BotConfig } from '../bot-config';

function makeBotConfig(id: string, displayName: string): BotConfig {
  return {
    id,
    name: displayName,
    displayName,
    slack: { botToken: '', appToken: '', signingSecret: '' },
    personality: { systemPrompt: '', chatModel: '', cronModel: '' },
    statePath: `data/${id}-state.json`,
    insightsPath: 'data/user-insights.json',
    configJson: { id, name: displayName } as any,
  };
}

describe('BotRegistry', () => {
  let registry: BotRegistry;

  beforeEach(() => {
    registry = new BotRegistry([
      makeBotConfig('mei', 'メイ'),
      makeBotConfig('eve', 'イヴ'),
      makeBotConfig('rio', 'リオ'),
    ]);
  });

  it('returns all bot IDs', () => {
    expect(registry.getBotIds()).toEqual(['mei', 'eve', 'rio']);
  });

  it('returns display name by ID', () => {
    expect(registry.getDisplayName('mei')).toBe('メイ');
    expect(registry.getDisplayName('eve')).toBe('イヴ');
    expect(registry.getDisplayName('rio')).toBe('リオ');
  });

  it('returns ID as fallback for unknown bot', () => {
    expect(registry.getDisplayName('unknown')).toBe('unknown');
  });

  it('returns other bot IDs', () => {
    expect(registry.getOtherBotIds('mei')).toEqual(['eve', 'rio']);
  });

  it('returns config by ID', () => {
    const config = registry.getConfig('rio');
    expect(config?.displayName).toBe('リオ');
  });

  it('returns undefined for unknown config', () => {
    expect(registry.getConfig('unknown')).toBeUndefined();
  });

  it('returns all state paths', () => {
    expect(registry.getStatePaths()).toEqual([
      'data/mei-state.json',
      'data/eve-state.json',
      'data/rio-state.json',
    ]);
  });

  it('checks if bot exists', () => {
    expect(registry.has('mei')).toBe(true);
    expect(registry.has('unknown')).toBe(false);
  });

  it('generates bot name pattern', () => {
    const pattern = registry.getBotNamePattern();
    expect('メイとイヴ').toMatch(pattern);
    expect('mei and eve').toMatch(pattern);
    expect('リオ').toMatch(pattern);
  });
});
