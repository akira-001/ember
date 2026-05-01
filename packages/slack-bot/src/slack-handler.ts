import { App } from '@slack/bolt';
import { ClaudeHandler } from './claude-handler';
import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Logger } from './logger';
import { WorkingDirectoryManager } from './working-directory-manager';
import { FileHandler, ProcessedFile } from './file-handler';
import { TodoManager, Todo } from './todo-manager';
import { McpManager } from './mcp-manager';
import { permissionServer } from './permission-mcp-server';
import { config } from './config';
import { sanitizeAssistantText, isDuplicateFinalMessage } from './message-sanitizer';
import type { SDKMessageCompat as SDKMessage } from './openai-fallback';
import type { IProactiveAgent } from './proactive-agent-interface';
import type { BotConfig } from './bot-config';
import {
  loadState,
  saveState,
  isInProactiveWindow,
  getRecentProactiveMessagesWithMeta,
  getProactiveMessageByTs,
  applyReaction,
  applyCooldown,
  detectTextSignal,
  SHARED_CAPABILITIES,
  buildInsightsContext,
  extractInsightTag,
  saveInsightWithEmbedding,
} from './proactive-state';
import type { BotRegistry } from './bot-registry';
import { CmuxHandler } from './cmux-handler';
import { logUserMessage, logBotMessage, logCogmemEntry, appendCrossHistory, loadCrossHistoryPrompt } from './conversation-logger';
import { analyzeReplyForMissions, computeIntrinsicBoost, filterEnabledSignals, createDefaultIntrinsicConfig, computeLayerReward, type ProfileUpdateDetection, type LayerCollectionConfig } from './intrinsic-rewards';
import { getDateTimeInTz, getTimezone } from './timezone';

interface MessageEvent {
  user: string;
  channel: string;
  thread_ts?: string;
  ts: string;
  text?: string;
  files?: Array<{
    id: string;
    name: string;
    mimetype: string;
    filetype: string;
    url_private: string;
    url_private_download: string;
    size: number;
  }>;
}

export class SlackHandler {
  private app: App;
  private claudeHandler: ClaudeHandler;
  private activeControllers: Map<string, AbortController> = new Map();
  private logger = new Logger('SlackHandler');
  private workingDirManager: WorkingDirectoryManager;
  private fileHandler: FileHandler;
  private todoManager: TodoManager;
  private mcpManager: McpManager;
  private todoMessages: Map<string, string> = new Map(); // sessionKey -> messageTs
  private originalMessages: Map<string, { channel: string; ts: string }> = new Map(); // sessionKey -> original message info
  private currentReactions: Map<string, string> = new Map(); // sessionKey -> current emoji
  private botUserId: string | null = null;
  private lastMessageTime: number = 0; // throttle: timestamp of last processed message
  private static MESSAGE_THROTTLE_MS = 10000; // 10 seconds between messages per bot
  private proactiveAgent: IProactiveAgent | null = null;
  private botConfig?: BotConfig;
  private orchestrator?: any;
  private botRegistry?: BotRegistry;
  private cmuxHandler: CmuxHandler = new CmuxHandler();

  constructor(app: App, claudeHandler: ClaudeHandler, mcpManager: McpManager, proactiveAgent?: IProactiveAgent, botConfig?: BotConfig, orchestrator?: any, botRegistry?: BotRegistry) {
    this.app = app;
    this.claudeHandler = claudeHandler;
    this.mcpManager = mcpManager;
    this.proactiveAgent = proactiveAgent || null;
    this.botConfig = botConfig;
    this.orchestrator = orchestrator;
    this.botRegistry = botRegistry;
    this.logger.info('SlackHandler initialized', { botId: botConfig?.id, hasOrchestrator: !!orchestrator });
    this.workingDirManager = new WorkingDirectoryManager();
    this.fileHandler = new FileHandler(botConfig?.slack.botToken);
    this.todoManager = new TodoManager();
  }

