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
  buildProfilingSection,
  resolveMessage,
  getActiveInsights,
  loadInsights,
  buildInsightsContext,
  buildSourceUrlsFromCandidates,
  buildCandidateId,
  extractUrlsFromText,
  buildDecisionLogSnapshot,
  emojiToReaction,
  findSelectedCandidate,
  attachRequiredMovieUrl,
  normalizeUrlForDedup,
  type SuggestionCategory,
  type DecisionLog,
  type ProactiveState,
  type TodayMessageEntry,
} from './proactive-state';
import { MementoSkillsManager, SkillMatch } from './memento-skills';
import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { HeartbeatContext } from './heartbeat-context';
import type { BotRegistry } from './bot-registry';
import { getDateInTz, getTimeInTz, getDateTimeInTz, getTimezone } from './timezone';
import {
  scoreCandidatesWithBackfill,
  buildSupplementCandidatesFromCollectedData,
  buildSupplementCandidatesFromMemoryContext,
  mergeDistinctCandidates,
  generateFollowUpCandidates,
  type RawCandidate,
  type ConversationContext,
  type ScoredCandidate,
} from './conversation-scorer';
import { updatePriors, rescalePriors } from './thompson-sampling';
import { buildStagedMessages } from './staged-delivery';
import type { IntentionalPauseConfig, ProactiveEvent } from './event-sources/types';
import { DEFAULT_INTENTIONAL_PAUSE_CONFIG } from './event-sources/types';
import { eventToCandidate } from './event-to-candidate';
import {
  computeImmediateRewards,
  computeIntrinsicBoost,
  filterEnabledSignals,
  createDefaultIntrinsicConfig,
  type IntrinsicRewardLog,
  type IntrinsicSignal,
} from './intrinsic-rewards';
import { buildSharedProactiveContext, recordSharedSend, getOtherBotMessages, getRecentSends } from './shared-proactive-history';
import { recordReminiscence, type ReminiscenceSignal } from './reminiscence-notes';
import { buildThemeTrail, observeProactiveTheme } from './proactive-themes';
import {
  buildThemeInventorySnapshot,
  persistThemeInventorySnapshot,
  type ThemeInventorySnapshot,
} from './theme-inventory';
import { shouldReflect, buildReflectionPrompt, parseReflectionResponse, applyReflection, detectFailurePatterns, type ReflectionContext, type InteractionOutcome } from './reflection';
import { queryWithFallback } from './openai-fallback';
import type { ClaudeHandler } from './claude-handler';

type CollectDataFn = () => Promise<string>;
type InferenceFn = (prompt: string) => Promise<string>;

interface SkillEnhancedProactiveAgentOptions {
  app: App;
  statePath?: string;
  insightsPath?: string;
  skillsDir?: string;
  slackTarget?: string;
  mentionUserId?: string;
  systemPrompt?: string;
  chatModel?: string;
  thinkerModel?: string;
  collectDataFn?: CollectDataFn;
  inferenceFn?: InferenceFn;
  enableSkillLearning?: boolean;
  botId?: string;
  botName?: string;
  botRegistry?: BotRegistry;
  intentionalPauseConfig?: IntentionalPauseConfig;
  claudeHandler?: ClaudeHandler;
}

const DEFAULT_STATE_PATH = join(process.cwd(), 'data', 'proactive-state.json');
const DEFAULT_INSIGHTS_PATH = join(process.cwd(), 'data', 'user-insights.json');
const DEFAULT_SKILLS_DIR = join(process.cwd(), '.claude', 'skills');
const DEFAULT_SLACK_TARGET = 'U3SFGQXNH';

export class SkillEnhancedProactiveAgent implements IProactiveAgent {
  private app: App;
  private statePath: string;
  private insightsPath: string;
  private slackTarget: string;
  private logger = new Logger('SkillEnhancedProactiveAgent');
  private collectDataFn: CollectDataFn;
  private inferenceFn: InferenceFn | null;
  private skillsManager: MementoSkillsManager;
  private enableSkillLearning: boolean;
  private systemPrompt: string;
  private chatModel: string;
  private botId: string;
  private botName: string;
  private botRegistry?: BotRegistry;
  private intentionalPauseConfig: IntentionalPauseConfig;
  private mentionUserId?: string;
  private claudeHandler?: ClaudeHandler;

  private heartbeatContext!: HeartbeatContext;
  private thinkerModel: string;
  private lastReflectionAt: Date | null = null;

  // Map messageTs -> execution info for async reaction handling
  private executionHistory: Map<string, { skillName: string; context: string; sentAt: number }> = new Map();

  constructor(options: SkillEnhancedProactiveAgentOptions) {
    this.app = options.app;
    this.statePath = options.statePath || DEFAULT_STATE_PATH;
    this.insightsPath = options.insightsPath || DEFAULT_INSIGHTS_PATH;
    this.slackTarget = options.slackTarget || DEFAULT_SLACK_TARGET;
    this.mentionUserId = options.mentionUserId;
    this.systemPrompt = options.systemPrompt || '';
    this.chatModel = options.chatModel || process.env.PROACTIVE_MODEL_CHAT || 'claude-opus-4-6';
    this.thinkerModel = options.thinkerModel || process.env.THINKER_MODEL || '';
    this.collectDataFn = options.collectDataFn || this.defaultCollectData.bind(this);
    this.inferenceFn = options.inferenceFn || null;
    this.enableSkillLearning = options.enableSkillLearning ?? true;
    if (!options.botId) throw new Error('botId is required for SkillEnhancedProactiveAgent');
    this.botId = options.botId;
    this.botName = options.botName || options.botId;

    this.botRegistry = options.botRegistry;
    this.intentionalPauseConfig = options.intentionalPauseConfig ?? DEFAULT_INTENTIONAL_PAUSE_CONFIG;
    this.claudeHandler = options.claudeHandler;

    this.skillsManager = new MementoSkillsManager(options.skillsDir || DEFAULT_SKILLS_DIR);
    this.skillsManager.init();

    // Load heartbeat context from disk
    const hbPath = join(dirname(this.statePath), `${this.botId}-heartbeat.json`);
    if (existsSync(hbPath)) {
      try {
        this.heartbeatContext = HeartbeatContext.deserialize(
          readFileSync(hbPath, 'utf-8'), { maxEntries: 20 }
        );
      } catch {
        this.heartbeatContext = new HeartbeatContext({ maxEntries: 20 });
      }
    } else {
      this.heartbeatContext = new HeartbeatContext({ maxEntries: 20 });
    }

    // Load last reflection timestamp
    const reflectTimePath = join(dirname(this.statePath), `${this.botId}-last-reflect.txt`);
    if (existsSync(reflectTimePath)) {
      try {
        this.lastReflectionAt = new Date(readFileSync(reflectTimePath, 'utf-8').trim());
      } catch {
        this.lastReflectionAt = null;
      }
    }

    this.logger.info('SkillEnhancedProactiveAgent initialized');
  }

  private withMention(text: string): string {
    if (!this.mentionUserId) return text;
    return `<@${this.mentionUserId}> ${text}`;
  }

