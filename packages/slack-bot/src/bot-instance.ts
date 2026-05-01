import { App } from '@slack/bolt';
import { BotConfig } from './bot-config';
import { ClaudeHandler } from './claude-handler';
import { SlackHandler } from './slack-handler';
import { McpManager } from './mcp-manager';
import { ProactiveAgent } from './proactive-agent';
import { SkillEnhancedProactiveAgent } from './skill-enhanced-proactive-agent';
import { IProactiveAgent } from './proactive-agent-interface';
import type { BotRegistry } from './bot-registry';
import { Logger } from './logger';

export interface BotInstanceOptions {
  enableProactiveAgent?: boolean;
  enableMementoSkills?: boolean; // Enable Memento-Skills learning system
  orchestrator?: any; // BotOrchestrator reference — typed as any to avoid circular deps
  botRegistry?: BotRegistry;
}

export class BotInstance {
  readonly config: BotConfig;
  readonly app: App;
  readonly claudeHandler: ClaudeHandler;
  readonly slackHandler: SlackHandler;
  readonly proactiveAgent?: IProactiveAgent;
  private logger: Logger;

  constructor(
    config: BotConfig,
    mcpManager: McpManager,
    options?: BotInstanceOptions,
  ) {
    this.config = config;
    this.logger = new Logger(`BotInstance:${config.id}`);

    // Slack App (one per bot — each bot has its own token set)
    this.app = new App({
      token: config.slack.botToken,
      signingSecret: config.slack.signingSecret,
      socketMode: true,
      appToken: config.slack.appToken,
    });

    // Claude handler (shared McpManager, but handler instance is per-bot)
    this.claudeHandler = new ClaudeHandler(mcpManager, config.id);

    // Proactive agent (optional — typically only the primary bot)
    if (options?.enableProactiveAgent) {
      if (options?.enableMementoSkills) {
        this.proactiveAgent = new SkillEnhancedProactiveAgent({
          app: this.app,
          statePath: config.statePath,
          insightsPath: config.insightsPath,
          systemPrompt: config.personality.systemPrompt,
          chatModel: config.personality.chatModel,
          enableSkillLearning: true,
          botId: config.id,
          botName: config.name,
          botRegistry: options.botRegistry,
          mentionUserId: 'U3SFGQXNH',
          claudeHandler: this.claudeHandler,
        });
        this.logger.info('Initialized with Memento-Skills enabled');
      } else {
        this.proactiveAgent = new ProactiveAgent({
          app: this.app,
          statePath: config.statePath,
          insightsPath: config.insightsPath,
          systemPrompt: config.personality.systemPrompt,
          chatModel: config.personality.chatModel,
          botId: config.id,
          botName: config.name,
        });
        this.logger.info('Initialized with standard ProactiveAgent');
      }
    }

    // Slack event handler
    this.slackHandler = new SlackHandler(
      this.app,
      this.claudeHandler,
      mcpManager,
      this.proactiveAgent,
      config,
      options?.orchestrator,
    );

    this.slackHandler.setupEventHandlers();
  }

  /**
   * Start the Slack socket-mode connection and resolve the bot's own user ID.
   */
  async start(): Promise<void> {
    await this.app.start();

    // Resolve botUserId and displayName from Slack API
    try {
      const authResult = await this.app.client.auth.test();
      this.config.slack.botUserId = authResult.user_id as string;

      // Resolve displayName from Slack profile
      if (this.config.slack.botUserId) {
        try {
          const userInfo = await this.app.client.users.info({
            user: this.config.slack.botUserId,
          });
          const profile = (userInfo.user as any)?.profile;
          this.config.displayName =
            profile?.display_name ||
            profile?.real_name ||
            this.config.name;
        } catch {
          // users:read scope missing — fallback to config.name
        }
      }

      this.logger.info(`Started bot "${this.config.displayName}" (${this.config.id})`, {
        botUserId: this.config.slack.botUserId,
        displayName: this.config.displayName,
      });
    } catch (error) {
      this.logger.error('Failed to resolve bot identity via Slack API', error);
      // Non-fatal — displayName falls back to config.name
    }
  }

  /**
   * Graceful shutdown.
   */
  async stop(): Promise<void> {
    this.logger.info(`Stopping bot "${this.config.name}" (${this.config.id})`);
    try {
      await this.app.stop();
    } catch (error) {
      this.logger.error('Error during app.stop()', error);
    }
  }
}
