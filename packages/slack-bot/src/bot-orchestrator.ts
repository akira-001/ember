import { BotConfig } from './bot-config';
import { BotInstance } from './bot-instance';
import { BotConversationManager } from './bot-conversation';
import { RateLimiter } from './rate-limiter';
import { TokenTracker } from './token-tracker';
import { Scheduler } from './scheduler';
import type { IProactiveAgent } from './proactive-agent-interface';
import { McpManager } from './mcp-manager';
import { Logger } from './logger';
import { StampTracker } from './stamp-tracker';
import { BotRegistry } from './bot-registry';
import { config } from './config';
import { getDateTimeInTz, getTimezone } from './timezone';
import express from 'express';
import { EventBus } from './event-bus';
import { CronAdapter } from './event-sources/cron-adapter';
import { GmailPoller } from './event-sources/gmail-poller';
import { CalendarPoller } from './event-sources/calendar-poller';
import { RssPoller } from './event-sources/rss-poller';
import { GitHubWebhook } from './event-sources/github-webhook';
import type { EventSourceConfig } from './event-sources/types';
import { DEFAULT_EVENT_SOURCE_CONFIG } from './event-sources/types';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ImplicitMemoryStore } from './implicit-memory/store';
import { Reconciler } from './implicit-memory/reconciler';
import { MemoryAbsorber } from './implicit-memory/absorber';
import { MemoryRecall } from './implicit-memory/recall';
import { DenialDetector } from './implicit-memory/denial-detector';
import { migrateFromUserInsights } from './implicit-memory/migrator';
import { getEmbedding, cosineSimilarity } from './proactive-state';
import { getLocalModelsConfig } from './bot-config';
import { queryWithFallback } from './openai-fallback';

export class BotOrchestrator {
  private bots: Map<string, BotInstance> = new Map();
  private knownBotUserIds: Set<string> = new Set();
  private turnOrder: string[] = []; // alternating first responder
  private pendingSecond: Map<string, { botId: string; userMessage: string; channel: string; threadTs?: string }> = new Map(); // messageTs -> pending second responder info
  private rateLimiter: RateLimiter;
  private tokenTracker: TokenTracker;
  private conversationManager: BotConversationManager;
  private mcpManager: McpManager;
  private stampTracker: StampTracker;
  private registry: BotRegistry;
  private scheduler: Scheduler | null = null;
  private eventBus: EventBus | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private memoryAbsorbers: Map<string, MemoryAbsorber> = new Map();
  private memoryRecalls: Map<string, MemoryRecall> = new Map();
  private logger: Logger;

