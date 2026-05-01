import { getTimeInTz } from './timezone';

export interface HeartbeatEntry {
  type: 'send' | 'skip' | 'reaction' | 'reply' | 'reflect';
  timestamp: string;
  timeDisplay: string;
  message?: string;
  category?: string;
  decision?: 'send' | 'no_reply';
  modeEstimate?: string;
  reason?: string;
  emoji?: string;
  replyPreview?: string;
  // Inner Thoughts paper (arxiv 2501.00383) + Anthropic Plan-Generate-Evaluate.
  // observation-only in v1 — recorded but not used as a gate (#1 retro 2026-04-25).
  inner_thought?: string;
  plan?: string[];
  generate_score?: number[];
  evaluate_score?: number;
}

interface HeartbeatContextOptions {
  maxEntries: number;
}

export class HeartbeatContext {
  private entries: HeartbeatEntry[] = [];
  private maxEntries: number;

  constructor(options: Partial<HeartbeatContextOptions> = {}) {
    this.maxEntries = options.maxEntries ?? 20;
  }

  recordSend(data: {
    message: string;
    category: string;
    decision: 'send';
    modeEstimate: string;
    inner_thought?: string;
    plan?: string[];
    generate_score?: number[];
    evaluate_score?: number;
  }): void {
    this.push({
      type: 'send',
      timestamp: new Date().toISOString(),
      timeDisplay: getTimeInTz(new Date()),
      message: data.message.substring(0, 200),
      category: data.category,
      decision: data.decision,
      modeEstimate: data.modeEstimate,
      inner_thought: data.inner_thought,
      plan: data.plan,
      generate_score: data.generate_score,
      evaluate_score: data.evaluate_score,
    });
  }

  recordSkip(data: {
    reason: string;
    modeEstimate: string;
    inner_thought?: string;
    plan?: string[];
    generate_score?: number[];
    evaluate_score?: number;
  }): void {
    this.push({
      type: 'skip',
      timestamp: new Date().toISOString(),
      timeDisplay: getTimeInTz(new Date()),
      reason: data.reason,
      modeEstimate: data.modeEstimate,
      inner_thought: data.inner_thought,
      plan: data.plan,
      generate_score: data.generate_score,
      evaluate_score: data.evaluate_score,
    });
  }

  recordReaction(data: {
    emoji: string;
    slackTs: string;
  }): void {
    this.push({
      type: 'reaction',
      timestamp: new Date().toISOString(),
      timeDisplay: getTimeInTz(new Date()),
      emoji: data.emoji,
    });
  }

  recordReply(data: {
    preview: string;
  }): void {
    this.push({
      type: 'reply',
      timestamp: new Date().toISOString(),
      timeDisplay: getTimeInTz(new Date()),
      replyPreview: data.preview.substring(0, 200),
    });
  }

  recordReflect(data: { summary: string }): void {
    this.push({
      type: 'reflect',
      timestamp: new Date().toISOString(),
      timeDisplay: getTimeInTz(new Date()),
      message: data.summary,
    });
  }

  getEntries(): HeartbeatEntry[] {
    return [...this.entries];
  }

  toPromptSection(): string {
    if (this.entries.length === 0) return '';

    const lines = this.entries.map(e => {
      const innerHint = e.inner_thought ? ` ｜ 内なる声: ${e.inner_thought}` : '';
      const scoreHint = e.evaluate_score != null ? ` ｜ score=${e.evaluate_score.toFixed(2)}` : '';
      switch (e.type) {
        case 'send':
          return `- [${e.timeDisplay}] 送信（${e.modeEstimate}）: ${e.message}${innerHint}${scoreHint}`;
        case 'skip':
          return `- [${e.timeDisplay}] 見送り（${e.modeEstimate}）: ${e.reason}${innerHint}${scoreHint}`;
        case 'reaction':
          return `- [${e.timeDisplay}] Akiraさんのリアクション: :${e.emoji}:`;
        case 'reply':
          return `- [${e.timeDisplay}] Akiraさんの返信: ${e.replyPreview}`;
        case 'reflect':
          return `- [${e.timeDisplay}] 内省: ${e.message}`;
        default:
          return '';
      }
    }).filter(Boolean);

    return `## 直近の記憶（前回までのやりとり）\nあなたはこれまで以下の行動をとった。記憶のある存在として、この文脈を踏まえて次の行動を決めること。\n${lines.join('\n')}\n`;
  }

  serialize(): string {
    return JSON.stringify(this.entries);
  }

  static deserialize(json: string, options: Partial<HeartbeatContextOptions> = {}): HeartbeatContext {
    const ctx = new HeartbeatContext(options);
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        ctx.entries = parsed;
        while (ctx.entries.length > ctx.maxEntries) {
          ctx.entries.shift();
        }
      }
    } catch {
      ctx.entries = [];
    }
    return ctx;
  }

  private push(entry: HeartbeatEntry): void {
    this.entries.push(entry);
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }
}
