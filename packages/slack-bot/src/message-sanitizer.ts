const DM_FALLBACK = 'ごめんね、うまく処理できなかったみたい。もう一度試してもらえるかな？';
const CHANNEL_FALLBACK = '⚠️ うまく処理できなかったみたい。もう一度試してね。';

const ERROR_PATTERNS: RegExp[] = [
  /^(API Error:|Error:|\{.*"type"\s*:\s*"error")/i,
  /invalid api key/i,
  /fix external api key/i,
  /external api key/i,
  /unauthorized/i,
  /\b401\b/,
  /\brate_limit_error\b/i,
  /\b429\b/,
  /\bENOENT\b/,
  /spawn .* ENOENT/i,
];

export function sanitizeAssistantText(text: string, isDM: boolean): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (ERROR_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return isDM ? DM_FALLBACK : CHANNEL_FALLBACK;
  }

  return text;
}

export function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function isDuplicateFinalMessage(finalText: string, emittedText: string): boolean {
  return normalizeMessageText(finalText) === normalizeMessageText(emittedText);
}
