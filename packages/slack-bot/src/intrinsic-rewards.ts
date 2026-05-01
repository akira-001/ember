/**
 * Intrinsic Reward Signal System
 *
 * Mission-driven internal reward signals that guide the agent's behavior
 * beyond simple user-reaction metrics. Each signal maps to one of five missions:
 *   M1: Goal Alignment
 *   M2: User Wellbeing
 *   M3: Knowledge Growth
 *   M4: Information Value
 *   M5: Relationship Building
 */

// --- Types ---

export interface IntrinsicSignal {
  id: string;
  mission: number;
  value: number;
  reason: string;
}

export interface IntrinsicRewardLog {
  signals: IntrinsicSignal[];
  immediateTotal: number;
  deferredTotal: number;
  compositeBoost: number;
}

export interface IntrinsicConfig {
  lambda: number;
  enabledSignals: string[];
}

// --- Input types ---

interface Candidate {
  category: string;
  source: string;
  topic: string;
  metadata: Record<string, unknown>;
}

interface State {
  history: Array<{
    interestCategory?: string;
    sentAt: string;
    reaction: string | null;
    preview?: string;
  }>;
  todayMessages?: Array<{ time: string; summary: string; source: string }>;
  consecutiveNoReaction?: number;
  calendarDensity?: number;
}

interface Insight {
  insight: string;
  arousal: number;
}

// --- Functions ---

/**
 * Evaluate intrinsic reward signals at send/no_reply decision time.
 */
export function computeImmediateRewards(
  candidate: Candidate | null,
  state: State,
  insights: Insight[],
  decision: 'send' | 'no_reply',
): IntrinsicSignal[] {
  const signals: IntrinsicSignal[] = [];

  // M1-a: Goal Alignment
  if (decision === 'send' && candidate) {
    const highArousalInsights = insights.filter((i) => i.arousal >= 0.7);
    const topicMatchesInsight = highArousalInsights.some(
      (i) => candidate.topic.includes(i.insight) || i.insight.includes(candidate.topic),
    );
    if (topicMatchesInsight) {
      signals.push({
        id: 'M1-a',
        mission: 1,
        value: 0.1,
        reason: 'トピックが高関心インサイトと一致',
      });
    }
  }

  // M2-a: Wellbeing Timing
  const calendarDensity = state.calendarDensity ?? 0;
  if (calendarDensity >= 2) {
    if (decision === 'no_reply') {
      signals.push({
        id: 'M2-a',
        mission: 2,
        value: 0.15,
        reason: '忙しい日に沈黙を選択',
      });
    } else if (decision === 'send' && candidate?.metadata?.emotion_type === 'light') {
      signals.push({
        id: 'M2-a',
        mission: 2,
        value: 0.15,
        reason: '忙しい日に軽いトピックを選択',
      });
    }
  }

  // M2-b: Appropriate Silence
  if (decision === 'no_reply' && (state.consecutiveNoReaction ?? 0) >= 2) {
    signals.push({
      id: 'M2-b',
      mission: 2,
      value: 0.1,
      reason: '無反応が続く中で送信を控えた',
    });
  }

  // M4-a: Information Novelty
  if (decision === 'send' && candidate) {
    const recentHistory = state.history.slice(-20);
    const isNovel = !recentHistory.some(
      (h) => h.preview && h.preview.includes(candidate.topic),
    );
    if (isNovel) {
      signals.push({
        id: 'M4-a',
        mission: 4,
        value: 0.1,
        reason: '過去に送信していない新しいトピック',
      });
    }
  }

  // M4-b: Cross-Domain Connection
  if (decision === 'send' && candidate && candidate.category.startsWith('_')) {
    signals.push({
      id: 'M4-b',
      mission: 4,
      value: 0.05,
      reason: 'クロスドメイン接続による意外性',
    });
  }

  return signals;
}

/**
 * Evaluate intrinsic reward signals after user responds.
 */
export function computeDeferredRewards(
  replyType: 'text' | 'reaction' | 'none',
  newInsightAcquired: boolean,
  replyCount: number,
): IntrinsicSignal[] {
  const signals: IntrinsicSignal[] = [];

  // M3-a: New Insight Acquired
  if (newInsightAcquired) {
    signals.push({
      id: 'M3-a',
      mission: 3,
      value: 0.2,
      reason: '新しいインサイトを獲得',
    });
  }

  // M3-b: Insight Reinforced — externally triggered, not evaluated here

  // M5-a: Conversation Elicited
  if (replyType === 'text') {
    signals.push({
      id: 'M5-a',
      mission: 5,
      value: 0.1,
      reason: 'テキスト返信を引き出した',
    });
  }

  // M5-b: Deep Engagement
  if (replyCount >= 2) {
    signals.push({
      id: 'M5-b',
      mission: 5,
      value: 0.15,
      reason: '複数ターンの会話を引き出した',
    });
  }

  return signals;
}

