import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { buildThemeTrail, classifyProactiveTheme, type ThemeInput } from './proactive-themes';

function getSharedFile(): string {
  return process.env.SHARED_HISTORY_PATH || join(process.cwd(), 'data', 'shared-proactive-history.json');
}
const MAX_ENTRIES = 50;
export const DEFAULT_OTHER_BOT_CONTEXT_HOURS = 24;
export const DEFAULT_OTHER_BOT_DEDUP_HOURS = 48;

const TOPIC_STOPWORDS = [
  '記事', 'ニュース', '話題', '特集', 'まとめ', '情報', '最新', '今週', '今週末', '週末',
  '今日', '明日', '昨日', '来週', '今朝', '今夜', '午後', '午前', 'おでかけ', 'イベント',
  'おすすめ', '人気', '速報', '公開', '発表', '出てた', '出てたよ', '出たよ', 'みたい', 'らしい',
  'について', 'についての', '関東', '東京', '近郊', '春', 'gw',
];

const TOPIC_PREFIX_PATTERNS = [
  /^(akiraさん[、,]?\s*)/i,
  /^(ねぇ(ねぇ)?[、,]?\s*)/i,
  /^(ねえ[、,]?\s*)/i,
  /^(おはよう[！!。]?\s*)/i,
  /^(そういえば(さ)?[、,]?\s*)/i,
  /^(ちょっと[、,]?\s*)/i,
  /^(あのさ[、,]?\s*)/i,
  /^(ふふ[、,]?\s*)/i,
  /^(お(昼|疲れさま|つかれ)[^。]*[。\n]\s*)/i,
  /^((午前|午後|今日|明日|昨日|今朝|今夜|今週|週末)[^。]*[。\n]\s*)/i,
  /^([^\n]{0,30}(終わったら|始まるね|の前に|の合間に)[^。]*[。\n]\s*)/i,
  /^(メール[^。]*[。\n]\s*)/i,
  /^(寝る前に[^。]*[。\n]\s*)/i,
];

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'si',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
]);

export interface SharedEntry {
  botId: string;
  botName: string;
  sentAt: string;
  category: string;
  interestCategory?: string;
  preview: string; // first 150 chars of message
  topic?: string;
  url?: string;
  candidateId?: string;
  sourceType?: string;
  skill?: string;
  themePath?: string[];
  themeKey?: string;
  // Inner Thoughts (arxiv 2501.00383) + Plan-Generate-Evaluate.
  // Observation-only in v1 — recorded for rebuild judgment 2026-06-15 (#1 retro 2026-04-25).
  inner_thought?: string;
  plan?: string[];
  generate_score?: number[];
  evaluate_score?: number;
}

export function normalizeUrlForDedup(url?: string | null): string {
  const raw = (url || '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (TRACKING_PARAMS.has(key) || key.startsWith('utm_')) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return raw.replace(/#.*$/, '');
  }
}

interface SharedHistory {
  entries: SharedEntry[];
}

