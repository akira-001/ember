import { describe, it, expect } from 'vitest';
import { DenialDetector, type DenialResult } from '../../src/implicit-memory/denial-detector';

describe('DenialDetector', () => {
  const detector = new DenialDetector();

  it('detects 「違うよ」', () => {
    const result = detector.detect('違うよ、それは箱根じゃなくて草津だよ');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('denial');
  });

  it('detects 「そうじゃなくて」', () => {
    const result = detector.detect('そうじゃなくて、もっと複雑な話');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('denial');
  });

  it('detects 「前も言ったけど」', () => {
    const result = detector.detect('前も言ったけど、猫は2匹いるんだよ');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('repeated_correction');
  });

  it('detects 「何度も言ってるけど」', () => {
    const result = detector.detect('何度も言ってるけど、私は朝型じゃない');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('repeated_correction');
  });

  it('detects correction pattern 「○○じゃなくて○○」', () => {
    const result = detector.detect('それは犬じゃなくて猫だよ');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('denial');
    expect(result!.correctedContent).toBeTruthy();
  });

  it('detects 「いや、」 at the start', () => {
    const result = detector.detect('いや、それは全然違う');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('denial');
  });

  it('does not detect in normal conversation', () => {
    expect(detector.detect('今日はいい天気だね')).toBeNull();
    expect(detector.detect('ありがとう、助かった')).toBeNull();
    expect(detector.detect('うん、そうだね')).toBeNull();
  });

  it('does not detect 違う in unrelated context', () => {
    expect(detector.detect('違う世界の話をしよう')).toBeNull();
  });

  it('detects denial emoji reactions', () => {
    expect(detector.detectReaction('👎')).toBe(true);
    expect(detector.detectReaction('❌')).toBe(true);
    expect(detector.detectReaction('😤')).toBe(true);
    expect(detector.detectReaction('👍')).toBe(false);
    expect(detector.detectReaction('❤️')).toBe(false);
  });
});
