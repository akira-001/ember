import type { BotConfig } from './bot-config';

export class BotRegistry {
  private configs: Map<string, BotConfig>;
  private orderedIds: string[];

  constructor(configs: BotConfig[]) {
    this.configs = new Map(configs.map(c => [c.id, c]));
    this.orderedIds = configs.map(c => c.id);
  }

  getBotIds(): string[] {
    return [...this.orderedIds];
  }

  getOtherBotIds(selfId: string): string[] {
    return this.orderedIds.filter(id => id !== selfId);
  }

  getDisplayName(botId: string): string {
    return this.configs.get(botId)?.displayName ?? botId;
  }

  getConfig(botId: string): BotConfig | undefined {
    return this.configs.get(botId);
  }

  getStatePaths(): string[] {
    return this.orderedIds.map(id => this.configs.get(id)!.statePath);
  }

  has(botId: string): boolean {
    return this.configs.has(botId);
  }

  /** Bot 名（id + displayName）にマッチする正規表現を生成 */
  getBotNamePattern(): RegExp {
    const names: string[] = [];
    for (const [id, config] of this.configs) {
      names.push(id, config.displayName, config.name);
    }
    const escaped = [...new Set(names)]
      .sort((a, b) => b.length - a.length)
      .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(
      `(?:${escaped.join('|')})(?:\\s*(?:と|and|,|、)\\s*(?:${escaped.join('|')}))?`,
      'gi',
    );
  }
}
