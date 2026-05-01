import * as cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { execFile } from 'child_process';
import { queryWithFallback } from './openai-fallback';
import { Logger } from './logger';
import { getTimezone, getDateTimeInTz } from './timezone';
import { McpManager } from './mcp-manager';
import type { App } from '@slack/bolt';
import type { IProactiveAgent } from './proactive-agent-interface';
import type { BotConfig } from './bot-config';
import { CronAdapter } from './event-sources/cron-adapter';
import {
  getRecentSends,
  isSharedTopicSimilar,
  normalizeUrlForDedup,
  recordSharedSend,
} from './shared-proactive-history';
import { buildThemeTrail, classifyProactiveTheme } from './proactive-themes';

const URL_REGEX = /https?:\/\/[^\s<>"']+/;

function extractPrimaryUrl(text: string): string | undefined {
  const match = text.match(URL_REGEX);
  if (!match) return undefined;
  return match[0].replace(/[>)、。,.]+$/, '');
}

function extractTopic(text: string): string {
  const stripped = text.replace(/https?:\/\/\S+/g, ' ').replace(/<@[A-Z0-9]+(\|[^>]+)?>/g, ' ');
  const bold = [...stripped.matchAll(/\*([^*\n]{3,80})\*/g)].map((m) => m[1].trim()).filter(Boolean);
  if (bold.length > 0) return bold.join(' ').substring(0, 120);
  const firstLine = stripped.split(/\n/).map((l) => l.trim()).find((l) => l.length >= 6);
  return (firstLine || stripped.trim()).substring(0, 120);
}

interface CronJob {
  name: string;
  cron: string;
  tz: string;
  message: string;
  command?: string;
  slackTarget: string;
  timeoutSeconds: number;
  enabled: boolean;
  silentMode?: boolean;  // true = run job but don't send output to Slack
  botId?: string;
  disabledIfFileExists?: string;  // skip execution if this sentinel path exists
  disabledIfApiSays?: {
    url: string;
    expectedKey: string;
    expectedValue?: any;  // undefined = truthy check, defined = strict equality check
    timeoutMs?: number;   // default 3000
  };
}

interface CronJobsConfig {
  jobs: CronJob[];
}

export class Scheduler {
  private logger = new Logger('Scheduler');
  private tasks: Map<string, ScheduledTask> = new Map();
  private app: App;
  private mcpManager: McpManager;
  private proactiveAgents: Map<string, IProactiveAgent> = new Map();
  private jobs: CronJob[] = [];
  private bots: Map<string, App>;
  private botConfigs: Map<string, BotConfig>;
  private cronAdapter: CronAdapter | null = null;
  private static readonly LOCK_FILE = join(process.cwd(), 'data', '.scheduler.lock');
  private static readonly SHELL_CANDIDATES = [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ].filter((candidate): candidate is string => Boolean(candidate));

  constructor(app: App, mcpManager: McpManager, proactiveAgents?: Map<string, IProactiveAgent> | IProactiveAgent, bots?: Map<string, App>, botConfigs?: Map<string, BotConfig>) {
    this.app = app;
    this.mcpManager = mcpManager;
    // Support both Map (new) and single agent (backward compat)
    if (proactiveAgents instanceof Map) {
      this.proactiveAgents = proactiveAgents;
    } else if (proactiveAgents) {
      // Legacy: single agent, use first bot config key or 'default'
      const firstBotId = botConfigs ? Array.from(botConfigs.keys())[0] : 'default';
      this.proactiveAgents.set(firstBotId, proactiveAgents);
    }
    this.bots = bots || new Map();
    this.botConfigs = botConfigs || new Map();
  }

  setCronAdapter(adapter: CronAdapter): void {
    this.cronAdapter = adapter;
  }