export function normalizeSharedTopic(text: string): string {
  let normalized = text.toLowerCase();

  const boldParts = [...normalized.matchAll(/\*([^*]+)\*/g)].map((m) => m[1]).filter(Boolean);
  if (boldParts.length > 0) {
    normalized = boldParts.join(' ');
  }

  normalized = normalized.replace(/https?:\/\/\S+/g, ' ');
  for (const pattern of TOPIC_PREFIX_PATTERNS) {
    normalized = normalized.replace(pattern, ' ');
  }

  for (const word of TOPIC_STOPWORDS) {
    normalized = normalized.replace(new RegExp(word, 'g'), ' ');
  }

  return normalized
    .replace(/[（）()【】「」『』｢｣﹁﹂﹃﹄\-:：|｜,、。."'"'!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSharedTopicSimilar(a: string, b: string): boolean {
  const aNorm = normalizeSharedTopic(a);
  const bNorm = normalizeSharedTopic(b);

  if (!aNorm || !bNorm) return false;
  if (aNorm === bNorm) return true;
  if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return true;

  const aTokens = aNorm.split(/[\s,、。！!？?\-\—\–]+/).filter((w) => w.length >= 2);
  const bTokens = bNorm.split(/[\s,、。！!？?\-\—\–]+/).filter((w) => w.length >= 2);
  const tokenMatches = aTokens.filter((w) => bNorm.includes(w)).length;
  if (tokenMatches >= 2) return true;

  const tokenOverlap = aTokens.filter((w) => bTokens.some((other) => other.includes(w) || w.includes(other)));
  if (tokenOverlap.length >= 2) return true;

  const cjkWindows: string[] = [];
  for (let i = 0; i <= aNorm.length - 4; i++) {
    const w = aNorm.slice(i, i + 4);
    if (/[\u3000-\u9fff]/.test(w)) cjkWindows.push(w);
  }
  if (cjkWindows.length > 0) {
    const cjkMatches = cjkWindows.filter((w) => bNorm.includes(w)).length;
    if (cjkMatches >= 4) return true;
  }

  const reverseWindows: string[] = [];
  for (let i = 0; i <= bNorm.length - 4; i++) {
    const w = bNorm.slice(i, i + 4);
    if (/[\u3000-\u9fff]/.test(w)) reverseWindows.push(w);
  }
  if (reverseWindows.length > 0) {
    const reverseMatches = reverseWindows.filter((w) => aNorm.includes(w)).length;
    if (reverseMatches >= 4) return true;
  }

  return false;
}

function load(): SharedHistory {
  const file = getSharedFile();
  try {
    if (existsSync(file)) {
      return JSON.parse(readFileSync(file, 'utf-8'));
    }
  } catch {
    // Corrupted file — start fresh
  }
  return { entries: [] };
}

function save(data: SharedHistory): void {
  const file = getSharedFile();
  const dir = dirname(file);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Atomic write: temp file + rename. Prevents a partial-write window where a
  // concurrent reader (other bot process) could see truncated JSON and decide
  // "no prior sends" — the exact bug that let two bots post the same article.
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  try {
    renameSync(tmp, file);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Record that a bot sent a proactive message.
 */
export function recordSharedSend(entry: Omit<SharedEntry, 'sentAt'>): void {
  const data = load();
  data.entries.push({
    ...entry,
    url: normalizeUrlForDedup(entry.url),
    sentAt: new Date().toISOString(),
  });
  // Keep only last MAX_ENTRIES
  if (data.entries.length > MAX_ENTRIES) {
    data.entries = data.entries.slice(-MAX_ENTRIES);
  }
  save(data);
}

/**
 * Get recent messages from OTHER bots (not the given botId) within the last N hours.
 */
export function getOtherBotMessages(botId: string, hoursBack: number = 24): SharedEntry[] {
  const data = load();
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  return data.entries.filter(e => e.botId !== botId && e.sentAt >= cutoff);
}

/**
 * Get recent messages from ALL bots within the last N hours. Used by scheduler-level
 * dedup where we want to block a duplicate regardless of which bot sent the original.
 */
export function getRecentSends(hoursBack: number = 48): SharedEntry[] {
  const data = load();
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  return data.entries.filter(e => e.sentAt >= cutoff);
}

/**
 * Format other bots' messages for prompt injection.
 */
export function formatOtherBotContext(botId: string, hoursBack: number = 24): string {
  const messages = getOtherBotMessages(botId, hoursBack);
  if (messages.length === 0) return '';

  const lines = messages.map(m => {
    const time = new Date(m.sentAt).toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Tokyo',
    });
    return `- ${m.botName} (${time}): ${m.preview}`;
  });

  return `\n## 他のボットが最近送ったメッセージ（重複を避けること）\n${lines.join('\n')}\n`;
}

/**
 * Combine existing memory context with other bots' recent proactive messages.
 */
export function buildSharedProactiveContext(
  botId: string,
  memoryContext: string = '',
  hoursBack: number = DEFAULT_OTHER_BOT_CONTEXT_HOURS,
): string {
  const otherBotContext = formatOtherBotContext(botId, hoursBack);
  if (!otherBotContext) return memoryContext;
  return memoryContext ? `${memoryContext}${otherBotContext}` : otherBotContext;
}