/**
 * Compute the final intrinsic boost value.
 * Sums all signal values, multiplies by lambda, and clamps to [-0.3, +0.5].
 */
export function computeIntrinsicBoost(signals: IntrinsicSignal[], lambda: number): number {
  const sum = signals.reduce((acc, s) => acc + s.value, 0);
  const raw = sum * lambda;
  return Math.min(0.5, Math.max(-0.3, raw));
}

/**
 * Returns the default intrinsic reward configuration.
 */
export function createDefaultIntrinsicConfig(): IntrinsicConfig {
  return {
    lambda: 0.3,
    enabledSignals: ['M1-a', 'M2-a', 'M2-b', 'M3-a', 'M3-b', 'M4-a', 'M4-b', 'M5-a', 'M5-b', 'R1', 'R2', 'R3', 'R4', 'R5', 'L1-collect', 'L2-collect', 'L3-collect', 'L4-collect', 'L5-collect', 'L-action'],
  };
}

/**
 * Filters signals to only those enabled in the config.
 */
export function filterEnabledSignals(
  signals: IntrinsicSignal[],
  config: IntrinsicConfig,
): IntrinsicSignal[] {
  return signals.filter((s) => config.enabledSignals.includes(s.id));
}

// --- Layer Reward Signals — Self-Actualization Engine ---

export interface LayerRewardSignalDef {
  id: string;
  mission: string;
  description: string;
  defaultValue: number;
}

export const LAYER_REWARD_SIGNALS = {
  'L1-collect': { id: 'L1-collect', mission: 'identity', description: 'Layer 1 (Identity) information collected', defaultValue: 0.05 },
  'L2-collect': { id: 'L2-collect', mission: 'vision', description: 'Layer 2 (Vision) information collected', defaultValue: 0.25 },
  'L3-collect': { id: 'L3-collect', mission: 'strategy', description: 'Layer 3 (Strategy) information collected', defaultValue: 0.20 },
  'L4-collect': { id: 'L4-collect', mission: 'execution', description: 'Layer 4 (Execution) information collected', defaultValue: 0.10 },
  'L5-collect': { id: 'L5-collect', mission: 'state', description: 'Layer 5 (State) information collected', defaultValue: 0.05 },
  'L-action': { id: 'L-action', mission: 'self-actualization', description: 'User reported forward action toward goals', defaultValue: 0.15 },
} as const;

export type LayerRewardSignalId = keyof typeof LAYER_REWARD_SIGNALS;

export interface LayerCollectionConfig {
  layerWeights: Record<string, number>;
  actionReward: number;
}

/**
 * Compute layer reward value, using user-profile.json collectionConfig weights if available.
 * Falls back to defaultValue if config not found.
 */
export function computeLayerReward(signalId: string, collectionConfig?: LayerCollectionConfig): number {
  const signal = LAYER_REWARD_SIGNALS[signalId as LayerRewardSignalId];
  if (!signal) return 0;

  if (collectionConfig) {
    if (signalId === 'L-action') return collectionConfig.actionReward ?? signal.defaultValue;
    const layerKey = signalId.replace('-collect', '').toUpperCase(); // L1, L2, etc
    return collectionConfig.layerWeights?.[layerKey] ?? signal.defaultValue;
  }

  return signal.defaultValue;
}

// --- Deep Reward Analysis (Local LLM via config) ---

import { getLocalModelsConfig } from './bot-config.js';

function getChatInferenceConfig() {
  const cfg = getLocalModelsConfig();
  const jobCfg = cfg.jobs?.['deep-reward-analysis'];

  if (jobCfg?.backend === 'ollama') {
    return {
      url: cfg.ollama.url + '/v1/chat/completions',
      model: jobCfg.model || 'qwen3:32b',
      timeoutMs: cfg.mlx.timeoutMs,
    };
  }
  // default: mlx
  return {
    url: cfg.mlx.url,
    model: jobCfg?.model || cfg.mlx.model,
    timeoutMs: cfg.mlx.timeoutMs,
  };
}

export interface ReplyAnalysisResult {
  type: 'self_actualization' | 'wellbeing' | 'new_information' | 'discovery' | 'values';
  detail: string;
  confidence: number;
}

export interface ProfileUpdateDetection {
  field: string;       // e.g., "vision.futureState"
  layer: number;       // 1-5
  value: string;       // extracted value
  confidence: 'high' | 'medium' | 'low';
}

export interface ReplyAnalysisResponse {
  signals: IntrinsicSignal[];
  profileUpdate: ProfileUpdateDetection | null;
}

