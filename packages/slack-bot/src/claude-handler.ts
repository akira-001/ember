import { ConversationSession } from './types';
import { Logger } from './logger';
import { McpManager, McpServerConfig } from './mcp-manager';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { queryWithFallback, type SDKMessageCompat } from './openai-fallback';

export class ClaudeHandler {
  private sessions: Map<string, ConversationSession> = new Map();
  private logger = new Logger('ClaudeHandler');
  private mcpManager: McpManager;
  private sessionFilePath: string;

  constructor(mcpManager: McpManager, botId?: string) {
    this.mcpManager = mcpManager;
    this.sessionFilePath = join(process.cwd(), 'data', `sessions-${botId || 'default'}.json`);
    this.loadSessions();
  }

  private loadSessions(): void {
    try {
      if (existsSync(this.sessionFilePath)) {
        const data = JSON.parse(readFileSync(this.sessionFilePath, 'utf-8'));
        for (const [key, value] of Object.entries(data)) {
          const s = value as any;
          this.sessions.set(key, {
            ...s,
            lastActivity: new Date(s.lastActivity),
            isActive: true,
            chatHistory: s.chatHistory || [],
          });
        }
        this.logger.info('Loaded sessions from disk', { count: this.sessions.size });
      }
    } catch (e) {
      this.logger.warn('Failed to load sessions from disk', e);
    }
  }

  private saveSessions(): void {
    try {
      const data: Record<string, any> = {};
      for (const [key, session] of this.sessions.entries()) {
        data[key] = {
          userId: session.userId,
          channelId: session.channelId,
          threadTs: session.threadTs,
          sessionId: session.sessionId,
          lastActivity: session.lastActivity.toISOString(),
          chatHistory: session.chatHistory || [],
        };
      }
      writeFileSync(this.sessionFilePath, JSON.stringify(data, null, 2));
    } catch (e) {
      this.logger.warn('Failed to save sessions to disk', e);
    }
  }

  getSessionKey(userId: string, channelId: string, threadTs?: string): string {
    return `${userId}-${channelId}-${threadTs || 'direct'}`;
  }

  getSession(userId: string, channelId: string, threadTs?: string): ConversationSession | undefined {
    return this.sessions.get(this.getSessionKey(userId, channelId, threadTs));
  }

  createSession(userId: string, channelId: string, threadTs?: string): ConversationSession {
    const session: ConversationSession = {
      userId,
      channelId,
      threadTs,
      isActive: true,
      lastActivity: new Date(),
      chatHistory: [],
    };
    this.sessions.set(this.getSessionKey(userId, channelId, threadTs), session);
    return session;
  }

  /**
   * Add a message to session history and build a prompt with context.
   * Keeps last 20 turns to avoid token overflow.
   */
  addToHistory(session: ConversationSession, role: 'user' | 'assistant', content: string): void {
    if (!session.chatHistory) session.chatHistory = [];
    session.chatHistory.push({ role, content, timestamp: new Date().toISOString() });
    // Keep last 50 messages
    if (session.chatHistory.length > 50) {
      session.chatHistory = session.chatHistory.slice(-50);
    }
    session.lastActivity = new Date();
    this.saveSessions();
  }

  buildPromptWithHistory(session: ConversationSession, newMessage: string): string {
    if (!session.chatHistory || session.chatHistory.length === 0) {
      return newMessage;
    }
    const history = session.chatHistory.map(m =>
      `${m.role === 'user' ? 'Akira' : 'あなた'}: ${m.content}`
    ).join('\n\n');
    return `## これまでの会話\n${history}\n\n## 今のメッセージ\nAkira: ${newMessage}`;
  }

  async *streamQuery(
    prompt: string,
    session?: ConversationSession,
    abortController?: AbortController,
    workingDirectory?: string,
    slackContext?: { channel: string; threadTs?: string; user: string },
    appendSystemPrompt?: string,
    model?: string,
  ): AsyncGenerator<SDKMessageCompat, void, unknown> {
    const options: any = {
      outputFormat: 'stream-json',
      permissionMode: slackContext ? 'default' : 'bypassPermissions',
    };

    if (appendSystemPrompt) {
      options.appendSystemPrompt = appendSystemPrompt;
    }
    if (model) {
      options.model = model;
    }

    // Add permission prompt tool if we have Slack context
    if (slackContext) {
      options.permissionPromptToolName = 'mcp__permission-prompt__permission_prompt';
      this.logger.debug('Added permission prompt tool for Slack integration', slackContext);
    }

    if (workingDirectory) {
      options.cwd = workingDirectory;
    }

    // Add MCP server configuration if available
    const mcpServers = this.mcpManager.getServerConfiguration();
    
    // Add permission prompt server if we have Slack context
    if (slackContext) {
      const permissionServer = {
        'permission-prompt': {
          command: 'npx',
          args: ['tsx', join(__dirname, 'permission-mcp-server.ts')],
          env: {
            SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
            SLACK_CONTEXT: JSON.stringify(slackContext)
          }
        }
      };
      
      if (mcpServers) {
        options.mcpServers = { ...mcpServers, ...permissionServer };
      } else {
        options.mcpServers = permissionServer;
      }
    } else if (mcpServers && Object.keys(mcpServers).length > 0) {
      options.mcpServers = mcpServers;
    }
    
    if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
      // Allow all MCP tools by default, plus permission prompt tool
      const defaultMcpTools = this.mcpManager.getDefaultAllowedTools();
      if (slackContext) {
        defaultMcpTools.push('mcp__permission-prompt');
      }
      // Always allow built-in tools so they don't trigger the permission prompt
      const builtinTools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'LS', 'TodoRead', 'TodoWrite', 'WebSearch', 'WebFetch', 'Task'];
      options.allowedTools = [...builtinTools, ...defaultMcpTools];
      
      this.logger.debug('Added MCP configuration to options', {
        serverCount: Object.keys(options.mcpServers).length,
        servers: Object.keys(options.mcpServers),
        allowedTools: defaultMcpTools,
        hasSlackContext: !!slackContext,
      });
    }

    // Session resume disabled — using self-managed chat history instead
    // SDK v1.0.128 resume causes "exit code 1" on second query

    this.logger.debug('Claude query options', options);

    try {
      options.abortController = abortController || new AbortController();
      for await (const message of queryWithFallback({
        prompt,
        options,
      })) {
        if (message.type === 'system' && message.subtype === 'init') {
          if (session) {
            session.sessionId = message.session_id;
            this.saveSessions();
            this.logger.info('Session initialized', { 
              sessionId: message.session_id,
              model: (message as any).model,
              tools: (message as any).tools?.length || 0,
            });
          }
        }
        yield message;
      }
    } catch (error) {
      this.logger.error('Error in Claude query', error);
      throw error;
    }
  }

  cleanupInactiveSessions(maxAge: number = 30 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastActivity.getTime() > maxAge) {
        this.sessions.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.info(`Cleaned up ${cleaned} inactive sessions`);
    }
  }
}
