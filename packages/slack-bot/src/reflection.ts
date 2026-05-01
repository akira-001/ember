import type { HeartbeatEntry } from './heartbeat-context';
import { readFileSync, writeFileSync, existsSync } from 'fs';

export interface ReflectionContext {
  heartbeatEntries: HeartbeatEntry[];
  lastReflectionAt: Date | null;
  currentTime: Date;
}

export interface ReflectionOutput {
  observations: string[];
  successPatterns: string[];
  avoidPatterns: string[];
}

// Emoji that trigger immediate reflection (strong emotional signal)
const STRONG_REACTION_EMOJI = new Set([
  '❤️', '😍', '🥰', '💯', '🔥',      // very positive
  '😤', '👎', '😢', '💢', '🙅',        // negative
]);

const REFLECTION_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours minimum
const REFLECTION_MAX_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours max

export function shouldReflect(ctx: ReflectionContext): boolean {
  const { heartbeatEntries, lastReflectionAt, currentTime } = ctx;

  if (heartbeatEntries.length === 0) return false;
  if (!lastReflectionAt) return true;

  const msSinceLastReflection = currentTime.getTime() - lastReflectionAt.getTime();

  if (msSinceLastReflection >= REFLECTION_MAX_INTERVAL_MS) return true;
  if (msSinceLastReflection < REFLECTION_COOLDOWN_MS) return false;

  const recentEntries = heartbeatEntries.filter(
    e => new Date(e.timestamp).getTime() > lastReflectionAt.getTime()
  );
  const hasStrongReaction = recentEntries.some(
    e => e.type === 'reaction' && e.emoji && STRONG_REACTION_EMOJI.has(e.emoji)
  );
  if (hasStrongReaction) return true;

  return false;
}

export function buildReflectionPrompt(
  entries: HeartbeatEntry[],
  currentMemory: string,
  botId: string,
  failurePatterns?: string[],
): string {
  if (entries.length === 0) return '';

  const entrySummary = entries.map(e => {
    switch (e.type) {
      case 'send': return `[${e.timeDisplay}] 送信: ${e.message || '(不明)'} (${e.category || ''})`;
      case 'skip': return `[${e.timeDisplay}] スキップ: ${e.reason || ''}`;
      case 'reaction': return `[${e.timeDisplay}] リアクション: ${e.emoji}`;
      case 'reply': return `[${e.timeDisplay}] Akiraさんの返信: ${e.replyPreview || ''}`;
      case 'reflect': return `[${e.timeDisplay}] 内省: ${e.message || ''}`;
      default: return `[${e.timeDisplay}] ${(e as HeartbeatEntry).type}`;
    }
  }).join('\n');

  const failureSection = failurePatterns && failurePatterns.length > 0
    ? `\n## 検出された失敗パターン\n${failurePatterns.map(p => `- ${p}`).join('\n')}\n\nこれらのパターンを「避けるべきこと」に反映してください。`
    : '';

  return `あなたは ${botId} として、最近のAkiraさんとのやりとりを振り返っている。

## 最近のやりとり
${entrySummary}

## 現在のMEMORY.md
${currentMemory}
${failureSection}
## タスク
以下の3セクションについて、最近のやりとりから学んだことを JSON で出力してください。
変化がないセクションは空配列にしてください。

{"observations": ["Akiraさんについて気づいたこと（最大2件）"], "successPatterns": ["うまくいったこと（最大1件）"], "avoidPatterns": ["避けるべきこと（最大1件）"]}

ルール:
- 既に MEMORY.md にある内容と重複しない、新しい気づきのみ
- 具体的に書く（「良い反応だった」ではなく「趣味の話題を昼に送ると❤️がもらえた」）
- 変化がなければ空配列でOK。無理に書かない`;
}

export function parseReflectionResponse(response: string): ReflectionOutput {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { observations: [], successPatterns: [], avoidPatterns: [] };
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      observations: Array.isArray(parsed.observations) ? parsed.observations : [],
      successPatterns: Array.isArray(parsed.successPatterns) ? parsed.successPatterns : [],
      avoidPatterns: Array.isArray(parsed.avoidPatterns) ? parsed.avoidPatterns : [],
    };
  } catch {
    return { observations: [], successPatterns: [], avoidPatterns: [] };
  }
}

