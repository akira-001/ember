import { randomUUID } from 'crypto';
import type { App } from '@slack/bolt';
import { Logger } from './logger';
import { IProactiveAgent } from './proactive-agent-interface';
import {
  loadState,
  saveState,
  isInCooldown,
  applyReaction,
  pruneHistory,
  buildCronPrompt,
  resolveMessage,
  buildDecisionLogSnapshot,
  getActiveInsights,
  loadInsights,
  buildInsightsContext,
  buildSourceUrlsFromCandidates,
  buildCandidateId,
  extractUrlsFromText,
  findSelectedCandidate,
  attachRequiredMovieUrl,
  type SuggestionCategory,
} from './proactive-state';
import { buildSharedProactiveContext, recordSharedSend, getOtherBotMessages } from './shared-proactive-history';
import { buildThemeTrail, observeProactiveTheme } from './proactive-themes';
import { buildThemeInventorySnapshot, persistThemeInventorySnapshot, type ThemeInventorySnapshot } from './theme-inventory';
import { join } from 'path';
import { getDateTimeInTz, getTimezone } from './timezone';
import { queryWithFallback } from './openai-fallback';

type CollectDataFn = () => Promise<string>;
type InferenceFn = (prompt: string) => Promise<string>;

interface ProactiveAgentOptions {
  app: App;
  statePath?: string;
  insightsPath?: string;
  slackTarget?: string;
  systemPrompt?: string;    // bot's system prompt (from config)
  chatModel?: string;       // bot's chat model (from config)
  collectDataFn?: CollectDataFn;
  inferenceFn?: InferenceFn; // for testing only
  botId?: string;
  botName?: string;
}

const DEFAULT_STATE_PATH = join(process.cwd(), 'data', 'proactive-state.json');
const DEFAULT_INSIGHTS_PATH = join(process.cwd(), 'data', 'user-insights.json');
const DEFAULT_SLACK_TARGET = 'U3SFGQXNH';

export class ProactiveAgent implements IProactiveAgent {
  private app: App;
  private statePath: string;
  private insightsPath: string;
  private slackTarget: string;
  private logger = new Logger('ProactiveAgent');
  private collectDataFn: CollectDataFn;
  private inferenceFn: InferenceFn | null;
  private systemPrompt: string;
  private chatModel: string;
  private botId?: string;
  private botName?: string;

  constructor(options: ProactiveAgentOptions) {
    this.app = options.app;
    this.statePath = options.statePath || DEFAULT_STATE_PATH;
    this.insightsPath = options.insightsPath || DEFAULT_INSIGHTS_PATH;
    this.slackTarget = options.slackTarget || DEFAULT_SLACK_TARGET;
    this.systemPrompt = options.systemPrompt || '';
    this.chatModel = options.chatModel || process.env.PROACTIVE_MODEL_CHAT || 'claude-opus-4-6';
    this.collectDataFn = options.collectDataFn || this.defaultCollectData.bind(this);
    this.inferenceFn = options.inferenceFn || null;
    this.botId = options.botId;
    this.botName = options.botName;
  }