  async handleMessage(event: MessageEvent, say: any) {
    const { user, channel, thread_ts, ts, text, files } = event;

    // "stop" command — halt all bot activity for this instance
    if (text && text.trim().toLowerCase() === 'stop') {
      this.lastMessageTime = Date.now() + 600_000; // block for 10 minutes
      this.logger.info('Stop command received — pausing bot for 10 minutes', { user, channel, botId: this.botConfig?.id });
      await say({ text: '了解、10分間お休みするね。', thread_ts: thread_ts || ts });
      return;
    }

    // Detect proactive context (for engagement tracking, not routing)
    let isProactiveContext = false;
    if (this.proactiveAgent) {
      if (thread_ts && this.proactiveAgent.isProactiveMessage(thread_ts)) {
        isProactiveContext = true;
      } else if (!thread_ts && channel.startsWith('D')) {
        const state = loadState(this.proactiveAgent.getStatePath());
        isProactiveContext = isInProactiveWindow(state);
      }
    }

    // Record user reply in heartbeat context for session continuity
    if (isProactiveContext && this.proactiveAgent?.recordReply && text) {
      this.proactiveAgent.recordReply(text.substring(0, 200));
    }

    // DM: reply in thread when user is in a thread, otherwise main
    const isDM = channel.startsWith('D');
    const botConversationChannel = process.env.BOT_CONVERSATION_CHANNEL;
    const isGroupChat = channel === botConversationChannel;
    const replyTs = isDM
      ? thread_ts   // DM: preserve thread context (undefined = main)
      : isGroupChat
        ? undefined
        : (thread_ts || ts);

    // Skip messages from any bot (self or other bots)
    const ownBotUserId = this.botConfig?.slack?.botUserId || this.botUserId;
    if (ownBotUserId && user === ownBotUserId) {
      this.logger.debug('Skipping own message', { user, channel });
      return;
    }
    if (this.orchestrator?.isBotUser(user)) {
      this.logger.debug('Skipping other bot message (orchestrator handles routing)', { user, channel });
      return;
    }

    // --- Debate mode: detection and intervention ---
    if (isGroupChat && this.orchestrator && text) {
      // Check if there's an active debate and this is a thread reply to it
      const activeDebateThread = this.orchestrator.getActiveDebateThread?.();
      if (activeDebateThread && thread_ts === activeDebateThread) {
        // This is Akira intervening in an active debate
        const handled = this.orchestrator.handleDebateIntervention(activeDebateThread, text);
        if (handled) {
          this.logger.info('Debate intervention handled', { thread_ts, text: text.substring(0, 50) });
          return;
        }
      }

      // Check if this message is requesting a new debate (only first bot handles)
      const debateRequest = this.parseDebateRequest(text);
      if (debateRequest && this.botConfig) {
        // Only the first bot in turn order should trigger the debate
        const role = this.orchestrator.assignRole(this.botConfig.id, ts);
        if (role === 'first') {
          this.logger.info('Debate request detected', debateRequest);
          // Run debate in background so we don't block
          this.orchestrator.startDebate(
            debateRequest.theme,
            debateRequest.turns,
            channel,
            ts,
          ).catch((e: any) => this.logger.error('Failed to start debate', e));
          return;
        } else {
          // Second bot skips — debate is handled by first bot
          return;
        }
      }
    }

    // Process any attached files
    let processedFiles: ProcessedFile[] = [];
    if (files && files.length > 0) {
      this.logger.info('Processing uploaded files', { count: files.length });
      processedFiles = await this.fileHandler.downloadAndProcessFiles(files);
      
      if (processedFiles.length > 0 && !isDM) {
        await say({
          text: `📎 Processing ${processedFiles.length} file(s): ${processedFiles.map(f => f.name).join(', ')}`,
          thread_ts: replyTs,
        });
      }
    }

    // If no text and no files, nothing to process
    if (!text && processedFiles.length === 0) return;

    // Log user message (DM only)
    if (isDM && text) {
      logUserMessage(user, channel, text, processedFiles.map(f => f.name));
    }

    // Non-blocking implicit memory absorption for user messages in DM
    if (isDM && text && this.botConfig?.id && this.orchestrator) {
      const absorber = this.orchestrator.getMemoryAbsorber?.(this.botConfig.id);
      if (absorber) {
        absorber.absorb({ text, source: 'slack_message', context: `Slack DM channel=${channel}` });
      }
    }

    this.logger.debug('Received message from Slack', {
      user,
      channel,
      thread_ts,
      ts,
      text: text ? text.substring(0, 100) + (text.length > 100 ? '...' : '') : '[no text]',
      fileCount: processedFiles.length,
    });

    // Check if this is a working directory command (only if there's text)
    const setDirPath = text ? this.workingDirManager.parseSetCommand(text) : null;
    if (setDirPath) {
      const result = this.workingDirManager.setWorkingDirectory(
        channel,
        setDirPath,
        thread_ts,
        isDM ? user : undefined
      );

      if (result.success) {
        const context = thread_ts ? 'this thread' : (isDM ? 'this conversation' : 'this channel');
        await say({
          text: `✅ Working directory set for ${context}: \`${result.resolvedPath}\``,
          thread_ts: replyTs,
        });
      } else {
        await say({
          text: `❌ ${result.error}`,
          thread_ts: replyTs,
        });
      }
      return;
    }

    // Check if this is a get directory command (only if there's text)
    if (text && this.workingDirManager.isGetCommand(text)) {
      const directory = this.workingDirManager.getWorkingDirectory(
        channel,
        thread_ts,
        isDM ? user : undefined
      );
      const context = thread_ts ? 'this thread' : (isDM ? 'this conversation' : 'this channel');
      
      await say({
        text: this.workingDirManager.formatDirectoryMessage(directory, context),
        thread_ts: replyTs,
      });
      return;
    }

    // Check if this is an MCP info command (only if there's text)
    if (text && this.isMcpInfoCommand(text)) {
      await say({
        text: this.mcpManager.formatMcpInfo(),
        thread_ts: replyTs,
      });
      return;
    }

    // Check if this is an MCP reload command (only if there's text)
    if (text && this.isMcpReloadCommand(text)) {
      const reloaded = this.mcpManager.reloadConfiguration();
      if (reloaded) {
        await say({
          text: `✅ MCP configuration reloaded successfully.\n\n${this.mcpManager.formatMcpInfo()}`,
          thread_ts: replyTs,
        });
      } else {
        await say({
          text: `❌ Failed to reload MCP configuration. Check the mcp-servers.json file.`,
          thread_ts: replyTs,
        });
      }
      return;
    }

    // Check if this is a cmux command
    if (text && this.cmuxHandler.isCmuxCommand(text)) {
      const result = await this.cmuxHandler.getNotifications();
      const msgResult = await say({ text: result.message, thread_ts: replyTs });
      if (result.surfaces.length > 0 && msgResult?.ts) {
        this.cmuxHandler.registerThread(msgResult.ts, result.surfaces);
      }
      return;
    }

    // Check if this is a reply to a cmux notification thread
    if (thread_ts && this.cmuxHandler.hasPendingReply(thread_ts)) {
      const result = await this.cmuxHandler.sendNumberedReply(thread_ts, text || '');
      await say({ text: result, thread_ts });
      return;
    }

    // Check if we have a working directory set
    let workingDirectory = this.workingDirManager.getWorkingDirectory(
      channel,
      thread_ts,
      isDM ? user : undefined
    );

    if (!workingDirectory) {
      workingDirectory = config.defaultWorkingDirectory || process.cwd();
      this.logger.info('Using fallback working directory', {
        channel,
        user,
        thread_ts,
        workingDirectory,
        hadDefaultWorkingDirectory: !!config.defaultWorkingDirectory,
      });
    }

    // DM and group chat: use stable session key (no ts) so conversation persists
    // Regular channels: use thread_ts to scope per-thread
    const sessionThreadKey = (isDM || isGroupChat) ? undefined : (thread_ts || ts);
    // For group chat, use botId in session key so each bot has its own session
    const sessionUser = isGroupChat && this.botConfig ? this.botConfig.id : user;
    const sessionKey = this.claudeHandler.getSessionKey(sessionUser, channel, sessionThreadKey);

    // Store the original message info for status reactions
    const originalMessageTs = thread_ts || ts;
    this.originalMessages.set(sessionKey, { channel, ts: originalMessageTs });

    // Cancel any existing request for this conversation
    const existingController = this.activeControllers.get(sessionKey);
    if (existingController) {
      this.logger.debug('Cancelling existing request for session', { sessionKey });
      existingController.abort();
    }

    const abortController = new AbortController();
    this.activeControllers.set(sessionKey, abortController);

    let session = this.claudeHandler.getSession(sessionUser, channel, sessionThreadKey);
    if (!session) {
      this.logger.debug('Creating new session', { sessionKey });
      session = this.claudeHandler.createSession(sessionUser, channel, sessionThreadKey);
    } else {
      this.logger.debug('Using existing session', { sessionKey, sessionId: session.sessionId });
    }

    let currentMessages: string[] = [];
    let streamedAssistantText = '';
    let statusMessageTs: string | undefined;

    try {
      // Prepare the prompt — images are resized and referenced by path for Read tool
      let rawPrompt = processedFiles.length > 0
        ? await this.fileHandler.formatFilePrompt(processedFiles, text || '')
        : text || '';

      // Inject proactive context so replies to proactive messages have continuity
      // Thread reply: inject only the parent message. DM main: inject last 5.
      if (this.proactiveAgent && isDM) {
        const state = loadState(this.proactiveAgent.getStatePath());
        // Thread reply to a proactive message → inject that specific message
        const threadMatch = thread_ts ? getProactiveMessageByTs(state, thread_ts) : null;
        // Top-level DM reply: only inject the most recent proactive if it was
        // sent recently. Pulling in stale proactives (hours/days old) causes
        // the model to reply to the wrong topic — e.g. a user's "A" gets
        // interpreted against yesterday's unrelated question.
        const PROACTIVE_RECENCY_MS = 60 * 60 * 1000; // 1 hour
        let topLevelCandidates: ReturnType<typeof getRecentProactiveMessagesWithMeta> = [];
        if (!threadMatch) {
          const latest = getRecentProactiveMessagesWithMeta(state, 1);
          if (latest.length > 0) {
            const sentAtMs = latest[0].sentAt ? new Date(latest[0].sentAt).getTime() : 0;
            if (sentAtMs && Date.now() - sentAtMs <= PROACTIVE_RECENCY_MS) {
              topLevelCandidates = latest;
            } else {
              this.logger.debug('Skipping stale proactive context injection', {
                ageMs: sentAtMs ? Date.now() - sentAtMs : null,
                slackTs: latest[0].slackTs,
              });
            }
          }
        }
        const recentMeta = threadMatch ? [threadMatch] : topLevelCandidates;
        if (recentMeta.length > 0) {
          const botDisplayName = this.botConfig?.displayName || this.botConfig?.name || 'Bot';
          // Use fullText when available, fall back to preview
          const contextLines = recentMeta.map(m => `${botDisplayName}: ${m.fullText || m.preview}`);

          // Attach source URLs stored with the message
          let sourceMeta = '';
          const allUrls = recentMeta.flatMap(m => m.sourceUrls || []);
          if (allUrls.length > 0) {
            const refs = allUrls.slice(0, 20).map(u => `- ${u.title} | ${u.source || ''} | ${u.url}`).join('\n');
            sourceMeta = `\n[参照可能な記事一覧（ユーザーが詳細やURLを聞いた場合にのみ使用）]\n${refs}`;
          } else {
            // Fallback: read interest-cache if no sourceUrls stored (old entries)
            const hasInterestSource = recentMeta.some(m => m.sources?.includes('interest-cache'));
            if (hasInterestSource) {
              try {
                const cachePath = join(process.cwd(), 'data', 'interest-cache.json');
                if (existsSync(cachePath)) {
                  const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
                  const cacheItems: Array<{ title: string; url: string; source: string }> = [];
                  for (const cat of Object.values(cache.categories || {})) {
                    const items = (cat as any)?.items;
                    if (Array.isArray(items)) {
                      cacheItems.push(...items.filter((i: any) => i.url && i.title));
                    }
                  }
                  if (cache.topItems && Array.isArray(cache.topItems)) {
                    cacheItems.push(...cache.topItems.filter((i: any) => i.url && i.title));
                  }
                  if (cacheItems.length > 0) {
                    const refs = cacheItems.slice(0, 20).map((i: any) => `- ${i.title} | ${i.source} | ${i.url}`).join('\n');
                    sourceMeta = `\n[参照可能な記事一覧（ユーザーが詳細やURLを聞いた場合にのみ使用）]\n${refs}`;
                  }
                }
              } catch { /* interest-cache read failure is non-fatal */ }
            }
          }

          rawPrompt = `[直前のプロアクティブメッセージ（あなた自身が送ったもの） — この文脈を踏まえて返信してください]\n${contextLines.join('\n')}${sourceMeta}\n\nAkira: ${rawPrompt}`;
        }
      }

      // Include conversation history for context continuity
      const finalPrompt = session ? this.claudeHandler.buildPromptWithHistory(session, rawPrompt) : rawPrompt;

      // Record user message in history
      if (session) {
        this.claudeHandler.addToHistory(session, 'user', rawPrompt);
      }

      const promptPreview = finalPrompt.substring(0, 200) + (finalPrompt.length > 200 ? '...' : '');
      this.logger.info('Sending query to Claude Code SDK', {
        prompt: promptPreview,
        sessionId: session.sessionId,
        workingDirectory,
        fileCount: processedFiles.length,
      });

      // Send initial status message (non-DM and non-group-chat only)
      if (!isDM && !isGroupChat) {
        const statusResult = await say({
          text: '👀',
          thread_ts: replyTs,
        });
        statusMessageTs = statusResult.ts;
      }

      // Add thinking reaction to original message (non-group-chat only)
      if (!isGroupChat) {
        await this.updateMessageReaction(sessionKey, '👀');
      }
      
      // Create Slack context for permission prompts (skip for group chat — use bypassPermissions)
      const slackContext = isGroupChat ? undefined : {
        channel,
        threadTs: thread_ts,
        user
      };
      
      // Build bot persona for DM / group-chat conversations
      let appendSystemPrompt: string | undefined;
      let chatModel: string | undefined;

      const channelCapabilities = SHARED_CAPABILITIES;
      const nowJst = getDateTimeInTz(new Date(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
      const tz = getTimezone();
      const currentTimeContext = `## 現在時刻\n${nowJst} (${tz})`;

      if ((isDM || isGroupChat) && this.botConfig) {
        // Use implicit memory if available, fall back to legacy insights
        let botContext: string;
        const memoryRecall = this.orchestrator?.getMemoryRecall?.(this.botConfig.id);
        if (memoryRecall) {
          try {
            const memories = await memoryRecall.getRelevantMemories(text || 'general', 10);
            botContext = 'Akiraについて知っていること:\n' + memoryRecall.formatForPrompt(memories);
          } catch {
            botContext = buildInsightsContext(this.botConfig.insightsPath);
          }
        } else {
          botContext = buildInsightsContext(this.botConfig.insightsPath);
        }
        // Collect fresh calendar/email data for context
        let collectedData = '';
        try {
          const { execSync } = await import('child_process');
          const { join } = await import('path');
          const scriptPath = join(process.cwd(), 'scripts', 'collect_data.py');
          collectedData = execSync(`python3 ${scriptPath}`, { encoding: 'utf-8', timeout: 15000 });
        } catch {
          collectedData = '{"errors": ["data collection unavailable"]}';
        }
        // Add stamp score context if available
        const stampContext = this.orchestrator?.getStampSummary?.() || '';
        // Google Maps saved places info
        const mapsInfo = `## Akiraの保存場所（Google Maps）
AkiraがGoogle Mapsに保存したお店が516件ある。食の好みを把握するのに使える。
ファイルパス: ${process.cwd()}/data/google-maps/places-summary.json
必要なときはこのファイルを読んで参照すること。`;
        const crossHistory = loadCrossHistoryPrompt(user);
        appendSystemPrompt = this.botConfig.personality.systemPrompt + '\n\n' + currentTimeContext + '\n\n' + botContext + (stampContext ? '\n\n## 今週のスタンプ競争\n' + stampContext : '') + '\n\n' + mapsInfo + '\n\n## 現在の収集データ（Gmail・カレンダー等）\n' + collectedData + (crossHistory ? '\n\n' + crossHistory : '');
        chatModel = this.botConfig.personality.chatModel;
      } else if (isDM && this.proactiveAgent) {
        // Fallback to old Mei behavior for backward compatibility
        const meiContext = buildInsightsContext(this.proactiveAgent.getInsightsPath());
        let collectedData = '';
        try {
          const { execSync } = await import('child_process');
          const { join } = await import('path');
          const scriptPath = join(process.cwd(), 'scripts', 'collect_data.py');
          collectedData = execSync(`python3 ${scriptPath}`, { encoding: 'utf-8', timeout: 15000 });
        } catch {
          collectedData = '{"errors": ["data collection unavailable"]}';
        }
        const crossHistoryFallback = loadCrossHistoryPrompt(user);
        appendSystemPrompt = this.proactiveAgent!.getSystemPrompt() + '\n\n' + currentTimeContext + '\n\n' + meiContext + '\n\n## 現在の収集データ（Gmail・カレンダー等）\n' + collectedData + (crossHistoryFallback ? '\n\n' + crossHistoryFallback : '');
        chatModel = this.botConfig?.personality.chatModel;
      } else {
        // Channel threads: add file upload instruction only
        appendSystemPrompt = channelCapabilities;
      }

      const uploadedFiles = new Set<string>();

      for await (const message of this.claudeHandler.streamQuery(finalPrompt, session, abortController, workingDirectory, slackContext, appendSystemPrompt, chatModel)) {
        if (abortController.signal.aborted) break;

        this.logger.debug('Received message from Claude SDK', {
          type: message.type,
          subtype: (message as any).subtype,
          message: message,
        });

        if (message.type === 'assistant') {
          // Check if this is a tool use message
          const hasToolUse = message.message.content?.some((part: any) => part.type === 'tool_use');
          
          if (hasToolUse) {
            // Update status to show working
            if (statusMessageTs) {
              await this.app.client.chat.update({
                channel,
                ts: statusMessageTs,
                text: '⚙️ *Working...*',
              });
            }

            // Update reaction to show working
            await this.updateMessageReaction(sessionKey, '⚙️');

            // Check for TodoWrite tool and handle it specially
            const todoTool = message.message.content?.find((part: any) => 
              part.type === 'tool_use' && part.name === 'TodoWrite'
            );

            if (todoTool) {
              await this.handleTodoUpdate(todoTool.input, sessionKey, session?.sessionId, channel, thread_ts || ts, say);
            }

            // Show tool use details only in regular channels (not DM or group chat)
            if (!isDM && !isGroupChat) {
              const toolContent = this.formatToolUse(message.message.content ?? []);
              if (toolContent) {
                await say({
                  text: toolContent,
                  thread_ts: replyTs,
                });
              }
            }
          } else {
            // Handle regular text content
            let content = this.extractTextContent(message);
            if (content) {
              const sanitized = sanitizeAssistantText(content, isDM);
              if (sanitized === null) {
                this.logger.warn('Suppressed empty assistant message', { content: content.substring(0, 100) });
                content = null;
              } else if (sanitized !== content) {
                this.logger.warn('Replaced assistant error text with friendly fallback', {
                  content: content.substring(0, 100),
                });
                content = sanitized;
              }
            }
            if (content) {
              // Extract and save insight tags before sending to Slack
              const insightsPath = this.botConfig?.insightsPath
                ?? (this.proactiveAgent?.getInsightsPath());
              if ((isDM || isGroupChat) && insightsPath) {
                const insight = extractInsightTag(content);
                if (insight) {
                  saveInsightWithEmbedding(insightsPath, insight)
                    .catch((e) => this.logger.error('Failed to save insight', e));
                  content = content.replace(/\[INSIGHT:\s*.+?\]/g, '').trim();
                }
              }

              // Process file upload markers before sending
              content = await this.processUploadMarkers(content, channel, replyTs, uploadedFiles);
              if (!content) continue;

              currentMessages.push(content);
              streamedAssistantText += content;

              // Send each new piece of content as a separate message
              const formatted = this.formatMessage(content, false);
              if (isDM) {
                logBotMessage(this.botConfig?.id || 'unknown', channel, content);
              }
              await say({
                text: formatted,
                thread_ts: replyTs,
              });
            }
          }
        } else if (message.type === 'result') {
          this.logger.info('Received result from Claude SDK', {
            subtype: message.subtype,
            hasResult: message.subtype === 'success' && !!(message as any).result,
            totalCost: (message as any).total_cost_usd,
            duration: (message as any).duration_ms,
          });
          
          if (message.subtype === 'success' && (message as any).result) {
            let finalResult = (message as any).result;
            if (finalResult) {
              finalResult = sanitizeAssistantText(finalResult, isDM) ?? '';
            }
            if (finalResult) {
              // Strip insight tags from final result
              const resultInsightsPath = this.botConfig?.insightsPath
                ?? (this.proactiveAgent?.getInsightsPath());
              if ((isDM || isGroupChat) && resultInsightsPath) {
                const insight = extractInsightTag(finalResult);
                if (insight) {
                  saveInsightWithEmbedding(resultInsightsPath, insight)
                    .catch((e) => this.logger.error('Failed to save insight', e));
                  finalResult = finalResult.replace(/\[INSIGHT:\s*.+?\]/g, '').trim();
                }
              }
              // Process file upload markers before sending
              finalResult = await this.processUploadMarkers(finalResult, channel, replyTs, uploadedFiles);
              const emittedText = streamedAssistantText || currentMessages.join('\n');
              if (finalResult && !isDuplicateFinalMessage(finalResult, emittedText)) {
                const formatted = this.formatMessage(finalResult, true);
                if (isDM) {
                  logBotMessage(this.botConfig?.id || 'unknown', channel, finalResult);
                }
                await say({
                  text: formatted,
                  thread_ts: replyTs,
                });
              }
            }
          }
        }
      }

      // Update status to completed (non-DM only)
      if (statusMessageTs && !isDM) {
        await this.app.client.chat.update({
          channel,
          ts: statusMessageTs,
          text: '✅ *Task completed*',
        });
      }

      // Record assistant response in history
      if (session && currentMessages.length > 0) {
        this.claudeHandler.addToHistory(session, 'assistant', currentMessages.join('\n'));
        // Write cogmem-format log for memory search
        const botId = this.botConfig?.id || 'unknown';
        logCogmemEntry(botId, text || '', currentMessages.join('\n'), channel);
        // Append to cross-channel user history
        appendCrossHistory(user, channel, botId, text || '', currentMessages.join('\n'));
      }

      // Update reaction to show completion (non-group-chat only)
      if (!isGroupChat) {
        await this.updateMessageReaction(sessionKey, '✅');
      }

      // Group chat: trigger second responder with first bot's response
      if (isGroupChat && this.orchestrator && this.botConfig) {
        const responseText = currentMessages.join('\n');
        this.logger.info('Triggering second responder', { firstBot: this.botConfig.id, responseLength: responseText.length });
        this.orchestrator.triggerSecondResponder(
          this.botConfig.id,
          channel,
          undefined,
          responseText,
          text || '',
        ).catch((e: any) => this.logger.error('Failed to trigger second responder', e));
      } else if (!isDM && !isGroupChat && this.orchestrator && this.botConfig) {
        // Regular channel: notify orchestrator for bot-to-bot conversation
        this.orchestrator.handleBotMessage(
          this.botConfig.id,
          channel,
          replyTs || ts,
          currentMessages.join('\n'),
          ts,
        ).catch((e: any) => this.logger.error('Failed to notify orchestrator', e));
      }

      // Engagement tracking for proactive context
      if (isProactiveContext && this.proactiveAgent && text) {
        const state = loadState(this.proactiveAgent.getStatePath());
        const lastEntry = state.history[state.history.length - 1];
        if (lastEntry) {
          const signal = detectTextSignal(text);
          if (signal === 'busy') {
            // Cooldown logic stays here (handleReaction doesn't do cooldown for busy)
            state.cooldown.backoffMinutes = Math.max(state.cooldown.backoffMinutes, 120);
            applyCooldown(state);
            saveState(state, this.proactiveAgent.getStatePath());
          } else if (signal === 'negative') {
            // handleReaction handles applyReaction + TS update + intrinsic boost
            await this.proactiveAgent.handleReaction('text_negative', lastEntry.slackTs, channel);
            // Cooldown also needed for negative text
            const stateAfter = loadState(this.proactiveAgent.getStatePath());
            stateAfter.cooldown.backoffMinutes = Math.max(stateAfter.cooldown.backoffMinutes, 240);
            applyCooldown(stateAfter);
            saveState(stateAfter, this.proactiveAgent.getStatePath());
          } else {
            const reactionKey = signal === 'positive' ? 'text_positive' : 'text_engaged';
            // handleReaction handles applyReaction + TS update + intrinsic boost
            await this.proactiveAgent.handleReaction(reactionKey, lastEntry.slackTs, channel);
          }

          // Async MLX analysis for deep rewards (non-blocking)
          if (text.length >= 3) {
            // Extract informationGap from the premise if available
            const informationGap = lastEntry.premise?.informationGap || null;

            analyzeReplyForMissions(text, lastEntry.preview || '', informationGap).then(async ({ signals: deepSignals, profileUpdate }) => {
              const stateForDeep = loadState(this.proactiveAgent!.getStatePath());
              const entry = stateForDeep.history.find(h => h.slackTs === lastEntry.slackTs);
              if (!entry) return;

              // Append deep signals to existing intrinsic reward
              if (!entry.intrinsicReward) {
                entry.intrinsicReward = { signals: [], immediateTotal: 0, deferredTotal: 0, compositeBoost: 0 };
              }

              const config = stateForDeep.intrinsicConfig || createDefaultIntrinsicConfig();

              // Process profile update detection — update profile and fire L-signal
              if (profileUpdate && profileUpdate.confidence !== 'low') {
                try {
                  const profilePath = join(dirname(this.proactiveAgent!.getStatePath()), 'user-profile.json');
                  if (existsSync(profilePath)) {
                    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));

                    // Navigate to the field and update it
                    const fieldParts = profileUpdate.field.split('.');
                    let target = profile.layers || profile;
                    for (let i = 0; i < fieldParts.length - 1; i++) {
                      if (!target[fieldParts[i]]) target[fieldParts[i]] = {};
                      target = target[fieldParts[i]];
                    }
                    const lastKey = fieldParts[fieldParts.length - 1];
                    target[lastKey] = profileUpdate.value;

                    // Add metadata about the update
                    if (!profile.collectionHistory) profile.collectionHistory = [];
                    profile.collectionHistory.push({
                      field: profileUpdate.field,
                      layer: profileUpdate.layer,
                      value: profileUpdate.value,
                      confidence: profileUpdate.confidence,
                      collectedAt: new Date().toISOString(),
                    });

                    profile.lastUpdated = new Date().toISOString();
                    writeFileSync(profilePath, JSON.stringify(profile, null, 2));

                    // Fire the corresponding L*-collect reward signal
                    const layerSignalId = `L${profileUpdate.layer}-collect`;
                    const collectionConfig: LayerCollectionConfig | undefined = profile.collectionConfig;
                    const layerRewardValue = computeLayerReward(layerSignalId, collectionConfig);
                    deepSignals.push({
                      id: layerSignalId,
                      mission: profileUpdate.layer,
                      value: layerRewardValue,
                      reason: `プロファイル更新: ${profileUpdate.field} = ${profileUpdate.value}`,
                    });

                    // Append to rewardLog for profile collection
                    entry.rewardLog = entry.rewardLog || [];
                    entry.rewardLog.push({
                      type: 'profile_collect' as const,
                      signal: layerSignalId,
                      value: layerRewardValue,
                      reason: `${profileUpdate.field} を収集 (confidence: ${profileUpdate.confidence})`,
                      timestamp: new Date().toISOString(),
                    });
                  }
                } catch {
                  // Silent failure — profile update is best-effort
                }
              }

              if (deepSignals.length === 0) return;

              const filtered = filterEnabledSignals(deepSignals, config);
              entry.intrinsicReward.signals.push(...filtered);
              entry.intrinsicReward.deferredTotal = filtered.reduce((sum, s) => sum + s.value, 0);

              // Append deep/reply signals to rewardLog
              entry.rewardLog = entry.rewardLog || [];
              for (const sig of filtered) {
                entry.rewardLog.push({
                  type: sig.id.startsWith('L') ? 'profile_collect' as const : 'reply_signal' as const,
                  signal: sig.id,
                  value: sig.value,
                  reason: sig.reason,
                  timestamp: new Date().toISOString(),
                });
              }

              // Recompute composite boost with all signals
              const allSignals = entry.intrinsicReward.signals;
              entry.intrinsicReward.compositeBoost = computeIntrinsicBoost(allSignals, config.lambda);

              saveState(stateForDeep, this.proactiveAgent!.getStatePath());

              // Update user profile with new information from R3/R5 signals
              const profileSignals = filtered.filter(s => s.id === 'R3' || s.id === 'R5');
              if (profileSignals.length > 0) {
                try {
                  const profilePath = join(dirname(this.proactiveAgent!.getStatePath()), 'user-profile.json');
                  if (existsSync(profilePath)) {
                    const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
                    for (const s of profileSignals) {
                      const ctx = profile.layers?.state?.recentContext || '';
                      if (!ctx.includes(s.reason)) {
                        const prefix = s.id === 'R5' ? '価値観: ' : '';
                        const addition = prefix + s.reason;
                        profile.layers.state.recentContext =
                          (ctx ? ctx + '; ' : '') + addition;
                      }
                    }
                    // Trim recentContext to latest 500 characters
                    if (profile.layers.state.recentContext.length > 500) {
                      const trimmed = profile.layers.state.recentContext.slice(-500);
                      const firstSemicolon = trimmed.indexOf('; ');
                      profile.layers.state.recentContext = firstSemicolon >= 0
                        ? trimmed.slice(firstSemicolon + 2)
                        : trimmed;
                    }
                    profile.lastUpdated = new Date().toISOString();
                    writeFileSync(profilePath, JSON.stringify(profile, null, 2));
                  }
                } catch {
                  // Silent failure — profile update is best-effort
                }
              }
            }).catch(() => {
              // Silent fallback — MLX unavailable
            });
          }
        }
      }

      this.logger.info('Completed processing message', {
        sessionKey,
        messageCount: currentMessages.length,
      });

      // Clean up temporary files
      if (processedFiles.length > 0) {
        await this.fileHandler.cleanupTempFiles(processedFiles);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        this.logger.error('Error handling message', error);
        
        // Update status to error (non-DM only)
        if (statusMessageTs && !isDM) {
          await this.app.client.chat.update({
            channel,
            ts: statusMessageTs,
            text: '❌ *Error occurred*',
          });
        }

        // Update reaction to show error
        await this.updateMessageReaction(sessionKey, '❌');

        // DM: don't show raw error, respond naturally
        const errorText = isDM
          ? 'ごめんね、うまく処理できなかったみたい。もう一度試してもらえるかな？'
          : `Error: ${error.message || 'Something went wrong'}`;
        await say({
          text: errorText,
          thread_ts: replyTs,
        });
      } else {
        this.logger.debug('Request was aborted', { sessionKey });
        
        // Update status to cancelled
        if (statusMessageTs) {
          await this.app.client.chat.update({
            channel,
            ts: statusMessageTs,
            text: '⏹️ *Cancelled*',
          });
        }

        // Update reaction to show cancellation
        await this.updateMessageReaction(sessionKey, '⏹️');
      }

      // Clean up temporary files in case of error too
      if (processedFiles.length > 0) {
        await this.fileHandler.cleanupTempFiles(processedFiles);
      }
    } finally {
      this.activeControllers.delete(sessionKey);
      
      // Clean up todo tracking if session ended
      if (session?.sessionId) {
        // Don't immediately clean up - keep todos visible for a while
        setTimeout(() => {
          this.todoManager.cleanupSession(session.sessionId!);
          this.todoMessages.delete(sessionKey);
          this.originalMessages.delete(sessionKey);
          this.currentReactions.delete(sessionKey);
        }, 5 * 60 * 1000); // 5 minutes
      }
    }
  }

