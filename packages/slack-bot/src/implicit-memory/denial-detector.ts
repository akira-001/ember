export interface DenialResult {
  type: 'denial' | 'repeated_correction';
  originalText: string;
  correctedContent?: string;
}

const DENIAL_PATTERNS: Array<{ pattern: RegExp; type: DenialResult['type'] }> = [
  { pattern: /^いや[、,]/, type: 'denial' },
  { pattern: /違うよ/, type: 'denial' },
  { pattern: /違うって/, type: 'denial' },
  { pattern: /そうじゃなくて/, type: 'denial' },
  { pattern: /そうじゃないよ/, type: 'denial' },
  { pattern: /それは違う/, type: 'denial' },
  { pattern: /全然違う/, type: 'denial' },
  { pattern: /前も言ったけど/, type: 'repeated_correction' },
  { pattern: /何度も言ってるけど/, type: 'repeated_correction' },
  { pattern: /何回も言ってるけど/, type: 'repeated_correction' },
  { pattern: /前にも言った/, type: 'repeated_correction' },
];

const CORRECTION_PATTERN = /(.+?)じゃなくて(.+?)(?:だよ|だね|です|。|$)/;

const DENIAL_EMOJI = new Set(['👎', '❌', '😤', '🙅', '🙅‍♂️', '🙅‍♀️', '✋']);

const FALSE_POSITIVE_PATTERNS = [
  /違う世界/,
  /違う場所/,
  /違う意味/,
  /違うタイプ/,
  /違う視点/,
  /違う角度/,
];

export class DenialDetector {
  detect(text: string): DenialResult | null {
    for (const fp of FALSE_POSITIVE_PATTERNS) {
      if (fp.test(text)) return null;
    }

    const correctionMatch = CORRECTION_PATTERN.exec(text);
    if (correctionMatch) {
      return {
        type: 'denial',
        originalText: text,
        correctedContent: correctionMatch[2].trim(),
      };
    }

    for (const { pattern, type } of DENIAL_PATTERNS) {
      if (pattern.test(text)) {
        return { type, originalText: text };
      }
    }

    return null;
  }

  detectReaction(emoji: string): boolean {
    return DENIAL_EMOJI.has(emoji);
  }
}