  loadJobs(): number {
    const configPath = join(process.cwd(), 'cron-jobs.json');
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const config: CronJobsConfig = JSON.parse(raw);
      this.jobs = config.jobs.filter(j => j.enabled);
      this.logger.info(`Loaded ${this.jobs.length} enabled jobs (${config.jobs.length} total)`);
      return this.jobs.length;
    } catch (error) {
      this.logger.error('Failed to load cron-jobs.json', error);
      return 0;
    }
  }

  start() {
    // Acquire exclusive lock to prevent duplicate schedulers
    if (!this.acquireLock()) {
      this.logger.warn('Another scheduler is already running. Skipping cron registration.');
      return;
    }

    for (const job of this.jobs) {
      if (!cron.validate(job.cron)) {
        this.logger.error(`Invalid cron expression for ${job.name}: ${job.cron}`);
        continue;
      }

      const task = cron.schedule(job.cron, () => this.executeJob(job), {
        timezone: job.tz || getTimezone(),
      });

      this.tasks.set(job.name, task);
      this.logger.info(`Scheduled: ${job.name} [${job.cron}] (${job.tz})`);
    }
  }

  stop() {
    for (const [name, task] of this.tasks) {
      task.stop();
      this.logger.info(`Stopped: ${name}`);
    }
    this.tasks.clear();
    this.releaseLock();
  }

  private acquireLock(): boolean {
    const lockFile = Scheduler.LOCK_FILE;
    mkdirSync(join(process.cwd(), 'data'), { recursive: true });

    if (existsSync(lockFile)) {
      try {
        const content = readFileSync(lockFile, 'utf-8').trim();
        const lockedPid = parseInt(content, 10);
        // Check if the locking process is still alive
        if (lockedPid && this.isProcessAlive(lockedPid)) {
          this.logger.warn(`Scheduler lock held by PID ${lockedPid} (alive)`);
          return false;
        }
        // Stale lock — previous process died without cleanup
        this.logger.info(`Removing stale lock from dead PID ${lockedPid}`);
      } catch {
        // Corrupted lock file, remove it
      }
    }

    writeFileSync(lockFile, String(process.pid));
    this.logger.info(`Acquired scheduler lock (PID ${process.pid})`);

    // Clean up lock on exit
    const cleanup = () => this.releaseLock();
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(0); });
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });

    return true;
  }

  private releaseLock() {
    try {
      const lockFile = Scheduler.LOCK_FILE;
      if (existsSync(lockFile)) {
        const content = readFileSync(lockFile, 'utf-8').trim();
        if (parseInt(content, 10) === process.pid) {
          unlinkSync(lockFile);
          this.logger.info('Released scheduler lock');
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private getShellCandidates(): string[] {
    const shells = [
      '/bin/zsh',
      '/bin/bash',
      '/bin/sh',
      process.env.CRON_SHELL,
      process.env.SHELL,
    ].filter((shell): shell is string => !!shell && shell.length > 0);

    return shells.filter((shell, index) => shells.indexOf(shell) === index && existsSync(shell));
  }

  private runCommandWithShellFallback(
    command: string,
    options: { timeout: number; cwd: string },
    onResult: (error: any, stdout: string, stderr: string) => void
  ) {
    const direct = this.tryParseDirectCommand(command, options.cwd);
    if (direct) {
      execFile(direct.file, direct.args, { ...options, cwd: direct.cwd || options.cwd }, (error, stdout, stderr) => {
        if (!error) {
          onResult(error, stdout, stderr);
          return;
        }
        if ((error as any).code !== 'ENOENT') {
          onResult(error, stdout, stderr);
          return;
        }
        this.logger.warn('Direct cron command failed, falling back to shell execution', {
          command,
          file: direct.file,
          cwd: direct.cwd || options.cwd,
          error: error.message,
        });
        this.runCommandViaShell(command, options, onResult);
      });
      return;
    }

    this.runCommandViaShell(command, options, onResult);
  }

  private runCommandViaShell(
    command: string,
    options: { timeout: number; cwd: string },
    onResult: (error: any, stdout: string, stderr: string) => void
  ) {
    const shells = this.getShellCandidates();

    if (shells.length === 0) {
      onResult(new Error('No available shell found for cron command execution'), '', '');
      return;
    }

    const attempt = (index: number) => {
      const shell = shells[index];
      execFile(shell, ['-lc', command], { ...options }, (error, stdout, stderr) => {
        if (error && (error as any).code === 'ENOENT' && index < shells.length - 1) {
          this.logger.warn('Cron shell failed, retrying with fallback shell', {
            command,
            shell,
            fallbackShell: shells[index + 1],
            error: error.message,
          });
          attempt(index + 1);
          return;
        }

        onResult(error, stdout, stderr);
      });
    };

    attempt(0);
  }

  private tryParseDirectCommand(command: string, defaultCwd: string): { cwd?: string; file: string; args: string[] } | null {
    const cdMatch = command.match(/^\s*cd\s+(.+?)\s*&&\s*(.+)\s*$/);
    if (cdMatch) {
      const cwd = cdMatch[1].trim();
      const rest = cdMatch[2].trim();
      const parts = rest.match(/(?:"[^"]*"|'[^']*'|\S+)/g);
      if (!parts || parts.length === 0) return null;
      const file = parts[0].replace(/^['"]|['"]$/g, '');
      const args = parts.slice(1).map((part) => part.replace(/^['"]|['"]$/g, ''));
      return {
        cwd,
        file: file.startsWith('/') || file.startsWith('.') ? resolve(cwd, file) : file,
        args,
      };
    }

    const parts = command.match(/(?:"[^"]*"|'[^']*'|\S+)/g);
    if (!parts || parts.length === 0) return null;
    if (parts.some((part) => /[|;&<>$`]/.test(part))) {
      return null;
    }

    const file = parts[0].replace(/^['"]|['"]$/g, '');
    const args = parts.slice(1).map((part) => part.replace(/^['"]|['"]$/g, ''));
    return {
      cwd: defaultCwd,
      file: file.startsWith('/') || file.startsWith('.') ? resolve(defaultCwd, file) : file,
      args,
    };
  }

  private async executeJob(job: CronJob) {
    if (job.disabledIfFileExists && existsSync(job.disabledIfFileExists)) {
      this.logger.info(`Skipped: ${job.name} (sentinel ${job.disabledIfFileExists} present)`);
      const now = new Date().toISOString();
      this.logHistory({
        jobName: job.name,
        startedAt: now,
        completedAt: now,
        durationMs: 0,
        status: 'skipped',
        botId: job.botId || 'unknown',
        error: null,
        outputPreview: `disabled by sentinel: ${job.disabledIfFileExists}`,
      });
      if (this.cronAdapter) {
        this.cronAdapter.notifyJobExecuted(job.name, job.botId || 'unknown', { status: 'skipped' });
      }
      return;
    }

    // disabledIfApiSays: HTTP API check (fail-open on error)
    if (job.disabledIfApiSays) {
      const { url, expectedKey, expectedValue, timeoutMs = 3000 } = job.disabledIfApiSays;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        const data = await res.json() as Record<string, unknown>;
        const actual = data[expectedKey];
        const shouldSkip = expectedValue === undefined ? !!actual : actual === expectedValue;
        if (shouldSkip) {
          const now = new Date().toISOString();
          this.logger.info(`Skipped: ${job.name} (API says ${expectedKey}=${actual})`);
          this.logHistory({
            jobName: job.name,
            startedAt: now,
            completedAt: now,
            durationMs: 0,
            status: 'skipped',
            botId: job.botId || 'unknown',
            error: null,
            outputPreview: `disabled by API: ${url} ${expectedKey}=${JSON.stringify(actual)}`,
          });
          if (this.cronAdapter) {
            this.cronAdapter.notifyJobExecuted(job.name, job.botId || 'unknown', { status: 'skipped' });
          }
          return;
        }
      } catch (e: any) {
        // fail-open: API 不通なら通常実行
        this.logger.warn(`disabledIfApiSays check failed for ${job.name} (fail-open, will run)`, { error: e?.message });
      }
    }

    // Proactive agent handles its own execution
    if (job.name.startsWith('proactive-checkin')) {
      const botId = job.botId || 'unknown';
      const agent = this.proactiveAgents.get(botId);
      if (!agent) {
        this.logger.warn(`No proactive agent for bot: ${botId}`);
        return;
      }
      this.logger.info(`Executing proactive checkin for ${botId}`);
      const startTime = Date.now();
      try {
        await agent.run();
        this.logHistory({
          jobName: job.name,
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          status: 'success',
          botId: job.botId || 'unknown',
          error: null,
          outputPreview: '',
        });
        if (this.cronAdapter) {
          this.cronAdapter.notifyJobExecuted(job.name, botId, { status: 'success' });
        }
      } catch (error: any) {
        this.logger.error('Proactive checkin failed', error);
        this.logHistory({
          jobName: job.name,
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          status: 'error',
          botId: job.botId || 'unknown',
          error: error?.message || 'Unknown error',
          outputPreview: '',
        });
      }
      return;
    }

    this.logger.info(`Executing job: ${job.name}`);
    const startTime = Date.now();
    const botId = job.botId || 'unknown';

    // Command-type jobs: run directly via child_process
    if (job.command) {
      return new Promise<void>((resolve) => {
        const timeoutMs = job.timeoutSeconds * 1000;
        this.runCommandWithShellFallback(
          job.command!,
          {
            timeout: timeoutMs,
            cwd: process.env.BASE_DIRECTORY || process.cwd(),
          },
          async (error, stdout, stderr) => {
          const duration = Date.now() - startTime;
          const output = stdout || stderr || '';

          if (error) {
            this.logger.error(`Job failed: ${job.name} (${Math.round(duration / 1000)}s)`, error);
            this.logHistory({
              jobName: job.name,
              startedAt: new Date(startTime).toISOString(),
              completedAt: new Date().toISOString(),
              durationMs: duration,
              status: 'error',
              botId,
              error: error.message || 'Unknown error',
              outputPreview: output.substring(0, 5000),
            });
            try {
              await this.sendToSlack(job, `[Cron Error] ${job.name}: ${error.message || 'Unknown error'}`, botId);
            } catch { /* ignore */ }
            resolve();
            return;
          }

          // Extract Slack payload from output (last JSON line with "text" field)
          let slackText = '';
          const lines = output.trim().split('\n');
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line.startsWith('{') && line.includes('"text"')) {
              try {
                JSON.parse(line);  // validate JSON
                slackText = line;  // pass full JSON to sendToSlack (preserves attachments/blocks)
                break;
              } catch { /* not valid JSON, try as plain text */ }
            }
          }
          if (!slackText) slackText = output.trim();

          if (slackText) {
            if (job.silentMode) {
              this.logger.info(`Job completed (silent): ${job.name} (${Math.round(duration / 1000)}s)`);
            } else {
              await this.sendToSlack(job, slackText, botId);
              this.logger.info(`Job completed: ${job.name} (${Math.round(duration / 1000)}s)`);
            }
          } else {
            this.logger.info(`Job completed with no output: ${job.name} (${Math.round(duration / 1000)}s)`);
          }

          this.logHistory({
            jobName: job.name,
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: duration,
            status: 'success',
            botId,
            error: null,
            outputPreview: (() => {
              for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i].trim();
                if (line.startsWith('{') && line.includes('"text"')) {
                  try {
                    const payload = JSON.parse(line);
                    const compact: any = { text: payload.text || '' };
                    if (payload.attachments?.length) {
                      compact.attachments = payload.attachments.slice(0, 2).map((a: any) => ({
                        title: a.title, text: a.text?.substring(0, 500), color: a.color
                      }));
                    }
                    return JSON.stringify(compact);
                  } catch { /* not valid JSON */ }
                }
              }
              return output.substring(0, 2000);
            })(),
          });
          if (this.cronAdapter) {
            this.cronAdapter.notifyJobExecuted(job.name, botId, { status: 'success' });
          }
          resolve();
          }
        );
      });
    }

    try {
      // Collect response text from Claude
      let responseText = '';
      const abortController = new AbortController();

      // Set timeout
      const timeout = setTimeout(() => {
        abortController.abort();
        const timeoutDuration = Date.now() - startTime;
        this.logger.warn(`Job timed out: ${job.name} (${job.timeoutSeconds}s)`);
        this.logHistory({
          jobName: job.name,
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: timeoutDuration,
          status: 'timeout',
          botId,
          error: `Timeout after ${job.timeoutSeconds}s`,
          outputPreview: '',
        });
      }, job.timeoutSeconds * 1000);
      const botCfg = this.botConfigs.get(botId);
      const basePrompt = botCfg?.personality.systemPrompt || '';
      const botName = botCfg?.name || botId;
      const model = botCfg?.personality.cronModel || 'claude-sonnet-4-6';

      const mcpServers = this.mcpManager.getServerConfiguration();
      const options: any = {
        outputFormat: 'stream-json',
        permissionMode: 'bypassPermissions',
        cwd: process.env.BASE_DIRECTORY || process.cwd(),
        appendSystemPrompt: basePrompt + `\n\n## 現在時刻\n${getDateTimeInTz(new Date(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' })} (${getTimezone()})` + `\n\n## 定期レポート配信\nこのタスクは定期ジョブとして実行されています。結果を伝える際は、${botName}が自ら調べてAkiraに報告する形で自然に伝えてください。冒頭に軽い一言（時間帯に合った挨拶や気遣い）を添えて、レポート内容を続けてください。`,
        model,
      };

      if (mcpServers && Object.keys(mcpServers).length > 0) {
        options.mcpServers = mcpServers;
        const allowedTools = this.mcpManager.getDefaultAllowedTools();
        if (allowedTools.length > 0) {
          options.allowedTools = allowedTools;
        }
      }

      try {
        options.abortController = abortController;
        for await (const message of queryWithFallback({
          prompt: job.message,
          options,
        })) {
          if (message.type === 'assistant' && (message as any).subtype === 'text') {
            responseText += (message as any).text || '';
          }
          // Also capture result messages
          if (message.type === 'result') {
            if (!responseText && (message as any).result) {
              responseText = (message as any).result;
            }
          }
        }
      } finally {
        clearTimeout(timeout);
      }

      const duration = Date.now() - startTime;

      if (responseText.trim()) {
        if (job.silentMode) {
          this.logger.info(`Job completed (silent): ${job.name} (${Math.round(duration / 1000)}s)`);
        } else {
          await this.sendToSlack(job, responseText.trim(), botId);
          this.logger.info(`Job completed: ${job.name} (${Math.round(duration / 1000)}s)`);
        }
      } else {
        this.logger.info(`Job completed with no output: ${job.name} (${Math.round(duration / 1000)}s)`);
      }
      this.logHistory({
        jobName: job.name,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: duration,
        status: 'success',
        botId,
        error: null,
        outputPreview: responseText ? responseText.trim().substring(0, 5000) : '',
      });
      if (this.cronAdapter) {
        this.cronAdapter.notifyJobExecuted(job.name, botId, { status: 'success' });
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.logger.error(`Job failed: ${job.name} (${Math.round(duration / 1000)}s)`, error);
      this.logHistory({
        jobName: job.name,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: duration,
        status: 'error',
        botId,
        error: error.message || 'Unknown error',
        outputPreview: '',
      });

      // Notify about failure
      try {
        await this.sendToSlack(job, `[Cron Error] ${job.name}: ${error.message || 'Unknown error'}`, botId);
      } catch {
        // Ignore notification errors
      }
    }
  }

  private async sendToSlack(job: CronJob, text: string, botId?: string): Promise<string | undefined> {
    const target = job.slackTarget;
    const appClient = (botId && this.bots.get(botId)) || this.app;

    try {
      // JSON 形式の場合は attachments/blocks として送信
      if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
        try {
          const payload = JSON.parse(text);
          const msgOptions: any = { channel: target };

          if (payload.text) msgOptions.text = payload.text;
          else msgOptions.text = `*[${job.name}]*`;

          if (payload.attachments) msgOptions.attachments = payload.attachments;
          if (payload.blocks) msgOptions.blocks = payload.blocks;

          const dedupText = payload.text || text;
          const dedupSkipReason = this.checkProactiveDedup(job, botId, target, dedupText);
          if (dedupSkipReason) {
            this.logger.info(`Job ${job.name}: dedup skip (${dedupSkipReason})`);
            return undefined;
          }

          const result = await appClient.client.chat.postMessage(msgOptions);
          this.logger.debug(`Sent rich message to Slack: ${target}`);
          this.recordProactiveSend(job, botId, target, dedupText);
          return result.ts;
        } catch {
          // JSON パース失敗時はプレーンテキストとして送信
        }
      }

      // NO_REPLY はスキップ（完全一致 / 末尾一致 / 行一致のいずれか）
      const trimmedForNoReply = text.trim();
      if (
        trimmedForNoReply === 'NO_REPLY' ||
        trimmedForNoReply.endsWith('NO_REPLY') ||
        trimmedForNoReply.split('\n').some(line => line.trim() === 'NO_REPLY')
      ) {
        this.logger.info(`Job ${job.name}: NO_REPLY, skipping send`);
        return undefined;
      }

      // プレーンテキスト送信
      const maxLen = 39000;
      const truncated = text.length > maxLen
        ? text.substring(0, maxLen) + '\n...(truncated)'
        : text;

      // DM ではジョブ名プレフィックスを付けない（Meiが自然に伝える）
      const isDM = target.startsWith('U');
      const finalText = isDM ? truncated : `*[${job.name}]*\n${truncated}`;

      const dedupSkipReason = this.checkProactiveDedup(job, botId, target, truncated);
      if (dedupSkipReason) {
        this.logger.info(`Job ${job.name}: dedup skip (${dedupSkipReason})`);
        return undefined;
      }

      const result = await appClient.client.chat.postMessage({
        channel: target,
        text: finalText,
      });
      this.logger.debug(`Sent result to Slack: ${target}`);
      this.recordProactiveSend(job, botId, target, truncated);
      return result.ts;
    } catch (error) {
      this.logger.error(`Failed to send to Slack: ${target}`, error);
      return undefined;
    }
  }

  /**
   * Returns a reason string if this message should be suppressed as a duplicate of
   * a recent proactive send, or null to allow it. Only DM proactive sends are
   * checked; channel posts, cron-error notifications and jobs without a botId
   * pass through unchanged.
   */
  private checkProactiveDedup(
    job: CronJob,
    botId: string | undefined,
    target: string,
    text: string,
  ): string | null {
    if (!botId) return null;
    if (!target.startsWith('U')) return null;
    if (text.startsWith('[Cron Error]')) return null;

    const url = extractPrimaryUrl(text);
    const topic = extractTopic(text);

    if (url) {
      const normalized = normalizeUrlForDedup(url);
      if (normalized) {
        const recent = getRecentSends(48);
        const urlDup = recent.find((e) => e.url && e.url === normalized);
        if (urlDup) {
          return `url match: ${normalized} (prev ${urlDup.botId} @ ${urlDup.sentAt})`;
        }
      }
    }

    if (topic && topic.length >= 6) {
      const recent = getRecentSends(12);
      const topicDup = recent.find((e) => e.topic && isSharedTopicSimilar(topic, e.topic));
      if (topicDup) {
        return `topic match: "${topic.substring(0, 40)}" (prev ${topicDup.botId} @ ${topicDup.sentAt})`;
      }
    }

    return null;
  }

  private recordProactiveSend(
    job: CronJob,
    botId: string | undefined,
    target: string,
    text: string,
  ): void {
    if (!botId) return;
    if (!target.startsWith('U')) return;
    if (text.startsWith('[Cron Error]')) return;

    try {
      const url = extractPrimaryUrl(text);
      const topic = extractTopic(text);
      const preview = text.substring(0, 150);
      const theme = classifyProactiveTheme({ text, topic, preview });
      const botName = this.botConfigs.get(botId)?.name || botId;
      recordSharedSend({
        botId,
        botName,
        category: 'cron',
        preview,
        topic,
        url,
        sourceType: 'scheduler',
        skill: job.name,
        themePath: buildThemeTrail(theme.path),
        themeKey: theme.key,
      });
    } catch (err) {
      this.logger.warn(`Failed to record proactive send for ${job.name}`, err);
    }
  }

  private logHistory(entry: {
    jobName: string;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    status: 'success' | 'error' | 'timeout' | 'skipped';
    botId: string;
    error: string | null;
    outputPreview?: string;
  }) {
    try {
      const historyPath = join(process.cwd(), 'data', 'cron-history.jsonl');
      mkdirSync(join(process.cwd(), 'data'), { recursive: true });
      appendFileSync(historyPath, JSON.stringify(entry) + '\n');
    } catch (e) {
      this.logger.error('Failed to write cron history', e);
    }
  }

  // For manual testing: run a job immediately by name
  async runNow(jobName: string) {
    const job = this.jobs.find(j => j.name === jobName);
    if (!job) {
      this.logger.error(`Job not found: ${jobName}`);
      return;
    }
    await this.executeJob(job);
  }

  listJobs(): { name: string; cron: string; tz: string; enabled: boolean }[] {
    return this.jobs.map(j => ({
      name: j.name,
      cron: j.cron,
      tz: j.tz,
      enabled: j.enabled,
    }));
  }
}