  /**
   * After successfully posting a proactive message, mirror it into the
   * user's DM chatHistory. Without this, a reply to the proactive is
   * processed by slack-handler with no recollection of what was just said,
   * and context has to be reconstructed from proactive-state — which is
   * brittle (cross-day, unrelated topics get pulled in).
   */
  private syncProactiveToDmHistory(postResult: any, fullText: string): void {
    if (!this.claudeHandler) return;
    const dmChannel: string | undefined = postResult?.channel;
    const userId = this.mentionUserId || this.slackTarget;
    if (!dmChannel || !userId?.startsWith('U')) return;
    try {
      let session = this.claudeHandler.getSession(userId, dmChannel);
      if (!session) session = this.claudeHandler.createSession(userId, dmChannel);
      this.claudeHandler.addToHistory(session, 'assistant', fullText);
    } catch (e) {
      this.logger.warn('Failed to sync proactive message to DM chatHistory', e);
    }
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

    // Notify on OAuth token refresh failure
    await this.notifyOAuthFailure(collectedData, state);

    // Enrich context with cogmem memories
    let memoryContext = '';
    try {
      memoryContext = await this.gatherMemoryContext(collectedData);
    } catch (error) {
      this.logger.warn('Memory context gathering failed (non-critical)', error);
    }

    // --- Day boundary reset ---
    const today = getDateInTz();
    if (state.todayDate !== today) {
      state.todayMessages = [];
      state.todayDate = today;
      this.logger.info('Day boundary: reset todayMessages', { from: state.todayDate, to: today });
    }

    // --- 6-axis scoring pipeline ---
    // 1. Check neutral reaction from previous run
    this.checkNeutralReaction(state);

    // 2. Build conversation context
    const conversationCtx = this.buildConversationContext(state);

    // 3. Build raw candidates from all sources (excluding negatively-rated URLs)
    const rawCandidates = this.buildRawCandidates(collectedData, memoryContext, state);
    const supplementCandidates = mergeDistinctCandidates(
      mergeDistinctCandidates(
        buildSupplementCandidatesFromCollectedData(collectedData),
        buildSupplementCandidatesFromMemoryContext(memoryContext),
      ),
      generateFollowUpCandidates(conversationCtx),
    );
    const allCandidates = mergeDistinctCandidates(rawCandidates, supplementCandidates);
    const themeInventory: ThemeInventorySnapshot = buildThemeInventorySnapshot({
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
      sharedMessages: getOtherBotMessages(this.botId, 24 * 30).map((entry) => ({
        sentAt: entry.sentAt,
        topic: entry.topic || entry.preview,
        preview: entry.preview,
        source: entry.sourceType || entry.botId,
        category: entry.category,
        interestCategory: entry.interestCategory,
        themePath: entry.themePath,
        themeKey: entry.themeKey,
      })),
      candidatePool: allCandidates,
    });
    state.themeInventory = themeInventory;
    conversationCtx.themeInventory = themeInventory;
    persistThemeInventorySnapshot(themeInventory);

    // 4. Score candidates
    const learningState = state.learningState!;
    let weightsUsed: Record<string, number> = {};
    let sampledRaw: Record<string, number> = {};
    let bonus: Record<string, number> = {};

    if (rawCandidates.length > 0 || supplementCandidates.length > 0) {
      const profile = state.conversationProfile || 'balanced';
      const scoreResult = scoreCandidatesWithBackfill(
        rawCandidates,
        supplementCandidates,
        conversationCtx,
        learningState,
        profile,
      );
      weightsUsed = scoreResult.weightsUsed;
      sampledRaw = scoreResult.sampledRaw;
      bonus = scoreResult.bonus;

      // 5. Store in state for dashboard + reaction matching
      state.lastScoredCandidates = scoreResult.candidates.slice(0, 10);

      if (scoreResult.usedBackfill) {
        this.logger.info('Candidate backfill applied', {
          primary: scoreResult.primaryCount,
          supplemental: scoreResult.supplementalCount,
          viable: scoreResult.viableCount,
        });
      }
    }

    // === SKILL-ENHANCED WORKFLOW ===

    // 1. READ PHASE: Rule-based skill matching
    const currentHour = new Date().getHours();
    const { matches, analysis } = this.skillsManager.readPhase(collectedData, currentHour);
    const selectedSkill = matches.length > 0 ? matches[0] : null;

    this.logger.info('Skill selection', {
      selected: selectedSkill?.name || 'none',
      score: selectedSkill?.score?.toFixed(2) || '0',
      totalMatches: matches.length,
    });

    // 1.5 Track skill_start
    if (selectedSkill && this.enableSkillLearning) {
      this.skillsManager.trackSkillUsage(selectedSkill.name, 'skill_start', `Proactive: ${selectedSkill.name}`);
    }

    // 2. Build enhanced prompt with skill knowledge
    const heartbeatSection = this.heartbeatContext.toPromptSection();
    const enrichedMemoryContext = heartbeatSection + memoryContext;

    const insights = getActiveInsights(this.insightsPath);
    const enhancedPrompt = this.buildSkillEnhancedPrompt(
      state,
      collectedData,
      insights,
      selectedSkill,
      enrichedMemoryContext,
    );

    // 3. Run inference (Thinker/Talker split when thinkerModel is configured)
    const promptChars = enhancedPrompt.length;
    const promptTokensEst = Math.round(promptChars / 4);
    this.logger.info(`Prompt size: ${promptChars} chars (~${promptTokensEst} tokens est)`);

    let response: string;
    try {
      if (this.thinkerModel && this.thinkerModel !== this.chatModel) {
        // Phase 1: Thinker (cheap model) — decides talk/no_talk
        const thinkerResponse = await this.claudeInference(enhancedPrompt, this.thinkerModel);
        const thinkerResolution = resolveMessage(thinkerResponse, state, this.botId);

        if (thinkerResolution.action === 'skip') {
          // Thinker says skip — save expensive Talker call
          response = thinkerResponse;
          this.logger.info('Thinker decided skip, saving Talker call');
        } else {
          // Phase 2: Talker (main model) — generates quality message
          const talkerPrompt = enhancedPrompt + `\n\n## 事前分析（Thinkerの判断）\n判断: 話しかける\n理由: ${thinkerResolution.decisionLog?.reason || ''}\n候補: ${thinkerResolution.decisionLog?.candidates?.map(c => c.topic).join(', ') || ''}\n\n上記の分析を踏まえて、最終的なメッセージを生成してください。出力形式は同じJSON形式で。`;
          response = await this.claudeInference(talkerPrompt);
          this.logger.info('Thinker→Talker pipeline completed');
        }
      } else {
        // Single model (original behavior)
        response = await this.inference(enhancedPrompt);
      }
    } catch (error) {
      this.logger.error('Inference failed', error);
      state.lastCheckAt = new Date().toISOString();
      saveState(state, this.statePath);
      return;
    }

    state.lastCheckAt = new Date().toISOString();

    // 4. Resolve message (single decision point)
    const resolution = resolveMessage(response, state, this.botId);
    const decisionLog = resolution.decisionLog;
    state.lastDecisionLog = {
      ...buildDecisionLogSnapshot(decisionLog, {
        action: resolution.action,
        message: resolution.message,
        error: resolution.error,
        skill: selectedSkill?.name || 'none',
      }),
      scoredCandidates: (state.lastScoredCandidates || []).slice(0, 10).map(c => ({
        topic: c.topic,
        source: c.source,
        category: c.category,
        scores: c.scores,
        finalScore: c.finalScore,
        explorationBonus: c.explorationBonus,
        selectionScore: c.selectionScore,
        reasoning: c.reasoning,
      })),
      weightsUsed: weightsUsed || {},
      sampledRaw: sampledRaw || {},
      contextBonus: bonus || {},
      priors: state.learningState?.priors || {},
    } as any;
    const savedDecisionLog = state.lastDecisionLog!;
    this.logger.info('Decision log', {
      decision: savedDecisionLog.decision,
      need: savedDecisionLog.need,
      reason: savedDecisionLog.reason?.substring(0, 80),
      candidateCount: savedDecisionLog.candidates?.length || 0,
    });

    // Compute immediate intrinsic rewards
    const selectedCandidate = decisionLog?.candidates?.length && state.lastScoredCandidates
      ? findSelectedCandidate(decisionLog.candidates, state.lastScoredCandidates)
      : null;
    const candidateForReward = decisionLog?.decision === 'send' && selectedCandidate
      ? { category: selectedCandidate.category, source: selectedCandidate.source, topic: selectedCandidate.topic, metadata: (selectedCandidate as any).metadata || {} }
      : null;

    const intrinsicConfig = state.intrinsicConfig || createDefaultIntrinsicConfig();
    const immediateSignals = filterEnabledSignals(
      computeImmediateRewards(
        candidateForReward,
        {
          history: state.history,
          todayMessages: state.todayMessages,
          consecutiveNoReaction: conversationCtx.consecutiveNoReaction,
          calendarDensity: conversationCtx.calendarDensity,
        },
        insights || [],
        decisionLog?.decision || 'no_reply',
      ),
      intrinsicConfig,
    );

    const immediateTotal = immediateSignals.reduce((sum: number, s: IntrinsicSignal) => sum + s.value, 0);

    // Log warnings from resolution
    for (const warning of resolution.warnings) {
      this.logger.warn(warning);
    }

    // Handle skip
    if (resolution.action === 'skip') {
      if (resolution.error) {
        this.logger.error(resolution.error, {
          decision: decisionLog?.decision,
          reason: decisionLog?.reason,
        });
      } else {
        this.logger.info('No suggestion (NO_REPLY)', { reason: decisionLog?.reason });
      }
      this.heartbeatContext.recordSkip({
        reason: decisionLog?.reason || 'unknown',
        modeEstimate: decisionLog?.premise?.estimatedMode || 'unknown',
        inner_thought: decisionLog?.inner_thought,
        plan: decisionLog?.plan,
        generate_score: decisionLog?.generate_score,
        evaluate_score: decisionLog?.evaluate_score,
      });
      this.persistHeartbeatContext();
      saveState(state, this.statePath);
      // Auto-reflection (non-blocking)
      try { await this.maybeReflect(); } catch (e) { this.logger.warn('Reflection error', e); }
      return;
    }

    let suggestion = resolution.message!;

    // 5. Send to Slack (with intentional pause if configured)
    try {
      const category = this.guessCategory(suggestion);
      const fallbackUrl = extractUrlsFromText(suggestion)[0] || extractUrlsFromText(decisionLog?.message || '')[0];
      const candidateTopic = selectedCandidate?.topic || decisionLog?.candidates?.[0]?.topic;
      const candidateSource = selectedCandidate?.source || decisionLog?.candidates?.[0]?.source;
      const candidateUrl = selectedCandidate
        ? buildSourceUrlsFromCandidates([selectedCandidate])[0]?.url || normalizeUrlForDedup(selectedCandidate?.metadata?.url as string | undefined)
        : normalizeUrlForDedup(fallbackUrl);
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
              category: this.guessInterestCategory(suggestion),
              metadata: { url: candidateUrl, mediaSource: candidateSource },
            } as any
          : undefined),
      );
      if (!movieUrlCheck.text) {
        this.logger.warn('Skipped movie suggestion without verified URL', {
          candidateTopic: candidateTopic || 'none',
          candidateSource: candidateSource || 'none',
        });
        this.persistHeartbeatContext();
        saveState(state, this.statePath);
        return;
      }
      suggestion = movieUrlCheck.text;

      const topicWeight = decisionLog?.topicWeight || 'medium';
      const staged = buildStagedMessages(suggestion, topicWeight, this.intentionalPauseConfig);

      // Pre-compute dedup metadata BEFORE sending to Slack so we can reserve
      // the dedup slot first. This closes the race where a Slack-send succeeds
      // but the process crashes before recording, allowing a duplicate on the
      // next cron tick.
      const candidateId = selectedCandidate
        ? buildCandidateId(selectedCandidate)
        : candidateUrl
          ? `url:${candidateUrl}`
          : undefined;
      const interestCategory = selectedCandidate?.category || this.guessInterestCategory(suggestion);
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
        interestCategory,
        source: candidateSource,
        sourceType: typeof selectedCandidate?.metadata?.mediaSource === 'string'
          ? selectedCandidate.metadata.mediaSource
          : undefined,
        skill: selectedSkill?.name || 'general',
      });
      const themePath = buildThemeTrail(theme.path);
      const historyId = randomUUID();
      const sentAt = new Date().toISOString();

      // Reserve dedup slot before Slack send. If the send later fails we accept
      // a phantom record in exchange for guaranteed non-duplication.
      recordSharedSend({
        botId: this.botId,
        botName: this.botName,
        category,
        interestCategory,
        preview: suggestion.substring(0, 150),
        topic: candidateTopic,
        url: candidateUrl,
        candidateId,
        sourceType: candidateSource,
        skill: selectedSkill?.name || 'general',
        themePath,
        themeKey: theme.key,
        inner_thought: decisionLog?.inner_thought,
        plan: decisionLog?.plan,
        generate_score: decisionLog?.generate_score,
        evaluate_score: decisionLog?.evaluate_score,
      });

      state.history.push({
        id: historyId,
        category,
        interestCategory,
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
        skill: selectedSkill?.name || 'general',
        sources: this.detectSources(collectedData, memoryContext),
        intrinsicReward: {
          signals: immediateSignals,
          immediateTotal,
          deferredTotal: 0,
          compositeBoost: 0,
        },
        premise: decisionLog?.premise || undefined,
        emotionTag: this.inferEmotionTag(decisionLog?.premise?.estimatedMode),
        themePath,
        themeKey: theme.key,
      });

      const todayBeforeSend = getDateInTz();
      if (!state.todayMessages || state.todayDate !== todayBeforeSend) {
        state.todayMessages = [];
        state.todayDate = todayBeforeSend;
      }
      const todayEntry: TodayMessageEntry = {
        time: getTimeInTz(),
        summary: candidateTopic || suggestion.substring(0, 100),
        source: candidateSource || selectedSkill?.name || 'general',
        interestCategory,
        topic: candidateTopic,
        url: candidateUrl,
        candidateId,
        themePath,
        themeKey: theme.key,
      };
      state.todayMessages.push(todayEntry);

      state.stats.totalSent++;
      pruneHistory(state);
      // Persist dedup state BEFORE touching Slack.
      saveState(state, this.statePath);

      if (staged.premise) {
        await this.app.client.chat.postMessage({
          channel: this.slackTarget,
          text: this.withMention(staged.premise),
        });
        await new Promise(resolve => setTimeout(resolve, staged.waitMs));
      }

      const result = await this.app.client.chat.postMessage({
        channel: this.slackTarget,
        text: this.withMention(staged.main),
      });

      const slackTs = (result as any).ts || '';
      // Clear auth error on successful send
      if (state.lastAuthError) delete state.lastAuthError;
      // Back-fill slackTs now that the post succeeded.
      const reserved = state.history.find((h) => h.id === historyId);
      if (reserved) reserved.slackTs = slackTs;

      this.heartbeatContext.recordSend({
        message: suggestion,
        category,
        decision: 'send',
        modeEstimate: decisionLog?.premise?.estimatedMode || 'unknown',
        inner_thought: decisionLog?.inner_thought,
        plan: decisionLog?.plan,
        generate_score: decisionLog?.generate_score,
        evaluate_score: decisionLog?.evaluate_score,
      });
      this.persistHeartbeatContext();

      // Sync proactive message to DM session chatHistory so user replies carry context
      this.syncProactiveToDmHistory(result, suggestion);

      // Save emotion metadata for voice service
      try {
        const voiceMetaPath = join(dirname(this.statePath), `${this.botId}-voice-meta.json`);
        writeFileSync(voiceMetaPath, JSON.stringify({
          emotionTag: this.inferEmotionTag(decisionLog?.premise?.estimatedMode),
          estimatedMode: decisionLog?.premise?.estimatedMode || '',
          timestamp: new Date().toISOString(),
        }), 'utf-8');
      } catch {
        // Non-critical
      }

      // Update profileCollection state if profiling was active
      try {
        const profilePath = join(__dirname, '..', 'data', 'user-profile.json');
        if (existsSync(profilePath)) {
          const userProfile = JSON.parse(readFileSync(profilePath, 'utf-8'));
          const profilingResult = buildProfilingSection(state, userProfile);
          if (profilingResult) {
            state.profileCollection = {
              lastQuestionAt: new Date().toISOString(),
              lastQuestionLayer: profilingResult.target.layerNumber,
              lastQuestionField: `${profilingResult.target.layerName}.${profilingResult.target.fieldName}`,
            };
            this.logger.info('Profiling question sent', {
              layer: profilingResult.target.layerDisplayName,
              field: profilingResult.target.fieldName,
            });
          }
        }
      } catch (error) {
        this.logger.warn('Failed to update profiling state', error);
      }

      saveState(state, this.statePath);

      this.logger.info('Sent suggestion', {
        skill: selectedSkill?.name || 'no-skill',
        preview: suggestion.substring(0, 60),
        candidateMatchMode,
        candidateId: candidateId || 'none',
        candidateUrl: candidateUrl || 'none',
        selectedCandidateTopic: candidateTopic || 'none',
      });

      // Store execution info for async reaction handling
      if (selectedSkill && slackTs) {
        this.executionHistory.set(slackTs, {
          skillName: selectedSkill.name,
          context: collectedData.substring(0, 300),
          sentAt: Date.now(),
        });
        // Prune old entries (keep last 50)
        if (this.executionHistory.size > 50) {
          const oldest = this.executionHistory.keys().next().value;
          if (oldest) this.executionHistory.delete(oldest);
        }
      }

      // Record skill_end + initial performance
      if (selectedSkill && this.enableSkillLearning) {
        this.skillsManager.trackSkillUsage(selectedSkill.name, 'skill_end', 'Suggestion sent');
        await this.skillsManager.writePhase(
          selectedSkill.name,
          collectedData.substring(0, 200),
          0.7, // initial estimate
          0.5, // neutral
          'Suggestion sent',
        );
      }
    } catch (error: any) {
      this.logger.error('Failed to send to Slack', error);
      // Record auth errors in state for dashboard visibility
      if (error?.data?.error === 'invalid_auth' || error?.data?.error === 'token_expired' || error?.data?.error === 'not_authed') {
        state.lastAuthError = {
          error: error.data.error,
          timestamp: new Date().toISOString(),
          message: 'Slack OAuth トークンが無効です。/login でトークンを更新してください。',
        };
      }
      saveState(state, this.statePath);
    }

    // Auto-reflection (non-blocking)
    try {
      await this.maybeReflect();
    } catch (error) {
      this.logger.warn('Reflection error (non-critical)', error);
    }
  }

  async handleEvent(event: ProactiveEvent): Promise<void> {
    // Cron ticks already drive agent.run() through the Scheduler, which performs
    // full candidate scoring, dedup (recordSharedSend + recentHistory checks), and
    // state.history persistence. Also dispatching them here bypasses that dedup —
    // every non-proactive cron fire (scheduler-watchdog, interest-scanner, etc.)
    // would post a message from every bot subscribed to '*'. Ignore cron sources.
    if (event.source === 'cron') {
      return;
    }

    this.logger.info(`Handling event: ${event.source}/${event.type}`);
    const candidate = eventToCandidate(event);
    const state = loadState(this.statePath);

    // Check cooldown
    if (isInCooldown(state)) {
      this.logger.info('Skipping event — cooldown active');
      return;
    }

    // Build prompt with event context
    const eventContext = `## イベント通知\n\n- **ソース**: ${candidate.source}\n- **トピック**: ${candidate.topic}\n- **詳細**: ${candidate.detail}\n\nこのイベントに基づいてAkiraさんに話しかけるかどうか判断してください。`;

    const insights = getActiveInsights(this.insightsPath);
    const enhancedPrompt = this.buildSkillEnhancedPrompt(state, eventContext, insights, null, '');

    // Inference (same Thinker/Talker pipeline)
    let response: string;
    try {
      if (this.thinkerModel && this.thinkerModel !== this.chatModel) {
        const thinkerResponse = await this.claudeInference(enhancedPrompt, this.thinkerModel);
        const thinkerResolution = resolveMessage(thinkerResponse, state, this.botId);

        if (thinkerResolution.action === 'skip') {
          response = thinkerResponse;
        } else {
          const talkerPrompt = enhancedPrompt + `\n\n## 事前分析（Thinkerの判断）\n判断: 話しかける\n理由: ${thinkerResolution.decisionLog?.reason || ''}\n\n上記の分析を踏まえて、最終的なメッセージを生成してください。出力形式は同じJSON形式で。`;
          response = await this.claudeInference(talkerPrompt);
        }
      } else {
        response = await this.inference(enhancedPrompt);
      }
    } catch (error) {
      this.logger.error('Event inference failed', error);
      return;
    }

    const resolution = resolveMessage(response, state, this.botId);
    if (resolution.action === 'skip') {
      this.logger.info(`Event skipped: ${resolution.decisionLog?.reason || 'unknown'}`);
      saveState(state, this.statePath);
      return;
    }

    // Send with staged delivery
    let suggestion = resolution.message!;
    const decisionLog = resolution.decisionLog;
    const movieUrlCheck = attachRequiredMovieUrl(suggestion, []);
    if (!movieUrlCheck.text) {
      this.logger.warn('Skipped movie event suggestion without verified URL');
      saveState(state, this.statePath);
      return;
    }
    suggestion = movieUrlCheck.text;
    const topicWeight = decisionLog?.topicWeight || 'medium';
    const staged = buildStagedMessages(suggestion, topicWeight, this.intentionalPauseConfig);

    // Pre-send cross-bot dedup: skip if another bot (or self) already sent this
    // URL recently. Mirrors the run() path so external event sources can't
    // bypass dedup either.
    const eventUrlRaw = extractUrlsFromText(suggestion)[0];
    const eventUrl = normalizeUrlForDedup(eventUrlRaw);
    if (eventUrl) {
      const recentAll = getRecentSends(48);
      const dup = recentAll.find((s) => normalizeUrlForDedup(s.url || '') === eventUrl);
      if (dup) {
        this.logger.info(`Event skip: URL already sent by ${dup.botId} at ${dup.sentAt}`);
        return;
      }
    }

    try {
      // Reserve dedup slot before sending so a post-send crash cannot cause a
      // duplicate on the next event fire.
      const eventCategory = this.guessCategory(suggestion);
      const eventInterestCategory = this.guessInterestCategory(suggestion);
      recordSharedSend({
        botId: this.botId,
        botName: this.botName,
        category: eventCategory,
        interestCategory: eventInterestCategory,
        preview: suggestion.substring(0, 150),
        topic: candidate.topic,
        url: eventUrl || undefined,
        sourceType: event.source,
        skill: `event:${event.source}`,
      });

      if (staged.premise) {
        await this.app.client.chat.postMessage({
          channel: this.slackTarget,
          text: this.withMention(staged.premise),
        });
        await new Promise(resolve => setTimeout(resolve, staged.waitMs));
      }

      await this.app.client.chat.postMessage({
        channel: this.slackTarget,
        text: this.withMention(staged.main),
      });

      state.stats.totalSent++;
      saveState(state, this.statePath);
      this.logger.info(`Event message sent: ${event.source}/${event.type}`);
    } catch (error) {
      this.logger.error('Failed to send event message', error);
    }
  }

  async handleReaction(
    emoji: string,
    messageTs: string,
    channel: string,
  ): Promise<void> {
    const state = loadState(this.statePath);
    const entry = state.history.find((h) => h.slackTs === messageTs);
    if (!entry) return;

    applyReaction(state, messageTs, emoji);

    // Reminiscence v0 (Nomi structured notes): if this is a positive Akira
    // signal, record the topic so another bot can follow up next week.
    // observation-only — recorded automatically, follow-up is a prompt suggestion.
    const updatedEntry = state.history.find((h) => h.slackTs === messageTs);
    if (updatedEntry && (updatedEntry.reactionDelta ?? 0) > 0) {
      const signal: ReminiscenceSignal = emoji === 'text_positive'
        ? 'text_positive'
        : emoji === 'text_engaged'
          ? 'text_engaged'
          : 'reaction_positive';
      const topic = updatedEntry.candidateTopic
        || updatedEntry.preview?.substring(0, 80)
        || updatedEntry.fullText?.substring(0, 80)
        || '';
      if (topic) {
        try {
          recordReminiscence({
            botId: this.botId,
            category: updatedEntry.category,
            topic,
            preview: updatedEntry.preview || updatedEntry.fullText?.substring(0, 200) || '',
            url: updatedEntry.candidateUrl,
            akiraSignal: signal,
            signalDetail: emoji,
          });
        } catch (e) {
          this.logger.warn('Failed to record reminiscence', e);
        }
      }
    }

    // Update Thompson Sampling priors with intrinsic boost
    if (state.learningState && state.lastScoredCandidates) {
      const scoredCandidate = state.lastScoredCandidates.find(
        c => c.category === entry.interestCategory || c.category === '_' + entry.interestCategory
      );
      if (scoredCandidate) {
        const reaction = emojiToReaction(emoji);

        // Compute composite boost from stored immediate rewards
        const storedReward = entry.intrinsicReward;
        const intrinsicConfig = state.intrinsicConfig || createDefaultIntrinsicConfig();
        const boost = storedReward
          ? computeIntrinsicBoost(storedReward.signals, intrinsicConfig.lambda)
          : 0;

        state.learningState = updatePriors(
          state.learningState,
          scoredCandidate.scores,
          scoredCandidate.category,
          reaction,
          boost,
        );
        state.learningState = rescalePriors(state.learningState);

        // Update the stored reward with composite boost
        if (storedReward) {
          storedReward.compositeBoost = boost;
        }
      }
    }

    this.heartbeatContext.recordReaction({ emoji, slackTs: messageTs });
    this.persistHeartbeatContext();

    saveState(state, this.statePath);

    // Skill learning from reactions
    if (this.enableSkillLearning) {
      await this.learnFromReaction(emoji, messageTs);
    }

    this.logger.info(`Reaction: ${emoji} on ${messageTs}`);
  }

  isProactiveMessage(messageTs: string): boolean {
    const state = loadState(this.statePath);
    return state.history.some((h) => h.slackTs === messageTs);
  }

  getHeartbeatContext(): HeartbeatContext {
    return this.heartbeatContext;
  }

  recordReply(preview: string): void {
    this.heartbeatContext.recordReply({ preview });
    this.persistHeartbeatContext();
  }

  private async maybeReflect(): Promise<void> {
    const ctx: ReflectionContext = {
      heartbeatEntries: this.heartbeatContext.getEntries(),
      lastReflectionAt: this.lastReflectionAt,
      currentTime: new Date(),
    };

    if (!shouldReflect(ctx)) return;

    const memoryPath = join(dirname(this.statePath), this.botId, 'MEMORY.md');
    if (!existsSync(memoryPath)) return;

    const currentMemory = readFileSync(memoryPath, 'utf-8');

    // Extract failure patterns from history
    const state = loadState(this.statePath);
    const outcomes: InteractionOutcome[] = state.history
      .filter((h: any) => h.reaction !== null)
      .map((h: any) => ({
        timestamp: h.sentAt,
        category: h.category,
        reaction: h.reactionDelta < -0.2 ? 'negative' as const : h.reactionDelta > 0 ? 'positive' as const : 'neutral' as const,
        estimatedMode: h.premise?.estimatedMode || 'unknown',
      }));
    const failurePatterns = detectFailurePatterns(outcomes);

    const prompt = buildReflectionPrompt(ctx.heartbeatEntries, currentMemory, this.botId, failurePatterns);
    if (!prompt) return;

    try {
      this.logger.info('Starting reflection');
      const reflectionModel = this.thinkerModel || 'claude-haiku-4-5-20251001';
      const response = await this.claudeInference(prompt, reflectionModel);
      const output = parseReflectionResponse(response);

      const totalItems = output.observations.length + output.successPatterns.length + output.avoidPatterns.length;
      if (totalItems > 0) {
        applyReflection(output, memoryPath);
        const summary = [
          ...output.observations.map(o => `観察: ${o}`),
          ...output.successPatterns.map(s => `成功: ${s}`),
          ...output.avoidPatterns.map(a => `回避: ${a}`),
        ].join('; ');
        this.heartbeatContext.recordReflect({ summary: summary.substring(0, 200) });
        this.persistHeartbeatContext();
        this.logger.info('Reflection completed', { items: totalItems });
      }

      // Update timestamp
      this.lastReflectionAt = new Date();
      const reflectTimePath = join(dirname(this.statePath), `${this.botId}-last-reflect.txt`);
      writeFileSync(reflectTimePath, this.lastReflectionAt.toISOString(), 'utf-8');
    } catch (error) {
      this.logger.warn('Reflection failed (non-critical)', error);
    }
  }

  // --- Private Methods ---

  private persistHeartbeatContext(): void {
    try {
      const hbPath = join(dirname(this.statePath), `${this.botId}-heartbeat.json`);
      writeFileSync(hbPath, this.heartbeatContext.serialize(), 'utf-8');
    } catch (error) {
      this.logger.warn('Failed to persist heartbeat context', error);
    }
  }

  private buildSkillEnhancedPrompt(
    state: any,
    collectedData: string,
    insights: any[],
    selectedSkill: SkillMatch | null,
    memoryContext: string = '',
  ): string {
    // Add other bots' recent messages to avoid duplicates
    const enrichedMemoryContext = buildSharedProactiveContext(this.botId, memoryContext);

    const displayName = this.botRegistry?.getDisplayName(this.botId) || this.botName;
    const noReplyClause = state.allowNoReply === false
      ? '\n\n【重要】NO_REPLYは禁止。必ず候補テーブルから1つ選んでメッセージを生成すること。元記事・ソースの具体情報（何が変わったか、数値、固有名詞）を含めること。'
      : '';
    const basePrompt = buildCronPrompt(state, collectedData, insights, enrichedMemoryContext, displayName, this.botId) + noReplyClause;

    if (!selectedSkill) {
      return basePrompt;
    }

    // Inject the skill's markdown directly into the prompt
    return basePrompt + `

=== 適用スキル: ${selectedSkill.name} (score: ${selectedSkill.score.toFixed(2)}) ===
${selectedSkill.content}
=== スキルここまで ===

上記スキルの「手順」に従って提案を生成してください。「注意点」も考慮すること。`;
  }

  private async learnFromReaction(emoji: string, messageTs: string): Promise<void> {
    const executionInfo = this.executionHistory.get(messageTs);
    if (!executionInfo) return;

    const emojiScores: Record<string, [number, number]> = {
      '+1':         [0.9, 0.9],
      'thumbsup':   [0.9, 0.9],
      'heart':      [0.95, 0.95],
      '-1':         [0.2, 0.1],
      'thumbsdown': [0.2, 0.1],
      'x':          [0.1, 0.05],
    };

    const scores = emojiScores[emoji];
    if (!scores) return;

    await this.skillsManager.writePhase(
      executionInfo.skillName,
      executionInfo.context,
      scores[0],
      scores[1],
      `User reaction: ${emoji}`,
    );

    this.executionHistory.delete(messageTs);
    this.logger.info('Learned from reaction', {
      skill: executionInfo.skillName,
      emoji,
      effectiveness: scores[0],
    });
  }

  private buildConversationContext(state: ProactiveState): ConversationContext {
    const now = new Date();
    // Merge own todayMessages with other bots' messages for cross-bot dedup
    const ownMessages = state.todayMessages || [];
    const otherBotMessages = this.getOtherBotTodayMessages();
    const todayMessages = [...ownMessages, ...otherBotMessages];
    const history = state.history || [];

    // Calculate lastSentMinutesAgo
    const lastEntry = history.length > 0 ? history[history.length - 1] : null;
    const lastSentMinutesAgo = lastEntry
      ? (now.getTime() - new Date(lastEntry.sentAt).getTime()) / 60000
      : Infinity;

    // Calculate consecutiveNoReaction
    let consecutiveNoReaction = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].reaction === null) consecutiveNoReaction++;
      else break;
    }

    // Calendar density: 0=empty, 1=normal, 2=busy
    // Default to 1 — will be refined when calendar data is parsed
    const calendarDensity = 1;

    return {
      currentHour: now.getHours(),
      dayOfWeek: now.getDay(),
      todayMessages,
      recentHistory: [
        // Own history (last 20)
        ...history.slice(-20).map(h => ({
          category: h.category,
          interestCategory: h.interestCategory,
          sentAt: h.sentAt,
          reaction: h.reaction,
          reactionDelta: h.reactionDelta,
          preview: h.preview,
          candidateId: h.candidateId,
          candidateTopic: h.candidateTopic,
          candidateUrl: h.candidateUrl,
          themePath: h.themePath,
          themeKey: h.themeKey,
        })),
        // Other bots' recent messages (for cross-bot dedup)
        ...getOtherBotMessages(this.botId, 48).map(m => ({
          category: m.category,
          interestCategory: m.interestCategory,
          sentAt: m.sentAt,
          reaction: null,
          reactionDelta: 0,
          preview: m.preview,
          candidateId: m.candidateId,
          candidateTopic: m.topic,
          candidateUrl: m.url,
          themePath: m.themePath,
          themeKey: m.themeKey,
        })),
      ],
      calendarDensity,
      lastSentMinutesAgo,
      consecutiveNoReaction,
      themeInventory: state.themeInventory,
    };
  }

  private getOtherBotTodayMessages(): TodayMessageEntry[] {
    // Read other bots' state files to get their todayMessages
    const dataDir = join(__dirname, '..', 'data');
    const botIds = this.botRegistry
      ? this.botRegistry.getOtherBotIds(this.botId)
      : [];
    const result: TodayMessageEntry[] = [];

    for (const id of botIds) {
      if (id === this.botId) continue; // skip self
      try {
        const statePath = join(dataDir, `${id}-state.json`);
        if (existsSync(statePath)) {
          const otherState = JSON.parse(readFileSync(statePath, 'utf-8'));
          const today = getDateInTz();
          if (otherState.todayDate === today && otherState.todayMessages) {
            result.push(...otherState.todayMessages);
          }
        }
      } catch {} // silent failure
    }

    return result;
  }

  private buildRawCandidates(collectedData: string, memoryContext: string, state?: ProactiveState): RawCandidate[] {
    const candidates: RawCandidate[] = [];

    // Collect URLs from negatively-rated messages to exclude
    const blockedUrls = new Set<string>();
    if (state?.history) {
      for (const h of state.history) {
        if (h.reactionDelta !== undefined && h.reactionDelta < 0 && h.sourceUrls) {
          for (const su of h.sourceUrls) {
            if (typeof su === 'string') blockedUrls.add(su);
            else if (su.url) blockedUrls.add(su.url);
          }
        }
      }
    }

    // Load interest cache
    try {
      const cachePath = join(__dirname, '..', 'data', 'interest-cache.json');
      if (existsSync(cachePath)) {
        const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
        for (const [catId, catData] of Object.entries(cache.categories || {})) {
          const cat = catData as any;
          for (const item of cat.items || []) {
            // Skip items whose URL was negatively rated
            if (item.url && blockedUrls.has(item.url)) continue;

            candidates.push({
              topic: item.title || '',
              source: 'interest-cache',
              category: catId,
              pub_date: item.pub_date || null,
              metadata: {
                url: item.url,
                mediaSource: item.source,
                content_type: item.content_type,
                emotion_type: cat.emotion_type || 'medium',
                timeliness: item.timeliness,
                ...(item.cross_categories ? { crossCategories: item.cross_categories } : {}),
              },
            });
          }
        }
      }
    } catch (e) {
      this.logger.warn('Failed to load interest cache', e);
    }

    return candidates;
  }

  private checkNeutralReaction(state: ProactiveState): void {
    if (!state.lastScoredCandidates?.length || !state.learningState) return;
    const lastEntry = state.history.length > 0 ? state.history[state.history.length - 1] : null;
    if (!lastEntry || lastEntry.reaction !== null) return;

    const minutesSinceSent = (Date.now() - new Date(lastEntry.sentAt).getTime()) / 60000;
    if (minutesSinceSent < 120) return;

    const scoredCandidate = state.lastScoredCandidates.find(
      c => c.category === lastEntry.interestCategory
    );
    if (scoredCandidate) {
      state.learningState = updatePriors(
        state.learningState,
        scoredCandidate.scores,
        scoredCandidate.category,
        'neutral'
      );
      state.learningState = rescalePriors(state.learningState);
    }
  }

  private guessInterestCategory(text: string): string {
    const lower = text.toLowerCase();
    const mapping: [string, string[]][] = [
      ['dodgers', ['ドジャース', '大谷', 'dodgers', 'mlb', '野球']],
      ['ai_agent', ['ai', 'claude', 'エージェント', 'llm', 'cogmem']],
      ['campingcar', ['キャンピングカー', 'キャブコン', 'campingcar']],
      ['golf', ['ゴルフ', 'golf', 'レッスン']],
      ['onsen', ['温泉', 'onsen']],
      ['cat_health', ['猫', 'ストルバイト']],
      ['business_strategy', ['経営', 'M&A', 'クライアント', '戦略']],
      ['local_tokorozawa', ['所沢', '埼玉', '航空公園']],
      ['llm_local', ['ollama', 'mlx', 'qwen']],
    ];
    for (const [cat, keywords] of mapping) {
      if (keywords.some(kw => lower.includes(kw.toLowerCase()))) return cat;
    }
    return 'general';
  }

  private async notifyOAuthFailure(collectedData: string, state: any): Promise<void> {
    try {
      const data = JSON.parse(collectedData);
      const errors: string[] = data.errors || [];
      const hasTokenError = errors.some((e: string) => /token.*fail|unauthorized|401/i.test(e));
      if (!hasTokenError) return;

      // Avoid duplicate notifications: only notify once per day
      const today = getDateInTz();
      if (state.lastOAuthNotifyDate === today) return;

      await this.app.client.chat.postMessage({
        channel: this.slackTarget,
        text: `[System] OAuth token refresh failed. Calendar and Gmail data are unavailable. Please re-authenticate: ~/.gmail-mcp/credentials.json\nErrors: ${errors.join(', ')}`,
      });
      state.lastOAuthNotifyDate = today;
      this.logger.warn('OAuth failure notified to Slack', { errors });
    } catch (error) {
      this.logger.error('Failed to notify OAuth failure', error);
    }
  }

  /** @deprecated Use buildSourceUrlsFromCandidates instead. Kept for reference. */
  private extractSourceUrls(collectedData: string): Array<{ title: string; url: string; source?: string }> {
    const urls: Array<{ title: string; url: string; source?: string }> = [];
    try {
      // Extract from interest-cache
      const cachePath = join(process.cwd(), 'data', 'interest-cache.json');
      if (existsSync(cachePath)) {
        const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
        for (const cat of Object.values(cache.categories || {})) {
          const items = (cat as any)?.items;
          if (Array.isArray(items)) {
            urls.push(...items.filter((i: any) => i.url && i.title).map((i: any) => ({
              title: i.title, url: i.url, source: i.source || 'interest-cache',
            })));
          }
        }
        if (cache.topItems && Array.isArray(cache.topItems)) {
          urls.push(...cache.topItems.filter((i: any) => i.url && i.title).map((i: any) => ({
            title: i.title, url: i.url, source: i.source || 'interest-cache',
          })));
        }
      }
      // Extract URLs from collectedData JSON
      try {
        const data = JSON.parse(collectedData);
        for (const [key, val] of Object.entries(data)) {
          if (Array.isArray(val)) {
            for (const item of val) {
              if (item && typeof item === 'object' && item.url && item.title) {
                urls.push({ title: item.title, url: item.url, source: key });
              }
            }
          }
        }
      } catch { /* collectedData may not be JSON */ }
    } catch { /* non-fatal */ }
    // Deduplicate by URL
    const seen = new Set<string>();
    return urls.filter(u => {
      if (seen.has(u.url)) return false;
      seen.add(u.url);
      return true;
    }).slice(0, 30);
  }

  private detectSources(collectedData: string, memoryContext: string): string[] {
    const sources: string[] = [];
    if (collectedData.includes('calendar') || collectedData.includes('予定')) sources.push('calendar');
    if (collectedData.includes('gmail') || collectedData.includes('メール')) sources.push('email');
    if (memoryContext.includes('記憶から')) sources.push('cogmem');
    if (memoryContext.includes('去年の')) sources.push('last-year');
    if (memoryContext.includes('興味に関する')) sources.push('interest-cache');
    if (memoryContext.includes('成果')) sources.push('milestones');
    if (sources.length === 0) sources.push('general');
    return sources;
  }

  private inferEmotionTag(estimatedMode?: string): string {
    if (!estimatedMode) return 'neutral';
    const mode = estimatedMode;
    if (mode.includes('ワクワク') || mode.includes('高エネルギー') || mode.includes('達成')) return 'bright';
    if (mode.includes('不安') || mode.includes('葛藤')) return 'gentle';
    if (mode.includes('疲れ') || mode.includes('低エネルギー') || mode.includes('回復') || mode.includes('没頭')) return 'calm';
    return 'neutral';
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

  private async inference(prompt: string): Promise<string> {
    if (this.inferenceFn) {
      return this.inferenceFn(prompt);
    }
    return this.claudeInference(prompt);
  }

  /** Strip lone surrogates that cause "no low surrogate in string" JSON errors */
  private stripSurrogates(s: string): string {
    return s.replace(/[\uD800-\uDFFF]/g, '');
  }

  private async claudeInference(prompt: string, modelOverride?: string): Promise<string> {
    const model = modelOverride || this.chatModel;
    const meiContext = buildInsightsContext(this.insightsPath);

    // We must pass mcpServers here so Claude SDK doesn't choke during init.
    // Read directly from mcp-servers.json or from the constructor.
    let mcpServersConfig = {};
    try {
      const fs = await import('fs');
      const join = (await import('path')).join;
      const mcpPath = join(process.cwd(), 'mcp-servers.json');
      if (fs.existsSync(mcpPath)) {
        mcpServersConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf8')).mcpServers || {};
      }
    } catch {
       // Ignore
    }

    let responseText = '';

    // Load SOUL.md if available, fall back to personality template
    let soulContent = this.systemPrompt;
    try {
      const soulPath = join(dirname(this.statePath), this.botId, 'SOUL.md');
      if (existsSync(soulPath)) {
        soulContent = readFileSync(soulPath, 'utf-8');
      }
    } catch {
      // Fall back to personality template
    }

    // Load MEMORY.md if available
    let memoryContent = '';
    try {
      const memoryPath = join(dirname(this.statePath), this.botId, 'MEMORY.md');
      if (existsSync(memoryPath)) {
        memoryContent = '\n\n## あなたの記憶\n' + readFileSync(memoryPath, 'utf-8');
      }
    } catch {
      // Ignore
    }

    const systemPromptStr = this.stripSurrogates(
      soulContent + memoryContent + '\n\n## 現在時刻\n' + getDateTimeInTz(new Date(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }) + ' (' + getTimezone() + ')' + '\n\n' + meiContext
    );
    const options: any = {
      outputFormat: 'stream-json',
      permissionMode: 'bypassPermissions',
      cwd: process.env.BASE_DIRECTORY || process.cwd(),
      model,
      appendSystemPrompt: systemPromptStr,
    };
    
    if (Object.keys(mcpServersConfig).length > 0) {
      options.mcpServers = mcpServersConfig;
    }

    try {
      for await (const message of queryWithFallback({ prompt: this.stripSurrogates(prompt), options })) {
        if (message.type === 'assistant' && (message as any).subtype === 'text') {
          responseText += (message as any).text || '';
        }
        if (message.type === 'result' && !responseText) {
          responseText = (message as any).result || '';
        }
      }
    } catch (e: any) {
      this.logger.error('query failed: ' + e.message, e);
      // If both Claude and ChatGPT fallback fail, return an empty response.
      // resolveMessage() can still synthesize a deterministic fallback message
      // when allowNoReply=false, which keeps proactive delivery alive.
      return responseText;
    }
    return responseText;
  }

  private async gatherMemoryContext(collectedData: string): Promise<string> {
    const COGMEM_CWD = process.env.COGMEM_PROJECT || '/Users/akira/workspace/ember';
    const { exec: execAsync } = await import('child_process');
    const { promisify } = await import('util');
    const execPromise = promisify(execAsync);

    const parts: string[] = [];

    // 1. Search cogmem for context-relevant memories
    try {
      const keywords = this.extractKeywords(collectedData);
      if (keywords) {
        const { stdout } = await execPromise(
          `cogmem search "${keywords}" --limit 3 --json 2>/dev/null`,
          { cwd: COGMEM_CWD, timeout: 10000 }
        );
        if (stdout.trim()) {
          const results = JSON.parse(stdout);
          if (results.results && results.results.length > 0) {
            const memories = results.results
              .filter((r: any) => r.score >= 0.7)
              .map((r: any) => `- [${r.date}] ${r.content?.substring(0, 150) || r.title || ''}`)
              .join('\n');
            if (memories) {
              parts.push(`## 記憶から浮上した関連情報\n${memories}`);
            }
          }
        }
      }
    } catch { /* non-critical */ }

    // 2. Check what happened ~1 year ago
    try {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const { readFileSync, existsSync } = await import('fs');

      // cogmem.local.toml の user_id を読み取り、user-isolated パスを優先する
      let userId = '';
      try {
        const localToml = `${COGMEM_CWD}/cogmem.local.toml`;
        if (existsSync(localToml)) {
          const tomlContent = readFileSync(localToml, 'utf-8');
          const m = tomlContent.match(/^user_id\s*=\s*"([^"]+)"/m);
          if (m) userId = m[1];
        }
      } catch { /* non-critical */ }

      // Check logs from 1 year ago ± 3 days
      for (let offset = -3; offset <= 3; offset++) {
        const checkDate = new Date(oneYearAgo);
        checkDate.setDate(checkDate.getDate() + offset);
        const dateStr = checkDate.toISOString().slice(0, 10);
        const candidates = userId
          ? [`${COGMEM_CWD}/memory/logs/${userId}/${dateStr}.md`, `${COGMEM_CWD}/memory/logs/${dateStr}.md`]
          : [`${COGMEM_CWD}/memory/logs/${dateStr}.md`];
        const logPath = candidates.find((p) => existsSync(p));
        if (logPath) {
          const content = readFileSync(logPath, 'utf-8');
          const summaryMatch = content.match(/## セッション概要\n([\s\S]*?)(?=\n## |\n---|\Z)/);
          if (summaryMatch && summaryMatch[1].trim()) {
            parts.push(`## 去年の今頃（${dateStr}）\n${summaryMatch[1].trim().substring(0, 200)}`);
            break; // Only need one
          }
        }
      }
    } catch { /* non-critical */ }

    // 3. Recent milestones and insights (last 7 days)
    try {
      const { stdout } = await execPromise(
        `cogmem search "MILESTONE INSIGHT 成果 完了 達成" --limit 3 --json 2>/dev/null`,
        { cwd: COGMEM_CWD, timeout: 10000 }
      );
      if (stdout.trim()) {
        const results = JSON.parse(stdout);
        if (results.results && results.results.length > 0) {
          const recent = results.results
            .filter((r: any) => {
              const daysDiff = (Date.now() - new Date(r.date).getTime()) / (1000 * 60 * 60 * 24);
              return daysDiff <= 7 && r.score >= 0.65;
            })
            .map((r: any) => `- [${r.date}] ${r.content?.substring(0, 150) || r.title || ''}`)
            .join('\n');
          if (recent) {
            parts.push(`## 最近のAkiraさんの成果\n${recent}`);
          }
        }
      }
    } catch { /* non-critical */ }

    // 4. Interest cache — 興味カテゴリの最新情報
    try {
      const { readFileSync, existsSync } = await import('fs');
      const cachePath = join(process.cwd(), 'data', 'interest-cache.json');
      if (existsSync(cachePath)) {
        const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
        const topItems = (cache.topItems || []).slice(0, 5);
        if (topItems.length > 0) {
          const lines = topItems.map((item: any) =>
            `- [${item.categoryLabel}] ${item.title} (score: ${item.score})`
          ).join('\n');
          parts.push(`## Akiraさんの興味に関する最新情報\n${lines}`);
        }
      }
    } catch { /* non-critical */ }

    return parts.join('\n\n');
  }

  private extractKeywords(collectedData: string): string {
    try {
      const data = JSON.parse(collectedData);
      const keywords: string[] = [];

      // From calendar events
      if (data.calendar) {
        const calText = typeof data.calendar === 'string' ? data.calendar : JSON.stringify(data.calendar);
        const eventWords = calText.match(/[A-Za-zぁ-んァ-ヶ一-龥]{2,}/g) || [];
        keywords.push(...eventWords.slice(0, 5));
      }

      // From email subjects
      if (data.gmail) {
        const mailText = typeof data.gmail === 'string' ? data.gmail : JSON.stringify(data.gmail);
        const mailWords = mailText.match(/[A-Za-zぁ-んァ-ヶ一-龥]{2,}/g) || [];
        keywords.push(...mailWords.slice(0, 3));
      }

      // Add time-based context
      const now = new Date();
      const dayOfWeek = ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜'][now.getDay()];
      keywords.push(dayOfWeek);

      return keywords.slice(0, 8).join(' ');
    } catch {
      return '';
    }
  }

  private async defaultCollectData(): Promise<string> {
    const { execFileSync } = await import('child_process');
    const scriptPath = join(process.cwd(), 'scripts', 'collect_data.py');

    const insights = loadInsights(this.insightsPath);
    const interests = insights.map((i) => i.insight).join(',');
    const args = interests ? ['--interests', interests] : [];

    try {
      const result = execFileSync('python3', [scriptPath, ...args], {
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