  getStatePath(): string {
    return this.statePath;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  getInsightsPath(): string {
    return this.insightsPath;
  }

  async run(): Promise<void> {
    const state = loadState(this.statePath);

    // Check cooldown
    if (isInCooldown(state)) {
      this.logger.info('In cooldown, skipping check');
      state.lastCheckAt = new Date().toISOString();
      saveState(state, this.statePath);
      return;
    }

    // Collect data
    let collectedData: string;
    try {
      collectedData = await this.collectDataFn();
    } catch (error) {
      this.logger.error('Data collection failed', error);
      collectedData = '{"errors": ["data collection failed"]}';
    }

    const themeInventory = buildThemeInventorySnapshot({
      history: state.history.map((entry) => ({
        sentAt: entry.sentAt,
        topic: entry.candidateTopic || entry.preview || '',
        preview: entry.preview,
        source: entry.candidateSource || entry.skill || 'proactive',
        category: entry.category,
        interestCategory: entry.interestCategory,
        reaction: entry.reaction,
        reactionDelta: entry.reactionDelta,
        themePath: entry.themePath,
        themeKey: entry.themeKey,
      })),
      sharedMessages: this.botId
        ? getOtherBotMessages(this.botId, 24 * 30).map((entry) => ({
            sentAt: entry.sentAt,
            topic: entry.topic || entry.preview,
            preview: entry.preview,
            source: entry.sourceType || entry.botId,
            category: entry.category,
            interestCategory: entry.interestCategory,
            themePath: entry.themePath,
            themeKey: entry.themeKey,
          }))
        : [],
    });
    state.themeInventory = themeInventory;
    persistThemeInventorySnapshot(themeInventory);

    // Build prompt and run inference
    const insights = getActiveInsights(this.insightsPath);
    const cronPrompt = this.botId
      ? buildCronPrompt(state, collectedData, insights, buildSharedProactiveContext(this.botId), 'メイ', this.botId)
      : buildCronPrompt(state, collectedData, insights);

    let response: string;
    try {
      response = await this.inference(cronPrompt);
    } catch (error) {
      this.logger.error('Inference failed', error);
      state.lastCheckAt = new Date().toISOString();
      saveState(state, this.statePath);
      return;
    }

    state.lastCheckAt = new Date().toISOString();

    // Resolve message via pure function
    const resolution = resolveMessage(response, state, this.botId);
    const decisionLog = resolution.decisionLog;
    state.lastDecisionLog = {
      ...buildDecisionLogSnapshot(decisionLog, {
        action: resolution.action,
        message: resolution.message,
        error: resolution.error,
        skill: this.botName || this.botId || 'none',
      }),
      scoredCandidates: (state.lastScoredCandidates || []).slice(0, 10).map((c) => ({
        topic: c.topic,
        source: c.source,
        category: c.category,
        scores: c.scores,
        finalScore: c.finalScore,
        explorationBonus: c.explorationBonus,
        selectionScore: c.selectionScore,
        reasoning: c.reasoning,
      })),
      weightsUsed: {},
      sampledRaw: {},
      contextBonus: {},
      priors: state.learningState?.priors || {},
    } as any;
    for (const warning of resolution.warnings) { this.logger.warn(warning); }
    if (resolution.action === 'skip') {
      if (resolution.error) this.logger.error(resolution.error, { response: response.substring(0, 200) });
      else this.logger.info('NO_REPLY', { response: response.substring(0, 200) });
      saveState(state, this.statePath);
      return;
    }
    let suggestion = resolution.message!;

    // Send to Slack
    try {
      const category = this.guessCategory(suggestion);
      const selectedCandidate = decisionLog?.candidates?.length && state.lastScoredCandidates
        ? findSelectedCandidate(decisionLog.candidates, state.lastScoredCandidates)
        : null;
      const fallbackUrl = extractUrlsFromText(suggestion)[0] || extractUrlsFromText(decisionLog?.message || '')[0];
      const candidateTopic = selectedCandidate?.topic || decisionLog?.candidates?.[0]?.topic;
      const candidateSource = selectedCandidate?.source || decisionLog?.candidates?.[0]?.source;
      const candidateUrl = selectedCandidate
        ? buildSourceUrlsFromCandidates([selectedCandidate])[0]?.url || (selectedCandidate?.metadata?.url as string | undefined)
        : fallbackUrl;
      const selectedSourceUrls = selectedCandidate
        ? buildSourceUrlsFromCandidates([selectedCandidate])
        : candidateUrl
          ? [{
              title: candidateTopic || suggestion.substring(0, 120),
              url: candidateUrl,
              source: candidateSource || 'message',
            }]
          : [];
      const movieUrlCheck = attachRequiredMovieUrl(
        suggestion,
        selectedSourceUrls,
        selectedCandidate || (candidateTopic
          ? {
              topic: candidateTopic,
              source: candidateSource || 'message',
              category: this.guessCategory(suggestion),
              metadata: { url: candidateUrl, mediaSource: candidateSource },
            } as any
          : undefined),
      );
      if (!movieUrlCheck.text) {
        this.logger.warn('Skipped movie suggestion without verified URL', {
          candidateTopic: candidateTopic || 'none',
          candidateSource: candidateSource || 'none',
        });
        saveState(state, this.statePath);
        return;
      }
      suggestion = movieUrlCheck.text;
      const candidateId = selectedCandidate
        ? buildCandidateId(selectedCandidate)
        : candidateUrl
          ? `url:${candidateUrl}`
          : undefined;
      const candidateMatchMode = selectedCandidate
        ? 'matched_scored_candidate'
        : candidateUrl
          ? 'message_url_fallback'
          : 'no_candidate_metadata';
      const theme = observeProactiveTheme({
        text: candidateTopic || suggestion,
        topic: candidateTopic || suggestion,
        preview: suggestion.substring(0, 150),
        category,
        source: candidateSource,
        sourceType: typeof selectedCandidate?.metadata?.mediaSource === 'string'
          ? selectedCandidate.metadata.mediaSource
          : undefined,
      });
      const themePath = buildThemeTrail(theme.path);
      const historyId = randomUUID();
      const sentAt = new Date().toISOString();

      // Reserve dedup slot BEFORE touching Slack so a crash mid-send can't
      // drop the record and let the next run resend.
      if (this.botId) {
        recordSharedSend({
          botId: this.botId,
          botName: this.botName || this.botId,
          category,
          preview: suggestion.substring(0, 150),
          url: candidateUrl,
          candidateId,
          themePath,
          themeKey: theme.key,
        });
      }

      state.history.push({
        id: historyId,
        category,
        sentAt,
        slackTs: '',
        slackChannel: this.slackTarget,
        reaction: null,
        reactionDelta: 0,
        preview: suggestion.substring(0, 120),
        fullText: suggestion,
        sourceUrls: selectedSourceUrls,
        candidateId,
        candidateTopic,
        candidateUrl,
        candidateSource,
        themePath,
        themeKey: theme.key,
      });

      state.stats.totalSent++;
      pruneHistory(state);
      saveState(state, this.statePath);

      const result = await this.app.client.chat.postMessage({
        channel: this.slackTarget,
        text: suggestion,
      });

      const slackTs = (result as any).ts || '';
      const reserved = state.history.find((h) => h.id === historyId);
      if (reserved) reserved.slackTs = slackTs;
      saveState(state, this.statePath);

      this.logger.info('Sent suggestion', {
        preview: suggestion.substring(0, 60),
        candidateMatchMode,
        candidateId: candidateId || 'none',
        candidateUrl: candidateUrl || 'none',
        selectedCandidateTopic: candidateTopic || 'none',
      });
    } catch (error) {
      this.logger.error('Failed to send to Slack', error);
      saveState(state, this.statePath);
    }
  }

  async handleReaction(
    emoji: string,
    messageTs: string,
    channel: string
  ): Promise<void> {
    const state = loadState(this.statePath);
    const entry = state.history.find((h) => h.slackTs === messageTs);
    if (!entry) return;

    applyReaction(state, messageTs, emoji);
    saveState(state, this.statePath);

    this.logger.info(`Reaction: ${emoji} on ${messageTs} (${entry.category})`);
  }

  /** Check if a message ts belongs to a proactive suggestion */
  isProactiveMessage(messageTs: string): boolean {
    const state = loadState(this.statePath);
    return state.history.some((h) => h.slackTs === messageTs);
  }

  private guessCategory(text: string): SuggestionCategory {
    const lower = text.toLowerCase();
    if (lower.includes('メール') || lower.includes('返信') || lower.includes('mail'))
      return 'email_reply';
    if (lower.includes('会議') || lower.includes('ミーティング') || lower.includes('予定'))
      return 'meeting_prep';
    if (lower.includes('締切') || lower.includes('期限') || lower.includes('deadline'))
      return 'deadline_risk';
    if (lower.includes('slack') || lower.includes('メッセージ') || lower.includes('返事'))
      return 'slack_followup';
    if (lower.includes('休憩') || lower.includes('コーヒー') || lower.includes('散歩'))
      return 'energy_break';
    if (lower.includes('誕生日') || lower.includes('記念'))
      return 'personal_event';
    if (lower.includes('趣味') || lower.includes('映画') || lower.includes('本'))
      return 'hobby_leisure';
    return 'flashback';
  }

  /** Inference: test mock or Claude Code SDK */
  private async inference(prompt: string): Promise<string> {
    if (this.inferenceFn) {
      return this.inferenceFn(prompt);
    }
    return this.claudeInference(prompt);
  }

  /** Production inference via Claude Code SDK */
  private async claudeInference(prompt: string): Promise<string> {
    const model = this.chatModel;
    const meiContext = buildInsightsContext(this.insightsPath);

    let responseText = '';
    const options: any = {
      outputFormat: 'stream-json',
      permissionMode: 'bypassPermissions',
      cwd: process.env.BASE_DIRECTORY || process.cwd(),
      model,
      appendSystemPrompt: this.systemPrompt + '\n\n## 現在時刻\n' + getDateTimeInTz(new Date(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }) + ' (' + getTimezone() + ')' + '\n\n' + meiContext,
    };

    try {
      for await (const message of queryWithFallback({ prompt, options })) {
        if (message.type === 'assistant' && (message as any).subtype === 'text') {
          responseText += (message as any).text || '';
        }
        if (message.type === 'result' && !responseText) {
          responseText = (message as any).result || '';
        }
      }
    } catch (error) {
      this.logger.error('query failed', error);
      // Let resolveMessage() synthesize a deterministic fallback when possible.
      return responseText;
    }
    return responseText;
  }

  // Default data collection (runs collect_data.py)
  private async defaultCollectData(): Promise<string> {
    const { execSync } = await import('child_process');
    const scriptPath = join(process.cwd(), 'scripts', 'collect_data.py');

    const insights = loadInsights(this.insightsPath);
    const interests = insights.map((i) => i.insight).join(',');
    const args = interests ? ` --interests "${interests}"` : '';

    try {
      const result = execSync(`python3 ${scriptPath}${args}`, {
        encoding: 'utf-8',
        timeout: 60000,
      });
      return result;
    } catch (error) {
      this.logger.error('collect_data.py failed', error);
      return '{"errors": ["collect_data.py failed"]}';
    }
  }
}