  /**
   * Process [UPLOAD:/path/to/file] markers in text.
   * Uploads files to Slack and returns the cleaned text.
   */
  private async processUploadMarkers(
    text: string,
    channel: string,
    threadTs?: string,
    uploadedFiles?: Set<string>,
  ): Promise<string> {
    const { cleanText, filePaths } = FileHandler.extractUploadMarkers(text);
    if (filePaths.length === 0) return text;

    for (const filePath of filePaths) {
      if (uploadedFiles?.has(filePath)) {
        this.logger.debug('Skipping already uploaded file', { filePath });
        continue;
      }
      const fileId = await this.fileHandler.uploadFileToSlack(filePath, channel, threadTs);
      if (fileId) {
        this.logger.info('Uploaded file from marker', { filePath, fileId });
        uploadedFiles?.add(filePath);
      } else {
        this.logger.warn('Failed to upload file from marker', { filePath });
      }
    }

    return cleanText;
  }

  private extractTextContent(message: SDKMessage): string | null {
    if (message.type === 'assistant' && message.message.content) {
      const textParts = message.message.content
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text);
      return textParts.join('');
    }
    return null;
  }

  private formatToolUse(content: any[]): string {
    const parts: string[] = [];
    
    for (const part of content) {
      if (part.type === 'text') {
        parts.push(part.text);
      } else if (part.type === 'tool_use') {
        const toolName = part.name;
        const input = part.input;
        
        switch (toolName) {
          case 'Edit':
          case 'MultiEdit':
            parts.push(this.formatEditTool(toolName, input));
            break;
          case 'Write':
            parts.push(this.formatWriteTool(input));
            break;
          case 'Read':
            parts.push(this.formatReadTool(input));
            break;
          case 'Bash':
            parts.push(this.formatBashTool(input));
            break;
          case 'TodoWrite':
            // Handle TodoWrite separately - don't include in regular tool output
            return this.handleTodoWrite(input);
          default:
            parts.push(this.formatGenericTool(toolName, input));
        }
      }
    }
    
    return parts.join('\n\n');
  }

  private formatEditTool(toolName: string, input: any): string {
    const filePath = input.file_path;
    const edits = toolName === 'MultiEdit' ? input.edits : [{ old_string: input.old_string, new_string: input.new_string }];
    
    let result = `📝 *Editing \`${filePath}\`*\n`;
    
    for (const edit of edits) {
      result += '\n```diff\n';
      result += `- ${this.truncateString(edit.old_string, 200)}\n`;
      result += `+ ${this.truncateString(edit.new_string, 200)}\n`;
      result += '```';
    }
    
    return result;
  }

  private formatWriteTool(input: any): string {
    const filePath = input.file_path;
    const preview = this.truncateString(input.content, 300);
    
    return `📄 *Creating \`${filePath}\`*\n\`\`\`\n${preview}\n\`\`\``;
  }

  private formatReadTool(input: any): string {
    return `👁️ *Reading \`${input.file_path}\`*`;
  }

  private formatBashTool(input: any): string {
    return `🖥️ *Running command:*\n\`\`\`bash\n${input.command}\n\`\`\``;
  }

  private formatGenericTool(toolName: string, input: any): string {
    return `🔧 *Using ${toolName}*`;
  }

  private truncateString(str: string, maxLength: number): string {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
  }

  private handleTodoWrite(input: any): string {
    // TodoWrite tool doesn't produce visible output - handled separately
    return '';
  }

  private async handleTodoUpdate(
    input: any, 
    sessionKey: string, 
    sessionId: string | undefined, 
    channel: string, 
    threadTs: string, 
    say: any
  ): Promise<void> {
    if (!sessionId || !input.todos) {
      return;
    }

    const newTodos: Todo[] = input.todos;
    const oldTodos = this.todoManager.getTodos(sessionId);
    
    // Check if there's a significant change
    if (this.todoManager.hasSignificantChange(oldTodos, newTodos)) {
      // Update the todo manager
      this.todoManager.updateTodos(sessionId, newTodos);
      
      // Format the todo list
      const todoList = this.todoManager.formatTodoList(newTodos);
      
      // Check if we already have a todo message for this session
      const existingTodoMessageTs = this.todoMessages.get(sessionKey);
      
      if (existingTodoMessageTs) {
        // Update existing todo message
        try {
          await this.app.client.chat.update({
            channel,
            ts: existingTodoMessageTs,
            text: todoList,
          });
          this.logger.debug('Updated existing todo message', { sessionKey, messageTs: existingTodoMessageTs });
        } catch (error) {
          this.logger.warn('Failed to update todo message, creating new one', error);
          // If update fails, create a new message
          await this.createNewTodoMessage(todoList, channel, threadTs, sessionKey, say);
        }
      } else {
        // Create new todo message
        await this.createNewTodoMessage(todoList, channel, threadTs, sessionKey, say);
      }

      // Send status change notification if there are meaningful changes
      const statusChange = this.todoManager.getStatusChange(oldTodos, newTodos);
      if (statusChange) {
        await say({
          text: `🔄 *Task Update:*\n${statusChange}`,
          thread_ts: threadTs,
        });
      }

      // Update reaction based on overall progress
      await this.updateTaskProgressReaction(sessionKey, newTodos);
    }
  }

  private async createNewTodoMessage(
    todoList: string, 
    channel: string, 
    threadTs: string, 
    sessionKey: string, 
    say: any
  ): Promise<void> {
    const result = await say({
      text: todoList,
      thread_ts: threadTs,
    });
    
    if (result?.ts) {
      this.todoMessages.set(sessionKey, result.ts);
      this.logger.debug('Created new todo message', { sessionKey, messageTs: result.ts });
    }
  }

  private static readonly EMOJI_TO_SLACK: Record<string, string> = {
    '👀': 'eyes',
    '⚙️': 'gear',
    '✅': 'white_check_mark',
    '❌': 'x',
    '⏹️': 'stop_button',
    '🔄': 'arrows_counterclockwise',
  };

  private toSlackEmojiName(emoji: string): string {
    return SlackHandler.EMOJI_TO_SLACK[emoji] || emoji;
  }

  private async updateMessageReaction(sessionKey: string, emoji: string): Promise<void> {
    const originalMessage = this.originalMessages.get(sessionKey);
    if (!originalMessage) {
      return;
    }

    const slackName = this.toSlackEmojiName(emoji);

    // Check if we're already showing this emoji
    const currentEmoji = this.currentReactions.get(sessionKey);
    if (currentEmoji === slackName) {
      this.logger.debug('Reaction already set, skipping', { sessionKey, emoji: slackName });
      return;
    }

    try {
      // Remove the current reaction if it exists
      if (currentEmoji) {
        try {
          await this.app.client.reactions.remove({
            channel: originalMessage.channel,
            timestamp: originalMessage.ts,
            name: currentEmoji,
          });
          this.logger.debug('Removed previous reaction', { sessionKey, emoji: currentEmoji });
        } catch (error) {
          this.logger.debug('Failed to remove previous reaction (might not exist)', { 
            sessionKey, 
            emoji: currentEmoji,
            error: (error as any).message 
          });
        }
      }

      // Add the new reaction
      await this.app.client.reactions.add({
        channel: originalMessage.channel,
        timestamp: originalMessage.ts,
        name: slackName,
      });

      // Track the current reaction
      this.currentReactions.set(sessionKey, slackName);

      this.logger.debug('Updated message reaction', {
        sessionKey,
        emoji: slackName,
        previousEmoji: currentEmoji,
        channel: originalMessage.channel, 
        ts: originalMessage.ts 
      });
    } catch (error) {
      this.logger.warn('Failed to update message reaction', error);
    }
  }

  private async updateTaskProgressReaction(sessionKey: string, todos: Todo[]): Promise<void> {
    if (todos.length === 0) {
      return;
    }

    const completed = todos.filter(t => t.status === 'completed').length;
    const inProgress = todos.filter(t => t.status === 'in_progress').length;
    const total = todos.length;

    let emoji: string;
    if (completed === total) {
      emoji = '✅'; // All tasks completed
    } else if (inProgress > 0) {
      emoji = '🔄'; // Tasks in progress
    } else {
      emoji = '📋'; // Tasks pending
    }

    await this.updateMessageReaction(sessionKey, emoji);
  }

  /**
   * Parse a debate request from user message.
   * Detects keywords like 議論して, ディスカッションして, 意見交換して
   * and extracts theme and optional turn count.
   */
  private parseDebateRequest(text: string): { theme: string; turns: number } | null {
    // Keywords that indicate a debate request
    const debateKeywords = ['議論して', 'ディスカッションして', '意見交換して', 'ディスカッションを', '議論を', '意見交換を'];
    const hasKeyword = debateKeywords.some(kw => text.includes(kw));
    if (!hasKeyword) return null;

    // Extract turn count: "20ターン", "20回", "20turn"
    const turnMatch = text.match(/(\d+)\s*(?:ターン|回|turn)/i);
    const turns = turnMatch ? parseInt(turnMatch[1], 10) : 20;

    // Extract theme: remove the keyword, turn count, and bot names to get the theme
    let theme = text;
    for (const kw of debateKeywords) {
      theme = theme.replace(kw, '');
    }
    // Remove turn count pattern
    theme = theme.replace(/\d+\s*(?:ターン|回|turn)/i, '');
    // Remove bot name references
    if (this.botRegistry) {
      theme = theme.replace(this.botRegistry.getBotNamePattern(), '');
    } else {
      theme = theme.replace(/(?:Mei|Eve|メイ|イヴ|mei|eve)(?:\s*(?:と|and|,|、)\s*(?:Mei|Eve|メイ|イヴ|mei|eve))?/gi, '');
    }
    // Remove common instruction words
    theme = theme.replace(/(?:実施して|してください|やって|お願い|頼む)/g, '');
    // Remove trailing/leading particles and punctuation
    theme = theme.replace(/^[\s、。.,!?！？\-—:：]+|[\s、。.,!?！？\-—:：]+$/g, '');
    // Collapse whitespace
    theme = theme.replace(/\s+/g, ' ').trim();

    if (!theme) {
      theme = '自由討論';
    }

    return { theme, turns: Math.max(2, Math.min(turns, 50)) };
  }

  private isMcpInfoCommand(text: string): boolean {
    return /^(mcp|servers?)(\s+(info|list|status))?(\?)?$/i.test(text.trim());
  }

  private isMcpReloadCommand(text: string): boolean {
    return /^(mcp|servers?)\s+(reload|refresh)$/i.test(text.trim());
  }

  private async getBotUserId(): Promise<string> {
    if (!this.botUserId) {
      try {
        const response = await this.app.client.auth.test();
        this.botUserId = response.user_id as string;
      } catch (error) {
        this.logger.error('Failed to get bot user ID', error);
        this.botUserId = '';
      }
    }
    return this.botUserId;
  }

  private async handleChannelJoin(channelId: string, say: any): Promise<void> {
    try {
      // Get channel info
      const channelInfo = await this.app.client.conversations.info({
        channel: channelId,
      });

      const channelName = (channelInfo.channel as any)?.name || 'this channel';
      
      let welcomeMessage = `👋 Hi! I'm Claude Code, your AI coding assistant.\n\n`;
      welcomeMessage += `To get started, I need to know the default working directory for #${channelName}.\n\n`;
      
      if (config.baseDirectory) {
        welcomeMessage += `You can use:\n`;
        welcomeMessage += `• \`cwd project-name\` (relative to base directory: \`${config.baseDirectory}\`)\n`;
        welcomeMessage += `• \`cwd /absolute/path/to/project\` (absolute path)\n\n`;
      } else {
        welcomeMessage += `Please set it using:\n`;
        welcomeMessage += `• \`cwd /path/to/project\` or \`set directory /path/to/project\`\n\n`;
      }
      
      welcomeMessage += `This will be the default working directory for this channel. `;
      welcomeMessage += `You can always override it for specific threads by mentioning me with a different \`cwd\` command.\n\n`;
      welcomeMessage += `Once set, you can ask me to help with code reviews, file analysis, debugging, and more!`;

      await say({
        text: welcomeMessage,
      });

      this.logger.info('Sent welcome message to channel', { channelId, channelName });
    } catch (error) {
      this.logger.error('Failed to handle channel join', error);
    }
  }

  private formatMessage(text: string, isFinal: boolean): string {
    // Convert markdown code blocks to Slack format
    let formatted = text
      .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
        return '```' + code + '```';
      })
      .replace(/`([^`]+)`/g, '`$1`')
      .replace(/\*\*([^*]+)\*\*/g, '*$1*')
      .replace(/__([^_]+)__/g, '_$1_');

    return formatted;
  }

  setupEventHandlers() {
    // Handle direct messages (including group DMs / mpim)
    this.app.message(async ({ message, say }) => {
      if (message.subtype === undefined && 'user' in message) {
        const msg = message as any;
        const msgUser = msg.user;
        // Skip own messages (bot's own user ID)
        const ownUserId = this.botConfig?.slack?.botUserId || this.botUserId || await this.getBotUserId();
        if (ownUserId && msgUser === ownUserId) {
          return;
        }
        // Skip other known bots
        if (this.orchestrator?.isBotUser(msgUser)) {
          return;
        }
        // Skip bot messages — but allow user messages sent via Slack apps
        // (xoxp tokens add bot_id/bot_profile to human user messages)
        if ((msg.bot_id || msg.bot_profile) && !msgUser) {
          return;
        }
        // Throttle: per bot instance
        const now = Date.now();
        if (now - this.lastMessageTime < SlackHandler.MESSAGE_THROTTLE_MS) {
          this.logger.debug('Throttled message', { user: msgUser, botId: this.botConfig?.id });
          return;
        }
        this.lastMessageTime = now;

        // Group chat coordination: let orchestrator decide turn order
        const botConvChannel = process.env.BOT_CONVERSATION_CHANNEL;
        if (botConvChannel && msg.channel === botConvChannel && this.orchestrator && this.botConfig) {
          const role = this.orchestrator.assignRole(this.botConfig.id, msg.ts);
          if (role === 'second') {
            // Second bot waits for first bot's response, then orchestrator triggers us
            this.logger.info('Assigned as second responder, waiting for first bot', { botId: this.botConfig.id });
            return;
          }
          this.logger.info('Assigned as first responder', { botId: this.botConfig.id });
        }

        this.logger.info('Handling message event', { user: msgUser, channel: msg.channel, botId: this.botConfig?.id });
        await this.handleMessage(message as MessageEvent, say);
      }
    });

    // Handle app mentions
    this.app.event('app_mention', async ({ event, say }) => {
      const now = Date.now();
      if (now - this.lastMessageTime < SlackHandler.MESSAGE_THROTTLE_MS) {
        this.logger.debug('Throttled app_mention (20s cooldown)');
        return;
      }
      this.lastMessageTime = now;
      this.logger.info('Handling app mention event');
      const text = event.text.replace(/<@[^>]+>/g, '').trim();
      await this.handleMessage({
        ...event,
        text,
      } as MessageEvent, say);
    });

    // Handle file uploads in threads
    this.app.event('message', async ({ event, say }) => {
      if (event.subtype === 'file_share' && 'user' in event && event.files) {
        const now = Date.now();
        if (now - this.lastMessageTime < SlackHandler.MESSAGE_THROTTLE_MS) {
          return;
        }
        this.lastMessageTime = now;
        this.logger.info('Handling file upload event');
        await this.handleMessage(event as MessageEvent, say);
      }
    });

    // Handle bot being added to channels
    this.app.event('member_joined_channel', async ({ event, say }) => {
      // Check if the bot was added to the channel
      if (event.user === await this.getBotUserId()) {
        this.logger.info('Bot added to channel', { channel: event.channel });
        await this.handleChannelJoin(event.channel, say);
      }
    });

    // Handle permission approval button clicks
    this.app.action('approve_tool', async ({ ack, body, respond }) => {
      await ack();
      const approvalId = (body as any).actions[0].value;
      this.logger.info('Tool approval granted', { approvalId });
      
      permissionServer.resolveApproval(approvalId, true);
      
      await respond({
        response_type: 'ephemeral',
        text: '✅ Tool execution approved'
      });
    });

    // Handle permission denial button clicks
    this.app.action('deny_tool', async ({ ack, body, respond }) => {
      await ack();
      const approvalId = (body as any).actions[0].value;
      this.logger.info('Tool approval denied', { approvalId });
      
      permissionServer.resolveApproval(approvalId, false);
      
      await respond({
        response_type: 'ephemeral',
        text: '❌ Tool execution denied'
      });
    });

    // Handle reactions for proactive agent learning + stamp tracking
    this.app.event('reaction_added', async ({ event }) => {
      if (event.item.type === 'message') {
        // Proactive agent learning
        if (this.proactiveAgent) {
          await this.proactiveAgent.handleReaction(
            event.reaction,
            event.item.ts,
            event.item.channel,
          );
        }
        // Stamp tracking: record reactions from Akira on bot messages
        if (this.orchestrator && this.botConfig && event.user !== this.botConfig.slack.botUserId) {
          // Only count reactions from non-bot users (i.e., Akira)
          if (!this.orchestrator.isBotUser(event.user)) {
            this.orchestrator.recordStamp(
              this.botConfig.id,
              event.reaction,
              event.item.ts,
              event.item.channel,
            );
          }
        }
      }
    });

    // Cleanup inactive sessions periodically
    setInterval(() => {
      this.logger.debug('Running session cleanup');
      this.claudeHandler.cleanupInactiveSessions();
    }, 5 * 60 * 1000); // Every 5 minutes
  }
}