const REPLY_SIGNAL_MAP: Record<string, { id: string; mission: number; value: number }> = {
  self_actualization: { id: 'R1', mission: 1, value: 0.15 },
  wellbeing:          { id: 'R2', mission: 2, value: 0.1 },
  new_information:    { id: 'R3', mission: 3, value: 0.2 },
  discovery:          { id: 'R4', mission: 4, value: 0.1 },
  values:             { id: 'R5', mission: 5, value: 0.15 },
};

/**
 * Analyze user reply text using local MLX LLM to evaluate mission achievement.
 * Returns IntrinsicSignal[] and optional ProfileUpdateDetection based on reply content analysis.
 * Falls back to empty signals and null profileUpdate if MLX is unavailable.
 *
 * @param informationGap - The information gap from the conversation premise (if any).
 *   When provided, the LLM will also check if the user's reply answers this gap.
 */
export async function analyzeReplyForMissions(
  userReply: string,
  agentMessage: string,
  informationGap?: string | null,
): Promise<ReplyAnalysisResponse> {
  if (!userReply || userReply.trim().length < 3) return { signals: [], profileUpdate: null };

  const profileUpdateSection = informationGap
    ? `

## プロファイル更新検知

エージェントのメッセージに informationGap が設定されています: "${informationGap}"

ユーザーの返信がこの情報ギャップに対する回答を含んでいるか判定してください。
含んでいる場合:
- field: 更新すべきフィールド名（例: "vision.futureState"）
- layer: レイヤー番号（1-5）
- value: 抽出した値
- confidence: "high"（明言）/ "medium"（示唆）/ "low"（推測）

含んでいない場合: profileUpdate = null`
    : '';

  const profileUpdateExample = informationGap
    ? ', "profileUpdate": {"field": "vision.futureState", "layer": 2, "value": "AIエージェントで業務自動化", "confidence": "high"}'
    : ', "profileUpdate": null';

  const prompt = `ユーザーの返信を分析し、該当する観点のみJSONで返してください。

エージェントのメッセージ: ${agentMessage.slice(0, 200)}
ユーザーの返信: ${userReply.slice(0, 300)}

観点:
1. self_actualization: 前向きな行動・決意・成長（「やってみる」「申し込んだ」「始めた」）
2. wellbeing: 感謝・安心・リラックス（「助かる」「ちょうどよかった」「ありがとう」）
3. new_information: エージェントが知らない新事実（「実は〜」「〜になった」「〜に変わった」）
4. discovery: 驚き・発見（「知らなかった」「へー」「マジか」「そうなんだ」）
5. values: 好み・価値観の表明（「〜が好き」「〜は興味ない」「やっぱり〜」）
${profileUpdateSection}

JSON形式で返してください。該当なしなら空配列:
/no_think
{"results": [{"type": "new_information", "detail": "猫の検査結果が良好", "confidence": 0.8}]${profileUpdateExample}}`;

  try {
    const mlxCfg = getChatInferenceConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), mlxCfg.timeoutMs);

    const response = await fetch(mlxCfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: mlxCfg.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 300,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return { signals: [], profileUpdate: null };

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || '';

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*"results"[\s\S]*\}/);
    if (!jsonMatch) return { signals: [], profileUpdate: null };

    const parsed = JSON.parse(jsonMatch[0]) as {
      results: ReplyAnalysisResult[];
      profileUpdate?: ProfileUpdateDetection | null;
    };
    if (!Array.isArray(parsed.results)) return { signals: [], profileUpdate: null };

    // Convert to IntrinsicSignal[]
    const signals = parsed.results
      .filter(r => r.confidence >= 0.6 && REPLY_SIGNAL_MAP[r.type])
      .map(r => ({
        id: REPLY_SIGNAL_MAP[r.type].id,
        mission: REPLY_SIGNAL_MAP[r.type].mission,
        value: REPLY_SIGNAL_MAP[r.type].value * r.confidence,
        reason: r.detail || `返信分析: ${r.type}`,
      }));

    // Validate profileUpdate if present
    let profileUpdate: ProfileUpdateDetection | null = null;
    if (parsed.profileUpdate && parsed.profileUpdate.field && parsed.profileUpdate.value) {
      const pu = parsed.profileUpdate;
      if (pu.layer >= 1 && pu.layer <= 5 && ['high', 'medium', 'low'].includes(pu.confidence)) {
        profileUpdate = {
          field: pu.field,
          layer: pu.layer,
          value: pu.value,
          confidence: pu.confidence,
        };
      }
    }

    return { signals, profileUpdate };
  } catch {
    // MLX unavailable or timeout — silent fallback
    return { signals: [], profileUpdate: null };
  }
}
