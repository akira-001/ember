import { Logger } from './logger';

export interface BotTurn {
  botId: string;
  message: string;
  timestamp: string;
}

export interface BotConversation {
  id: string;
  channel: string;
  participants: string[];
  turns: BotTurn[];
  maxTurns: number;
  startedAt: string;
  status: 'active' | 'completed' | 'limit_reached';
  trigger: string;
  // Debate mode fields
  mode?: 'conversation' | 'debate';
  theme?: string;
  interventions?: string[];
}

const DEFAULT_MAX_TURNS = 6;
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export class BotConversationManager {
  private conversations: Map<string, BotConversation> = new Map();
  private defaultMaxTurns: number;
  private logger: Logger;

  constructor(maxTurns: number = DEFAULT_MAX_TURNS) {
    this.defaultMaxTurns = maxTurns;
    this.logger = new Logger('BotConversation');
  }

  // Lifecycle

  startConversation(
    channel: string,
    threadTs: string,
    trigger: string,
    participants: string[],
    maxTurns?: number,
  ): BotConversation {
    const conversation: BotConversation = {
      id: threadTs,
      channel,
      participants,
      turns: [],
      maxTurns: maxTurns ?? this.defaultMaxTurns,
      startedAt: new Date().toISOString(),
      status: 'active',
      trigger,
      mode: 'conversation',
    };

    this.conversations.set(threadTs, conversation);
    this.logger.info(`Started bot conversation`, {
      threadTs,
      channel,
      participants,
      trigger: trigger.substring(0, 100),
    });

    return conversation;
  }

  startDebate(
    channel: string,
    threadTs: string,
    theme: string,
    participants: string[],
    maxTurns: number = 20,
  ): BotConversation {
    const conversation: BotConversation = {
      id: threadTs,
      channel,
      participants,
      turns: [],
      maxTurns: Math.min(maxTurns, 50), // hard cap at 50
      startedAt: new Date().toISOString(),
      status: 'active',
      trigger: theme,
      mode: 'debate',
      theme,
      interventions: [],
    };

    this.conversations.set(threadTs, conversation);
    this.logger.info(`Started debate`, {
      threadTs,
      channel,
      participants,
      theme: theme.substring(0, 100),
      maxTurns: conversation.maxTurns,
    });

    return conversation;
  }

  addIntervention(threadTs: string, message: string): boolean {
    const conversation = this.conversations.get(threadTs);
    if (!conversation || conversation.mode !== 'debate') return false;
    if (conversation.status !== 'active') return false;

    if (!conversation.interventions) conversation.interventions = [];
    conversation.interventions.push(message);
    this.logger.info(`Debate intervention added`, { threadTs, message: message.substring(0, 100) });
    return true;
  }

  consumeInterventions(threadTs: string): string[] {
    const conversation = this.conversations.get(threadTs);
    if (!conversation || !conversation.interventions) return [];

    const interventions = [...conversation.interventions];
    conversation.interventions = [];
    return interventions;
  }

  isDebate(threadTs: string): boolean {
    const conversation = this.conversations.get(threadTs);
    return conversation?.mode === 'debate';
  }

  endConversation(threadTs: string, reason: 'completed' | 'limit_reached'): void {
    const conversation = this.conversations.get(threadTs);
    if (!conversation) {
      this.logger.warn(`Attempted to end non-existent conversation: ${threadTs}`);
      return;
    }

    conversation.status = reason;
    this.logger.info(`Ended bot conversation`, {
      threadTs,
      reason,
      totalTurns: conversation.turns.length,
    });
  }

  // Turn management

  addTurn(threadTs: string, botId: string, message: string): boolean {
    const conversation = this.conversations.get(threadTs);
    if (!conversation) {
      this.logger.warn(`Attempted to add turn to non-existent conversation: ${threadTs}`);
      return false;
    }

    if (conversation.status !== 'active') {
      this.logger.debug(`Conversation ${threadTs} is not active (status: ${conversation.status})`);
      return false;
    }

    if (conversation.turns.length >= conversation.maxTurns) {
      this.logger.info(`Turn limit reached for conversation ${threadTs}`);
      conversation.status = 'limit_reached';
      return false;
    }

    conversation.turns.push({
      botId,
      message,
      timestamp: new Date().toISOString(),
    });

    this.logger.debug(`Added turn to conversation`, {
      threadTs,
      botId,
      turnNumber: conversation.turns.length,
      maxTurns: conversation.maxTurns,
    });

    return true;
  }

  getNextSpeaker(threadTs: string): string | null {
    const conversation = this.conversations.get(threadTs);
    if (!conversation) return null;

    if (conversation.status !== 'active') return null;
    if (conversation.turns.length >= conversation.maxTurns) return null;

    if (conversation.turns.length === 0) {
      // First speaker is participants[0] by default
      return conversation.participants[0];
    }

    const lastSpeaker = conversation.turns[conversation.turns.length - 1].botId;
    const lastIndex = conversation.participants.indexOf(lastSpeaker);

    // Alternate to the other participant
    const nextIndex = (lastIndex + 1) % conversation.participants.length;
    return conversation.participants[nextIndex];
  }

  shouldEnd(threadTs: string): boolean {
    const conversation = this.conversations.get(threadTs);
    if (!conversation) return true;

    return conversation.turns.length >= conversation.maxTurns;
  }

  // Query

  getConversation(threadTs: string): BotConversation | undefined {
    return this.conversations.get(threadTs);
  }

  isActiveConversation(threadTs: string): boolean {
    const conversation = this.conversations.get(threadTs);
    return conversation?.status === 'active';
  }

  getActiveConversations(): BotConversation[] {
    const active: BotConversation[] = [];
    for (const conversation of this.conversations.values()) {
      if (conversation.status === 'active') {
        active.push(conversation);
      }
    }
    return active;
  }

  // Context building

  buildConversationContext(threadTs: string, forBotId: string): string {
    const conversation = this.conversations.get(threadTs);
    if (!conversation) return '';

    if (conversation.mode === 'debate') {
      return this.buildDebateContext(conversation, forBotId);
    }

    const participantNames = conversation.participants
      .map((p) => this.capitalize(p))
      .join(' と ');

    const lines: string[] = [
      `これは ${participantNames} の会話の続きです。`,
      '',
    ];

    for (const turn of conversation.turns) {
      lines.push(`${this.capitalize(turn.botId)}: ${turn.message}`);
    }

    lines.push('');
    lines.push(
      `あなたは ${this.capitalize(forBotId)} です。相手の意見を踏まえて、あなたの視点で返答してください。`,
    );

    return lines.join('\n');
  }

  private buildDebateContext(conversation: BotConversation, forBotId: string): string {
    const otherParticipant = conversation.participants.find(p => p !== forBotId);
    const otherName = otherParticipant ? this.capitalize(otherParticipant) : '相手';
    const myName = this.capitalize(forBotId);
    const turnNumber = conversation.turns.length + 1;

    const lines: string[] = [
      `あなたは ${myName} です。${otherName} と以下のテーマについて議論しています。`,
      '',
      `テーマ: ${conversation.theme}`,
      '',
    ];

    if (conversation.turns.length > 0) {
      lines.push('--- これまでの議論 ---');
      for (const turn of conversation.turns) {
        lines.push(`${this.capitalize(turn.botId)}: ${turn.message}`);
      }
      lines.push('---');
      lines.push('');
    }

    // Include any interventions from Akira
    const interventions = conversation.interventions || [];
    if (interventions.length > 0) {
      lines.push(`Akiraからの指示: ${interventions.join(' / ')}`);
      lines.push('');
    }

    lines.push(`ターン ${turnNumber}/${conversation.maxTurns} です。`);
    lines.push(`${otherName}の意見を踏まえて、あなたの視点で議論を発展させてください。`);
    lines.push('同じ論点を繰り返さず、新しい角度、具体例、データ、反論を加えてください。');

    if (turnNumber >= conversation.maxTurns - 1) {
      lines.push('議論の終盤です。これまでの論点をまとめつつ、最終的な立場を明確にしてください。');
    }

    return lines.join('\n');
  }

  // Conclusion

  buildConclusionPrompt(threadTs: string): string {
    const conversation = this.conversations.get(threadTs);
    if (!conversation) return '';

    const lines: string[] = [];

    for (const turn of conversation.turns) {
      lines.push(`${this.capitalize(turn.botId)}: ${turn.message}`);
    }

    if (conversation.mode === 'debate') {
      return [
        `以下の議論を総括してください。`,
        '',
        `テーマ: ${conversation.theme}`,
        '',
        '--- 議論ログ ---',
        ...lines,
        '---',
        '',
        '以下の形式でまとめてください:',
        '1. 主要な論点（箇条書き）',
        '2. Mei と Eve の意見の共通点',
        '3. 意見が分かれた点',
        '4. 結論・推奨アクション',
      ].join('\n');
    }

    return [
      '会話のターン上限に達しました。Akira に向けて、ここまでの議論を簡潔にまとめてください。',
      '両者の意見のポイントと、結論や提案があればそれも含めてください。',
      '',
      '--- 会話ログ ---',
      ...lines,
    ].join('\n');
  }

  // Cleanup

  cleanupOld(maxAgeMs: number = DEFAULT_MAX_AGE_MS): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [threadTs, conversation] of this.conversations.entries()) {
      const age = now - new Date(conversation.startedAt).getTime();
      if (age > maxAgeMs) {
        this.conversations.delete(threadTs);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.info(`Cleaned up ${cleaned} old bot conversation(s)`);
    }
  }

  // Private helpers

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
