import { describe, it, expect } from 'vitest';
import { getProfileMultiplier, PROFILES, getProfilePromptSection } from '../conversation-profile';

describe('conversation-profile', () => {
  it('balanced returns 1.0 for all', () => {
    expect(getProfileMultiplier('balanced', 'dodgers')).toBe(1.0);
    expect(getProfileMultiplier('balanced', 'ai_agent')).toBe(1.0);
  });

  it('business boosts business categories', () => {
    expect(getProfileMultiplier('business', 'ai_agent')).toBe(1.5);
    expect(getProfileMultiplier('business', 'business_strategy')).toBe(1.5);
  });

  it('business reduces lifestyle categories', () => {
    expect(getProfileMultiplier('business', 'dodgers')).toBe(0.5);
    expect(getProfileMultiplier('business', 'golf')).toBe(0.5);
  });

  it('lifestyle boosts lifestyle categories', () => {
    expect(getProfileMultiplier('lifestyle', 'dodgers')).toBe(1.5);
    expect(getProfileMultiplier('lifestyle', 'onsen')).toBe(1.5);
  });

  it('growth boosts exploration', () => {
    expect(getProfileMultiplier('growth', '_wildcard')).toBe(1.8);
    expect(getProfileMultiplier('growth', '_cross')).toBe(1.8);
  });

  it('wellbeing boosts health', () => {
    expect(getProfileMultiplier('wellbeing', 'cat_health')).toBe(1.8);
  });

  it('unknown category returns 1.0', () => {
    expect(getProfileMultiplier('business', 'unknown')).toBe(1.0);
  });

  it('5 profiles defined', () => {
    expect(Object.keys(PROFILES)).toHaveLength(5);
  });

  it('balanced prompt section is empty', () => {
    expect(getProfilePromptSection('balanced')).toBe('');
  });

  it('business prompt section has content', () => {
    expect(getProfilePromptSection('business')).toContain('自己実現型');
  });
});