const today = () => new Date().toISOString().split('T')[0];

export function applyReflection(output: ReflectionOutput, memoryPath: string): void {
  const { observations, successPatterns, avoidPatterns } = output;
  const hasContent = observations.length > 0 || successPatterns.length > 0 || avoidPatterns.length > 0;
  if (!hasContent) return;

  if (!existsSync(memoryPath)) return;
  let content = readFileSync(memoryPath, 'utf-8');

  // Remove placeholder text
  content = content.replace(/（まだ記録なし）\n?/g, '');

  const dateTag = today();

  if (observations.length > 0) {
    const items = observations.map(o => `- [${dateTag}] ${o}`).join('\n');
    content = content.replace(
      /(## Recent Observations\n)/,
      `$1${items}\n`,
    );
  }

  if (successPatterns.length > 0) {
    const items = successPatterns.map(s => `- [${dateTag}] ${s}`).join('\n');
    content = content.replace(
      /(## Success Patterns\n)/,
      `$1${items}\n`,
    );
  }

  if (avoidPatterns.length > 0) {
    const items = avoidPatterns.map(a => `- [${dateTag}] ${a}`).join('\n');
    content = content.replace(
      /(## Patterns to Avoid\n)/,
      `$1${items}\n`,
    );
  }

  writeFileSync(memoryPath, content, 'utf-8');
}

// --- Failure Pattern Detection (Reflexion) ---

export interface InteractionOutcome {
  timestamp: string;
  category: string;
  reaction: 'positive' | 'neutral' | 'negative';
  estimatedMode: string;
}

/**
 * Detect repeated failure patterns from interaction history.
 * Returns human-readable descriptions of patterns to avoid.
 */
export function detectFailurePatterns(outcomes: InteractionOutcome[]): string[] {
  if (outcomes.length < 3) return [];

  const patterns: string[] = [];

  // Pattern 1: Same category getting negative reactions repeatedly
  const categoryNegatives = new Map<string, number>();
  for (const o of outcomes) {
    if (o.reaction === 'negative') {
      categoryNegatives.set(o.category, (categoryNegatives.get(o.category) || 0) + 1);
    }
  }
  for (const [cat, count] of categoryNegatives) {
    if (count >= 2) {
      patterns.push(`カテゴリ「${cat}」で${count}回ネガティブ反応。このカテゴリは控えるべき`);
    }
  }

  // Pattern 2: Negative reactions during specific estimated modes
  const modeNegatives = new Map<string, number>();
  const modeTotals = new Map<string, number>();
  for (const o of outcomes) {
    modeTotals.set(o.estimatedMode, (modeTotals.get(o.estimatedMode) || 0) + 1);
    if (o.reaction === 'negative') {
      modeNegatives.set(o.estimatedMode, (modeNegatives.get(o.estimatedMode) || 0) + 1);
    }
  }
  for (const [mode, negCount] of modeNegatives) {
    const total = modeTotals.get(mode) || 1;
    if (negCount >= 2 && negCount / total > 0.5) {
      patterns.push(`モード「${mode}」中の送信は${Math.round(negCount / total * 100)}%がネガティブ。このモード中は控えるべき`);
    }
  }

  // Pattern 3: Consecutive negative reactions (3+)
  let consecutiveNeg = 0;
  let maxConsecutiveNeg = 0;
  for (const o of outcomes) {
    if (o.reaction === 'negative') {
      consecutiveNeg++;
      maxConsecutiveNeg = Math.max(maxConsecutiveNeg, consecutiveNeg);
    } else {
      consecutiveNeg = 0;
    }
  }
  if (maxConsecutiveNeg >= 3) {
    patterns.push(`${maxConsecutiveNeg}回連続でネガティブ反応。送信頻度を下げるべき`);
  }

  return patterns;
}
