/**
 * Conversation Profiles — control topic category weighting per bot.
 * Each profile applies multipliers to scoring categories, so bots
 * naturally pick different topics without explicit coordination.
 */

export type ProfileType = 'business' | 'lifestyle' | 'balanced' | 'growth' | 'wellbeing';

export interface ConversationProfile {
  type: ProfileType;
  label: string;
  description: string;
  multipliers: Record<string, number>;  // category -> multiplier
}

// Category -> group mapping
const CATEGORY_GROUPS: Record<string, string[]> = {
  business: ['ai_agent', 'business_strategy', 'ma_startup', 'dev_tools', 'llm_local'],
  lifestyle: ['dodgers', 'golf', 'campingcar', 'onsen', 'food_dining', 'local_tokorozawa'],
  health: ['cat_health', 'weather_seasonal'],
  exploration: ['_wildcard', '_cross', '_discovery'],
};

function buildMultipliers(groupWeights: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [group, categories] of Object.entries(CATEGORY_GROUPS)) {
    const weight = groupWeights[group] ?? 1.0;
    for (const cat of categories) {
      result[cat] = weight;
    }
  }
  return result;
}

export const PROFILES: Record<ProfileType, ConversationProfile> = {
  business: {
    type: 'business',
    label: '自己実現型',
    description: 'ビジネス・経営戦略・AI開発を重視',
    multipliers: buildMultipliers({ business: 1.5, lifestyle: 0.5, health: 0.8, exploration: 1.0 }),
  },
  lifestyle: {
    type: 'lifestyle',
    label: 'プライベート支援型',
    description: '趣味・スポーツ・レジャーを重視',
    multipliers: buildMultipliers({ business: 0.5, lifestyle: 1.5, health: 1.2, exploration: 0.8 }),
  },
  balanced: {
    type: 'balanced',
    label: 'バランス型',
    description: '全カテゴリ均等（デフォルト）',
    multipliers: buildMultipliers({ business: 1.0, lifestyle: 1.0, health: 1.0, exploration: 1.0 }),
  },
  growth: {
    type: 'growth',
    label: '成長促進型',
    description: '新発見・チャレンジ・探索を重視',
    multipliers: buildMultipliers({ business: 1.0, lifestyle: 0.8, health: 0.8, exploration: 1.8 }),
  },
  wellbeing: {
    type: 'wellbeing',
    label: 'ウェルビーイング型',
    description: '健康・休息・リラックスを重視',
    multipliers: buildMultipliers({ business: 0.5, lifestyle: 1.0, health: 1.8, exploration: 0.8 }),
  },
};

/**
 * Get the score multiplier for a category based on profile.
 * Returns 1.0 for unknown categories (no penalty).
 */
export function getProfileMultiplier(profileType: ProfileType, category: string): number {
  const profile = PROFILES[profileType];
  if (!profile) return 1.0;
  return profile.multipliers[category] ?? 1.0;
}

/**
 * Get profile description for prompt injection.
 */
export function getProfilePromptSection(profileType: ProfileType): string {
  const profile = PROFILES[profileType];
  if (!profile || profileType === 'balanced') return '';

  const heavy = Object.entries(profile.multipliers)
    .filter(([_, v]) => v >= 1.3)
    .map(([k]) => k);
  const light = Object.entries(profile.multipliers)
    .filter(([_, v]) => v <= 0.7)
    .map(([k]) => k);

  let section = `\n## 会話プロファイル: ${profile.label}\n${profile.description}\n`;
  if (heavy.length) section += `重視: ${heavy.join(', ')}\n`;
  if (light.length) section += `控えめ: ${light.join(', ')}\n`;
  return section;
}