  constructor(configs: BotConfig[]) {
    this.logger = new Logger('BotOrchestrator');

    // Shared infrastructure
    this.mcpManager = new McpManager();
    this.mcpManager.loadConfiguration();
    this.registry = new BotRegistry(configs);
    this.rateLimiter = new RateLimiter();
    this.tokenTracker = new TokenTracker();
    this.stampTracker = new StampTracker(this.registry);
    this.conversationManager = new BotConversationManager();

    // Create a BotInstance per config
    for (const cfg of configs) {
      const proactiveEnabled = cfg.configJson?.proactive?.enabled ?? false;
      const instance = new BotInstance(cfg, this.mcpManager, {
        enableProactiveAgent: proactiveEnabled,
        enableMementoSkills: proactiveEnabled,
        orchestrator: this,
        botRegistry: this.registry,
      });
      this.bots.set(cfg.id, instance);
      this.logger.info(`Created bot instance: ${cfg.name} (${cfg.id})${proactiveEnabled ? ' with Proactive Agent' : ''}`);

      // --- Implicit Memory per bot ---
      try {
        const memoryPath = join(process.cwd(), 'data', 'implicit-memory.json');
        const memoryStore = new ImplicitMemoryStore(memoryPath, cfg.id);

        const judgeFn = async (p: { existing: string; new: string; prompt: string }): Promise<string> => {
          const lmCfg = getLocalModelsConfig();
          const jobCfg = lmCfg.jobs?.['implicit-memory-judge'];
          const url = jobCfg?.backend === 'ollama'
            ? lmCfg.ollama.url + '/v1/chat/completions'
            : lmCfg.mlx.url;
          const model = jobCfg?.model || (jobCfg?.backend === 'ollama' ? 'qwen3:32b' : lmCfg.mlx.model);
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: `既存: 「${p.existing}」\n新規: 「${p.new}」\n\n${p.prompt}` }],
              max_tokens: 10,
            }),
            signal: AbortSignal.timeout(lmCfg.mlx.timeoutMs),
          });
          const data: any = await res.json();
          return data.choices?.[0]?.message?.content ?? 'C';
        };

        const extractFn = async (text: string, context: string) => {
          const lmCfg = getLocalModelsConfig();
          const jobCfg = lmCfg.jobs?.['implicit-memory-extract'];
          const url = jobCfg?.backend === 'ollama'
            ? lmCfg.ollama.url + '/v1/chat/completions'
            : lmCfg.mlx.url;
          const model = jobCfg?.model || (jobCfg?.backend === 'ollama' ? 'qwen3:32b' : lmCfg.mlx.model);
          const prompt = `以下のテキストから、ユーザーについての情報を抽出してJSON形式で返してください。
テキスト: 「${text}」
コンテキスト: ${context}

JSONの形式:
{"facts":[{"content":"...","context":"..."}],"preferences":[{"content":"...","context":"...","intensity":"strong|moderate|slight"}],"patterns":[{"content":"...","context":"..."}],"values":[{"content":"...","context":"..."}],"expressions":[{"content":"...","context":"..."}]}

何もなければ空配列にしてください。JSONのみを返してください。`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 500,
            }),
            signal: AbortSignal.timeout(lmCfg.mlx.timeoutMs),
          });
          const data: any = await res.json();
          const raw = data.choices?.[0]?.message?.content ?? '{}';
          try {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            return JSON.parse(jsonMatch ? jsonMatch[0] : raw);
          } catch {
            return { facts: [], preferences: [], patterns: [], values: [], expressions: [] };
          }
        };

        const reconciler = new Reconciler(memoryStore, {
          judge: judgeFn,
          getEmbedding,
          cosineSimilarity,
        });

        const absorber = new MemoryAbsorber({
          store: memoryStore,
          reconciler,
          denialDetector: new DenialDetector(),
          extract: extractFn,
          getEmbedding,
        });

        const recall = new MemoryRecall(memoryStore, {
          getEmbedding,
          cosineSimilarity,
        });

        this.memoryAbsorbers.set(cfg.id, absorber);
        this.memoryRecalls.set(cfg.id, recall);

        // One-time migration from legacy user-insights.json
        try {
          migrateFromUserInsights(cfg.insightsPath, memoryPath, cfg.id);
        } catch (e) {
          this.logger.error(`Failed to migrate insights for bot ${cfg.id}`, e);
        }

        this.logger.info(`Implicit memory initialized for ${cfg.name} (${cfg.id})`);
      } catch (e) {
        this.logger.error(`Failed to initialize implicit memory for bot ${cfg.id}`, e);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    // Start all bot instances in parallel
    await Promise.all(
      Array.from(this.bots.values()).map((bot) => bot.start()),
    );

    // Log resolved user IDs and populate known set
    for (const [id, bot] of Array.from(this.bots.entries())) {
      const uid = bot.config.slack.botUserId;
      this.logger.info(`Bot "${id}" userId: ${uid ?? '(unresolved)'}`);
      if (uid) {
        this.knownBotUserIds.add(uid);
      }
    }

    // Scheduler — use first bot's app instance, pass all bot configs
    const firstBot = this.bots.values().next().value;
    if (firstBot) {
      const botConfigMap = new Map<string, BotConfig>();
      for (const [id, inst] of this.bots) {
        botConfigMap.set(id, inst.config);
      }
      const botsMap = new Map<string, any>();
      for (const [id, inst] of this.bots) {
        botsMap.set(id, inst.app);
      }
      // Collect all proactive agents for multi-bot support
      const proactiveAgents = new Map<string, IProactiveAgent>();
      for (const [id, inst] of this.bots) {
        if (inst.proactiveAgent) proactiveAgents.set(id, inst.proactiveAgent);
      }
      this.scheduler = new Scheduler(firstBot.app, this.mcpManager, proactiveAgents, botsMap, botConfigMap);
      const jobCount = this.scheduler.loadJobs();
      if (jobCount > 0) {
        this.scheduler.start();
        this.logger.info(`Scheduler started with ${jobCount} job(s)`);
      }
    }

    // EventBus — event-driven proactive messaging
    this.eventBus = new EventBus();

    // CronAdapter bridges scheduler cron fires into the EventBus
    const cronAdapter = new CronAdapter(this.eventBus);
    this.eventBus.registerSource(cronAdapter);
    if (this.scheduler) {
      this.scheduler.setCronAdapter(cronAdapter);
    }

    // Per-bot event sources (use first enabled bot's config)
    const firstConfig = Array.from(this.bots.values())[0]?.config;
    const esConfig: EventSourceConfig =
      (firstConfig?.configJson as any)?.eventSources ?? DEFAULT_EVENT_SOURCE_CONFIG;

    if (esConfig.gmail.enabled) {
      this.eventBus.registerSource(new GmailPoller(this.eventBus, esConfig.gmail));
    }
    if (esConfig.calendar.enabled) {
      this.eventBus.registerSource(new CalendarPoller(this.eventBus, esConfig.calendar));
    }
    if (esConfig.rss.enabled) {
      let interests: string[] = [];
      try {
        const cache = JSON.parse(readFileSync(join(process.cwd(), 'data', 'interest-cache.json'), 'utf-8'));
        interests = Object.keys(cache.interests || {}).slice(0, 10);
      } catch { /* no interest cache */ }
      if (interests.length > 0) {
        this.eventBus.registerSource(new RssPoller(this.eventBus, esConfig.rss, interests));
      }
    }
    if (esConfig.github.enabled && esConfig.github.webhookSecret) {
      const ghWebhook = new GitHubWebhook(this.eventBus, esConfig.github);
      this.eventBus.registerSource(ghWebhook);
    }

    // Subscribe all proactive agents to events
    for (const [botId, inst] of this.bots) {
      if (inst.proactiveAgent && inst.proactiveAgent.handleEvent) {
        const agent = inst.proactiveAgent;
        this.eventBus.on('*', (event) => {
          agent.handleEvent!(event).catch((err: any) =>
            this.logger.error(`Event handler error for ${botId}`, err),
          );
        });
      }
    }

    await this.eventBus.startAll();
    this.logger.info(`EventBus started with ${Object.keys(this.eventBus.getSourceStatuses()).length} source(s)`);

    // Periodic cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.rateLimiter.cleanup();
      this.conversationManager.cleanupOld();
    }, 5 * 60 * 1000);

    // Internal HTTP API for dashboard integration
    this.startInternalApi();

    this.logger.info('All bots started');
  }

  private startInternalApi(): void {
    const httpApp = express();
    httpApp.use(express.json());

    // Trigger proactive checkin (supports ?botId= param)
    httpApp.post('/internal/run-proactive', async (req, res) => {
      try {
        const botId = (req.query.botId as string) || this.registry.getBotIds()[0];
        const bot = this.bots.get(botId);
        if (!bot?.proactiveAgent) {
          res.status(404).json({ error: `Proactive agent not found for bot: ${botId}` });
          return;
        }
        const startTime = Date.now();
        await bot.proactiveAgent.run();
        const durationMs = Date.now() - startTime;
        res.json({ status: 'success', botId, durationMs });
      } catch (e: any) {
        res.status(500).json({ status: 'error', error: e.message });
      }
    });

    // Trigger any scheduled job by name (uses scheduler's runNow)
    httpApp.post('/internal/run-job/:name', async (req, res) => {
      try {
        if (!this.scheduler) {
          res.status(404).json({ error: 'Scheduler not running' });
          return;
        }
        const startTime = Date.now();
        await this.scheduler.runNow(req.params.name);
        const durationMs = Date.now() - startTime;
        res.json({ status: 'success', durationMs });
      } catch (e: any) {
        res.status(500).json({ status: 'error', error: e.message });
      }
    });

    // Voice chat → Claude: ask a question with tool access (calendar, etc.)
    httpApp.post('/internal/ask', async (req, res) => {
      try {
        const { question, botId: reqBotId, speaker, systemPrompt } = req.body;
        if (!question) {
          res.status(400).json({ error: 'question is required' });
          return;
        }
        const botId = reqBotId || this.registry.getBotIds()[0];
        const bot = this.bots.get(botId);
        if (!bot) {
          res.status(404).json({ error: `Bot not found: ${botId}` });
          return;
        }

        const startTime = Date.now();
        const speakerName = speaker || 'ユーザー';
        const prompt = systemPrompt
          ? `${systemPrompt}\n\n直近の発話: ${question}`
          : `${speakerName}さんが音声で質問しました: 「${question}」\n\n簡潔に（1-2文で）回答してください。音声で読み上げられるので、Markdownやリンクは使わないでください。`;

        // Collect full response from streaming query
        let reply = '';
        for await (const msg of bot.claudeHandler.streamQuery(
          prompt,
          undefined,  // no session (one-shot)
          undefined,  // no abort
          undefined,  // default working dir
          undefined,  // no slack context
          undefined,  // no append system prompt
        )) {
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (typeof block === 'object' && block.type === 'text') {
                reply += block.text;
              }
            }
          }
        }

        const durationMs = Date.now() - startTime;
        res.json({ ok: true, reply: reply.trim(), durationMs, botId });
      } catch (e: any) {
        this.logger.error(`/internal/ask error: ${e.message}`);
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    const port = parseInt(process.env.INTERNAL_API_PORT || '3457');
    httpApp.listen(port, '127.0.0.1', () => {
      this.logger.info(`Internal API listening on http://127.0.0.1:${port}`);
    });
  }

  getEventBus(): EventBus | null {
    return this.eventBus;
  }

  async stop(): Promise<void> {
    // Stop EventBus
    if (this.eventBus) {
      await this.eventBus.stopAll();
      this.eventBus = null;
    }

    // Stop scheduler
    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler = null;
    }

    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Stop all bot instances in parallel
    await Promise.all(
      Array.from(this.bots.values()).map((bot) => bot.stop()),
    );

    this.logger.info('All bots stopped');
  }

  // ---------------------------------------------------------------------------
  // Bot registry
  // ---------------------------------------------------------------------------

  getBot(botId: string): BotInstance | undefined {
    return this.bots.get(botId);
  }

  getBotByUserId(slackUserId: string): BotInstance | undefined {
    for (const bot of Array.from(this.bots.values())) {
      if (bot.config.slack.botUserId === slackUserId) {
        return bot;
      }
    }
    return undefined;
  }

  isBotUser(slackUserId: string): boolean {
    // Check resolved bot user IDs
    if (this.getBotByUserId(slackUserId) !== undefined) {
      return true;
    }
    // Also check the known bot user IDs set (populated during start)
    return this.knownBotUserIds.has(slackUserId);
  }

  getOtherBots(botId: string): BotInstance[] {
    const others: BotInstance[] = [];
    for (const [id, bot] of Array.from(this.bots.entries())) {
      if (id !== botId) {
        others.push(bot);
      }
    }
    return others;
  }

  // ---------------------------------------------------------------------------
  // Group chat coordination: first/second responder
  // ---------------------------------------------------------------------------

  /**
   * Assign 'first' or 'second' role for a user message in group chat.
   * Alternates who goes first each message.
   */
  assignRole(botId: string, messageTs: string): 'first' | 'second' {
    // Initialize turn order with bot IDs
    if (this.turnOrder.length === 0) {
      this.turnOrder = Array.from(this.bots.keys());
    }

    const firstBotId = this.turnOrder[0];
    if (botId === firstBotId) {
      // Store info for triggering second bot later
      this.pendingSecond.set(messageTs, {
        botId: this.turnOrder[1] || '',
        userMessage: '',  // will be filled by handleBotMessage
        channel: '',
        threadTs: undefined,
      });
      return 'first';
    } else {
      return 'second';
    }
  }

  /**
   * Called after the first bot responds. Triggers the second bot
   * with context of what the first bot said.
   */
  async triggerSecondResponder(
    firstBotId: string,
    channel: string,
    threadTs: string | undefined,
    firstBotResponse: string,
    userMessage: string,
  ): Promise<void> {
    // Rotate turn order for next message
    this.turnOrder.push(this.turnOrder.shift()!);

    const otherBots = this.getOtherBots(firstBotId);
    if (otherBots.length === 0) return;

    const secondBot = otherBots[0];
    if (!this.rateLimiter.canSend(secondBot.config.id)) {
      this.logger.info('Second responder rate limited', { botId: secondBot.config.id });
      return;
    }

    const firstName = this.registry.getDisplayName(firstBotId);
    const prompt = `Akiraからのメッセージ: 「${userMessage}」

${firstName}はこう返事した:
「${firstBotResponse}」

あなたは${firstName}とは別のアプローチで返答して。同じ検索や同じ情報を繰り返さないこと。
${firstName}がカバーしてない角度、別の視点、補完する情報を提供して。
二人で協力してAkiraに最高の回答を届けよう。`;

    // Use second bot's ClaudeHandler session for context continuity
    const sessionUser = secondBot.config.id;
    let session = secondBot.claudeHandler.getSession(sessionUser, channel, undefined);
    if (!session) {
      session = secondBot.claudeHandler.createSession(sessionUser, channel, undefined);
    }

    // Use same MCP configuration as SlackHandler
    const mcpServers = this.mcpManager.getServerConfiguration();
    const options: any = {
      outputFormat: 'stream-json',
      permissionMode: 'bypassPermissions',
      cwd: process.env.BASE_DIRECTORY || process.cwd(),
      appendSystemPrompt: secondBot.config.personality.systemPrompt + '\n\n## 現在時刻\n' + getDateTimeInTz(new Date(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }) + ' (' + getTimezone() + ')' + '\n\n## 今週のスタンプ競争\n' + this.stampTracker.buildScoreSummary(),
      model: secondBot.config.personality.chatModel,
      ...(mcpServers && Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
    };

    // Build prompt with conversation history
    secondBot.claudeHandler.addToHistory(session, 'user', userMessage);
    const fullPrompt = secondBot.claudeHandler.buildPromptWithHistory(session, prompt);

    let responseText = '';
    try {
      for await (const msg of queryWithFallback({
        prompt: fullPrompt,
        options,
      })) {
        if (msg.type === 'assistant' && (msg as any).subtype === 'text') {
          responseText += (msg as any).text || '';
        }
        if (msg.type === 'result' && !responseText && (msg as any).result) {
          responseText = (msg as any).result;
        }
      }

      if (responseText) {
        // Post to main thread (no thread_ts) for group chat
        await secondBot.app.client.chat.postMessage({
          channel,
          text: responseText,
        });
        this.rateLimiter.recordSend(secondBot.config.id);
        secondBot.claudeHandler.addToHistory(session, 'assistant', responseText);
        this.logger.info('Second responder replied', { botId: secondBot.config.id });
      }
    } catch (error) {
      this.logger.error('Failed to trigger second responder', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Debate mode
  // ---------------------------------------------------------------------------

  /**
   * Check if a debate is currently active.
   */
  hasActiveDebate(): boolean {
    return this.conversationManager.getActiveConversations().some(c => c.mode === 'debate');
  }

  /**
   * Get active debate thread (if any).
   */
  getActiveDebateThread(): string | undefined {
    const active = this.conversationManager.getActiveConversations().find(c => c.mode === 'debate');
    return active?.id;
  }

  /**
   * Start a debate between bots.
   * The first bot kicks off with their opening opinion, then the loop continues automatically.
   */
  async startDebate(
    theme: string,
    maxTurns: number,
    channel: string,
    triggerTs: string,
  ): Promise<void> {
    if (this.hasActiveDebate()) {
      this.logger.warn('Debate already in progress, ignoring new request');
      // Post notice to Slack
      const firstBot = this.bots.values().next().value;
      if (firstBot) {
        await firstBot.app.client.chat.postMessage({
          channel,
          thread_ts: triggerTs,
          text: '既に議論が進行中だよ。終わるまで待ってね。',
        });
      }
      return;
    }

    // Create a thread by posting the debate announcement
    const firstBot = Array.from(this.bots.values())[0];
    if (!firstBot) return;

    const announcement = await firstBot.app.client.chat.postMessage({
      channel,
      thread_ts: triggerTs,
      text: `議論を開始するね。\nテーマ: *${theme}*\nターン数: ${maxTurns}`,
    });

    const threadTs = announcement.ts!;

    // Register debate in conversation manager and rate limiter
    const participants = Array.from(this.bots.keys());
    this.conversationManager.startDebate(channel, threadTs, theme, participants, maxTurns);
    this.rateLimiter.markDebateThread(threadTs);

    this.logger.info('Debate started', { theme, maxTurns, threadTs, channel });

    // Run the debate loop
    await this.runDebateLoop(threadTs, channel);
  }

  /**
   * Main debate loop — runs all turns sequentially.
   */
  private async runDebateLoop(threadTs: string, channel: string): Promise<void> {
    const conversation = this.conversationManager.getConversation(threadTs);
    if (!conversation) return;

    for (let turn = 0; turn < conversation.maxTurns; turn++) {
      // Check if debate was terminated (early stop by user)
      if (!this.conversationManager.isActiveConversation(threadTs)) {
        this.logger.info('Debate terminated early', { threadTs, turn });
        break;
      }

      const speakerId = this.conversationManager.getNextSpeaker(threadTs);
      if (!speakerId) break;

      const bot = this.bots.get(speakerId);
      if (!bot) break;

      // Rate limit check
      if (!this.rateLimiter.canSend(speakerId, threadTs)) {
        this.logger.info('Debate turn rate limited, waiting...', { speakerId });
        await this.sleep(15_000);
        if (!this.rateLimiter.canSend(speakerId, threadTs)) {
          this.logger.warn('Still rate limited after wait, skipping turn');
          continue;
        }
      }

      // Consume any interventions from Akira
      const interventions = this.conversationManager.consumeInterventions(threadTs);

      // Build context and query
      const context = this.conversationManager.buildConversationContext(threadTs, speakerId);
      if (!context) break;

      this.logger.info(`Debate turn ${turn + 1}/${conversation.maxTurns}`, { speakerId, threadTs });

      try {
        const responseText = await this.queryBot(bot, context);
        if (!responseText) {
          this.logger.warn(`Bot ${speakerId} produced no response in debate`);
          continue;
        }

        // Post to Slack thread
        await bot.app.client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: responseText,
        });

        // Record turn
        this.conversationManager.addTurn(threadTs, speakerId, responseText);
        this.rateLimiter.recordSend(speakerId);
        this.rateLimiter.recordBotToBotTurn(threadTs, speakerId);

        this.logger.info(`Debate turn completed`, { speakerId, turn: turn + 1 });

        // Small delay between turns to avoid hammering the API
        await this.sleep(3_000);
      } catch (error) {
        this.logger.error(`Debate turn failed`, error);
        // Continue to next turn on error
      }
    }

    // Conclude the debate with a summary
    if (this.conversationManager.isActiveConversation(threadTs)) {
      await this.concludeDebate(threadTs);
    }
  }

  /**
   * Handle intervention from Akira during an active debate.
   * Returns true if the message was consumed as an intervention.
   */
  handleDebateIntervention(threadTs: string, message: string): boolean {
    const conversation = this.conversationManager.getConversation(threadTs);
    if (!conversation || conversation.mode !== 'debate' || conversation.status !== 'active') {
      return false;
    }

    // Check for early termination keywords
    const earlyStopKeywords = ['まとめて', 'もういいよ', '終わり', '終了', 'stop', 'ストップ'];
    const isEarlyStop = earlyStopKeywords.some(kw => message.includes(kw));

    if (isEarlyStop) {
      this.logger.info('Early debate termination requested', { threadTs });
      // Mark the conversation as completed so the loop stops
      this.conversationManager.endConversation(threadTs, 'completed');
      // The loop will detect this and conclude
      return true;
    }

    // Otherwise, add as intervention for next turn
    this.conversationManager.addIntervention(threadTs, message);
    this.logger.info('Debate intervention added', { threadTs, message: message.substring(0, 100) });
    return true;
  }

  /**
   * Conclude a debate with a summary.
   */
  private async concludeDebate(threadTs: string): Promise<void> {
    const conversation = this.conversationManager.getConversation(threadTs);
    if (!conversation) return;

    const conclusionPrompt = this.conversationManager.buildConclusionPrompt(threadTs);
    if (!conclusionPrompt) return;

    // Use the last speaker's bot (or first bot) for the summary
    const lastTurn = conversation.turns[conversation.turns.length - 1];
    const summaryBotId = lastTurn ? lastTurn.botId : conversation.participants[0];
    const bot = this.bots.get(summaryBotId);
    if (!bot) return;

    this.logger.info('Concluding debate', { threadTs, summaryBotId });

    try {
      const conclusionText = await this.queryBot(bot, conclusionPrompt);
      if (conclusionText) {
        await bot.app.client.chat.postMessage({
          channel: conversation.channel,
          thread_ts: threadTs,
          text: `*--- 議論のまとめ ---*\n\n${conclusionText}`,
        });
      }

      this.conversationManager.endConversation(threadTs, 'completed');
      this.rateLimiter.unmarkDebateThread(threadTs);
      this.logger.info('Debate concluded', { threadTs, totalTurns: conversation.turns.length });
    } catch (error) {
      this.logger.error('Failed to conclude debate', error);
      this.conversationManager.endConversation(threadTs, 'limit_reached');
      this.rateLimiter.unmarkDebateThread(threadTs);
    }
  }

  /**
   * Query a bot and return the response text.
   */
  private async queryBot(bot: BotInstance, prompt: string): Promise<string> {
    const mcpServers = this.mcpManager.getServerConfiguration();
    const options: any = {
      outputFormat: 'stream-json',
      permissionMode: 'bypassPermissions',
      cwd: process.env.BASE_DIRECTORY || process.cwd(),
      appendSystemPrompt: bot.config.personality.systemPrompt + '\n\n## 現在時刻\n' + getDateTimeInTz(new Date(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }) + ' (' + getTimezone() + ')',
      model: bot.config.personality.chatModel,
    };

    if (mcpServers && Object.keys(mcpServers).length > 0) {
      options.mcpServers = mcpServers;
      const allowedTools = this.mcpManager.getDefaultAllowedTools();
      if (allowedTools.length > 0) {
        options.allowedTools = allowedTools;
      }
    }

    let responseText = '';
    const timeout = setTimeout(() => {}, 180_000); // 3 min for debate turns

    try {
      for await (const msg of queryWithFallback({
        prompt,
        options,
      })) {
        if (msg.type === 'assistant' && (msg as any).subtype === 'text') {
          responseText += (msg as any).text || '';
        }
        if (msg.type === 'result') {
          if (!responseText && (msg as any).result) {
            responseText = (msg as any).result;
          }
          const usage = (msg as any).usage;
          if (usage) {
            this.recordTokenUsage(
              bot.config.id,
              usage.input_tokens || 0,
              usage.output_tokens || 0,
              usage.cost_usd || 0,
              `debate`,
            );
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    return responseText.trim();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ---------------------------------------------------------------------------
  // Bot-to-bot conversation
  // ---------------------------------------------------------------------------

  async handleBotMessage(
    fromBotId: string,
    channel: string,
    threadTs: string,
    message: string,
    messageTs: string,
  ): Promise<void> {
    const conversation = this.conversationManager.getConversation(threadTs);
    const isBotConvoChannel = channel === config.botConversationChannel;

    // If no active conversation, start one only in the designated channel
    if (!conversation && isBotConvoChannel) {
      const participantIds = Array.from(this.bots.keys());
      this.conversationManager.startConversation(channel, threadTs, message, participantIds);
      // Record the initial message as a turn
      this.conversationManager.addTurn(threadTs, fromBotId, message);
    } else if (conversation) {
      // Record the turn from the sending bot
      this.conversationManager.addTurn(threadTs, fromBotId, message);
    } else {
      // Not in the bot conversation channel and no active conversation — ignore
      return;
    }

    // Check if conversation should end
    if (this.conversationManager.shouldEnd(threadTs)) {
      await this.concludeConversation(threadTs, fromBotId);
      return;
    }

    // Determine next speaker
    const nextSpeakerId = this.conversationManager.getNextSpeaker(threadTs);
    if (!nextSpeakerId) {
      this.logger.debug('No next speaker determined, ending');
      return;
    }

    // If next speaker is the same bot that just sent, skip (shouldn't happen normally)
    if (nextSpeakerId === fromBotId) {
      this.logger.debug('Next speaker is the same as sender, skipping');
      return;
    }

    const targetBot = this.bots.get(nextSpeakerId);
    if (!targetBot) {
      this.logger.warn(`Target bot not found: ${nextSpeakerId}`);
      return;
    }

    // Rate limit check on the target bot
    if (!this.rateLimiter.canSend(nextSpeakerId)) {
      this.logger.info(`Rate limit hit for bot ${nextSpeakerId}, skipping turn`);
      return;
    }

    if (!this.rateLimiter.canBotToBotTurn(threadTs)) {
      this.logger.info(`Bot-to-bot rate limit hit for thread ${threadTs}`);
      return;
    }

    // Trigger the target bot to respond
    await this.triggerBotResponse(nextSpeakerId, channel, threadTs);
  }

  // ---------------------------------------------------------------------------
  // Private: trigger a bot to respond in a conversation
  // ---------------------------------------------------------------------------

  private async triggerBotResponse(
    botId: string,
    channel: string,
    threadTs: string,
  ): Promise<void> {
    const bot = this.bots.get(botId);
    if (!bot) return;

    const conversationContext = this.conversationManager.buildConversationContext(threadTs, botId);
    if (!conversationContext) {
      this.logger.warn(`No conversation context for thread ${threadTs}`);
      return;
    }

    this.logger.info(`Triggering bot response: ${botId} in thread ${threadTs}`);

    try {
      // Query Claude via the bot's handler
      let responseText = '';
      const abortController = new AbortController();

      // Timeout: 2 minutes for bot-to-bot
      const timeout = setTimeout(() => abortController.abort(), 120_000);

      const mcpServers = this.mcpManager.getServerConfiguration();
      const options: any = {
        outputFormat: 'stream-json',
        permissionMode: 'bypassPermissions',
        cwd: process.env.BASE_DIRECTORY || process.cwd(),
        appendSystemPrompt: bot.config.personality.systemPrompt,
        model: bot.config.personality.chatModel,
      };

      if (mcpServers && Object.keys(mcpServers).length > 0) {
        options.mcpServers = mcpServers;
        const allowedTools = this.mcpManager.getDefaultAllowedTools();
        if (allowedTools.length > 0) {
          options.allowedTools = allowedTools;
        }
      }

      try {
        for await (const msg of queryWithFallback({
          prompt: conversationContext,
          options,
        })) {
          if (msg.type === 'assistant' && (msg as any).subtype === 'text') {
            responseText += (msg as any).text || '';
          }
          if (msg.type === 'result') {
            if (!responseText && (msg as any).result) {
              responseText = (msg as any).result;
            }
            // Record token usage from result
            const usage = (msg as any).usage;
            if (usage) {
              this.recordTokenUsage(
                botId,
                usage.input_tokens || 0,
                usage.output_tokens || 0,
                usage.cost_usd || 0,
                `bot-conversation:${threadTs}`,
              );
            }
          }
        }
      } finally {
        clearTimeout(timeout);
      }

      if (!responseText.trim()) {
        this.logger.info(`Bot ${botId} produced no response`);
        return;
      }

      // Post the response to Slack
      await bot.app.client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: responseText.trim(),
      });

      // Record the turn
      this.conversationManager.addTurn(threadTs, botId, responseText.trim());
      this.rateLimiter.recordSend(botId);
      this.rateLimiter.recordBotToBotTurn(threadTs, botId);

      this.logger.info(`Bot ${botId} responded in thread ${threadTs}`);

      // Check if we should conclude after this turn
      if (this.conversationManager.shouldEnd(threadTs)) {
        await this.concludeConversation(threadTs, botId);
      }
    } catch (error) {
      this.logger.error(`Failed to trigger bot ${botId} response`, error);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: conclude a conversation
  // ---------------------------------------------------------------------------

  private async concludeConversation(threadTs: string, lastSpeakerId: string): Promise<void> {
    const conversation = this.conversationManager.getConversation(threadTs);
    if (!conversation) return;

    const conclusionPrompt = this.conversationManager.buildConclusionPrompt(threadTs);
    if (!conclusionPrompt) return;

    const lastBot = this.bots.get(lastSpeakerId);
    if (!lastBot) return;

    this.logger.info(`Concluding conversation in thread ${threadTs}`);

    try {
      let conclusionText = '';
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 120_000);

      const options: any = {
        outputFormat: 'stream-json',
        permissionMode: 'bypassPermissions',
        cwd: process.env.BASE_DIRECTORY || process.cwd(),
        appendSystemPrompt: lastBot.config.personality.systemPrompt + '\n\n## 現在時刻\n' + getDateTimeInTz(new Date(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }) + ' (' + getTimezone() + ')',
        model: lastBot.config.personality.chatModel,
      };

      try {
        for await (const msg of queryWithFallback({
          prompt: conclusionPrompt,
          options,
        })) {
          if (msg.type === 'assistant' && (msg as any).subtype === 'text') {
            conclusionText += (msg as any).text || '';
          }
          if (msg.type === 'result') {
            if (!conclusionText && (msg as any).result) {
              conclusionText = (msg as any).result;
            }
            const usage = (msg as any).usage;
            if (usage) {
              this.recordTokenUsage(
                lastSpeakerId,
                usage.input_tokens || 0,
                usage.output_tokens || 0,
                usage.cost_usd || 0,
                `bot-conversation-conclusion:${threadTs}`,
              );
            }
          }
        }
      } finally {
        clearTimeout(timeout);
      }

      if (conclusionText.trim()) {
        await lastBot.app.client.chat.postMessage({
          channel: conversation.channel,
          thread_ts: threadTs,
          text: conclusionText.trim(),
        });
      }

      this.conversationManager.endConversation(threadTs, 'limit_reached');
      this.rateLimiter.startCooldown();
    } catch (error) {
      this.logger.error(`Failed to conclude conversation ${threadTs}`, error);
      this.conversationManager.endConversation(threadTs, 'limit_reached');
    }
  }

  // ---------------------------------------------------------------------------
  // Token tracking
  // ---------------------------------------------------------------------------

  recordTokenUsage(
    botId: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
    context: string,
  ): void {
    this.tokenTracker.record({
      botId,
      timestamp: new Date().toISOString(),
      inputTokens,
      outputTokens,
      costUsd,
      context,
    });
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  getTokenTracker(): TokenTracker {
    return this.tokenTracker;
  }

  getConversationManager(): BotConversationManager {
    return this.conversationManager;
  }

  getStampTracker(): StampTracker {
    return this.stampTracker;
  }

  // Record a stamp (emoji reaction) for a bot
  recordStamp(botId: string, emoji: string, messageTs: string, channel: string): void {
    this.stampTracker.record(botId, emoji, messageTs, channel);
    const scores = this.stampTracker.getScores();
    this.logger.info('Stamp recorded', { botId, emoji, scores });
  }

  // Get stamp score summary for system prompt injection
  getStampSummary(): string {
    return this.stampTracker.buildScoreSummary();
  }

  // ---------------------------------------------------------------------------
  // Implicit Memory accessors
  // ---------------------------------------------------------------------------

  getMemoryAbsorber(botId: string): MemoryAbsorber | undefined {
    return this.memoryAbsorbers.get(botId);
  }

  getMemoryRecall(botId: string): MemoryRecall | undefined {
    return this.memoryRecalls.get(botId);
  }
}
