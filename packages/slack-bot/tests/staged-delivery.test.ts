// tests/staged-delivery.test.ts
import { describe, it, expect } from 'vitest';
import { buildStagedMessages } from '../src/staged-delivery';
import { DEFAULT_INTENTIONAL_PAUSE_CONFIG } from '../src/event-sources/types';

describe('buildStagedMessages', () => {
  const config = { ...DEFAULT_INTENTIONAL_PAUSE_CONFIG, enabled: true };

  it('returns premise + delay + main for medium weight', () => {
    const result = buildStagedMessages('Hello world', 'medium', config);
    expect(result.premise).toBe('ちょっと思ったんだけど...');
    expect(result.waitMs).toBe(3000);
    expect(result.main).toBe('Hello world');
  });

  it('returns no premise for light weight (null premise text)', () => {
    const result = buildStagedMessages('Hi!', 'light', config);
    expect(result.premise).toBeNull();
    expect(result.waitMs).toBe(0);
    expect(result.main).toBe('Hi!');
  });

  it('returns heavy premise and 5s delay', () => {
    const result = buildStagedMessages('Important topic', 'heavy', config);
    expect(result.premise).toBe('ねえ、少し大事な話なんだけど...');
    expect(result.waitMs).toBe(5000);
    expect(result.main).toBe('Important topic');
  });

  it('skips staging when disabled', () => {
    const disabled = { ...config, enabled: false };
    const result = buildStagedMessages('Hello', 'heavy', disabled);
    expect(result.premise).toBeNull();
    expect(result.waitMs).toBe(0);
    expect(result.main).toBe('Hello');
  });
});
