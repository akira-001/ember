import { useEffect, useState } from 'react';
import { getProactiveStats, getProactiveHistory, getProactiveInterests, getProactiveConfig, updateProactiveConfig, restartBot, runProactiveNow, updateLearningState, resetLearningState, updateProactiveState, updateIntrinsicConfig, getEventSources, updateEventSource, getIntentionalPause, updateIntentionalPause, getCalendarList } from '../api';
import type { ScoredCandidateResponse, LearningStateResponse } from '../api';
import { useBotContext } from '../components/BotContext';
import CronEditor from '../components/CronEditor';
import { tz } from '../timezone';


const INTEREST_LABELS: Record<string, string> = {
  ai_agent: 'AI エージェント',
  llm_local: 'ローカルLLM',
  dodgers: 'ドジャース',
  campingcar: 'キャンピングカー',
  onsen: '温泉',
  golf: 'ゴルフ',
  cat_health: '猫の健康',
  business_strategy: '経営・M&A',
  local_tokorozawa: '所沢・地域',
  general: 'その他',
};

const INTEREST_COLORS: Record<string, string> = {
  ai_agent: '#6366f1',
  llm_local: '#8b5cf6',
  dodgers: '#3b82f6',
  campingcar: '#f59e0b',
  onsen: '#ef4444',
  golf: '#22c55e',
  cat_health: '#ec4899',
  business_strategy: '#06b6d4',
  local_tokorozawa: '#84cc16',
  general: '#6b7280',
};

const AXIS_LABELS: Record<string, string> = {
  timeliness: '旬',
  novelty: '新鮮さ',
  continuity: '流れ',
  emotional_fit: '状態',
  affinity: '好み',
  surprise: '意外性',
};

const AXIS_COLORS: Record<string, string> = {
  timeliness: 'var(--accent)',
  novelty: 'var(--success)',
  continuity: 'var(--info)',
  emotional_fit: 'var(--warning)',
  affinity: 'var(--accent-light)',
  surprise: 'var(--error)',
};

const AXES = ['timeliness', 'novelty', 'continuity', 'emotional_fit', 'affinity', 'surprise'] as const;

function SixAxisBar({ scores }: { scores: Record<string, number> }) {
  return (
    <div className="grid grid-cols-6 gap-1">
      {AXES.map(axis => (
        <div key={axis} className="flex flex-col items-center">
          <div className="w-full h-3 bg-[var(--bg)] rounded overflow-hidden">
            <div
              className="h-full rounded"
              style={{
                width: `${(scores[axis] || 0) * 100}%`,
                backgroundColor: AXIS_COLORS[axis],
              }}
            />
          </div>
          <span className="text-[9px] text-[var(--text-dim)] mt-0.5">{AXIS_LABELS[axis]}</span>
        </div>
      ))}
    </div>
  );
}

function ScoredCandidatesList({ candidates }: { candidates: ScoredCandidateResponse[] }) {
  if (!candidates || candidates.length === 0) return null;

  return (
    <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
      <h3 className="text-sm font-semibold text-[var(--text)] mb-3">スコアリング結果（6軸内訳）</h3>
      <div className="space-y-3">
        {candidates.map((c, i) => {
          const hasExploration = (c.explorationBonus || 0) > 0.01;
          return (
            <div key={i} className="bg-[var(--bg)] rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-[var(--text-dim)] w-5">#{i + 1}</span>
                <span className="text-sm text-[var(--text)] font-medium truncate flex-1" title={c.topic}>
                  {c.topic.length > 30 ? c.topic.slice(0, 30) + '...' : c.topic}
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--border)]/50 text-[var(--text-dim)]">{c.source}</span>
                <span className="text-xs font-mono tabular-nums text-[var(--text)]">
                  {c.finalScore.toFixed(2)}
                </span>
                {hasExploration && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)]" title="探索ボーナス">
                    {c.finalScore.toFixed(2)} + {(c.explorationBonus || 0).toFixed(2)} = {(c.selectionScore || c.finalScore).toFixed(2)}
                  </span>
                )}
              </div>
              <SixAxisBar scores={c.scores} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LearningStateSection({ learningState, botId, onUpdate }: {
  learningState: LearningStateResponse | null;
  botId: string;
  onUpdate: (ls: LearningStateResponse) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editPriors, setEditPriors] = useState<Record<string, { alpha: string; beta: string }>>({});
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null); // axis name or 'all'

  if (!learningState) return null;

  const minutesAgo = learningState.lastUpdated
    ? Math.round((Date.now() - new Date(learningState.lastUpdated).getTime()) / 60000)
    : null;

  const startEdit = () => {
    const priors: Record<string, { alpha: string; beta: string }> = {};
    for (const axis of AXES) {
      const p = learningState.priors[axis];
      if (p) priors[axis] = { alpha: p.alpha.toFixed(1), beta: p.beta.toFixed(1) };
    }
    setEditPriors(priors);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditPriors({});
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const priors: Record<string, { alpha: number; beta: number }> = {};
      for (const [axis, vals] of Object.entries(editPriors)) {
        const a = parseFloat(vals.alpha);
        const b = parseFloat(vals.beta);
        if (!isNaN(a) && !isNaN(b) && a >= 0.1 && b >= 0.1) {
          priors[axis] = { alpha: a, beta: b };
        }
      }
      const result = await updateLearningState(botId, priors);
      onUpdate(result.learningState);
      setEditing(false);
    } catch (e) {
      alert(`保存エラー: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (axis?: string) => {
    const target = axis ? `${AXIS_LABELS[axis]}` : '全軸';
    if (!confirm(`${target}の学習をリセットしますか？`)) return;
    setResetting(axis || 'all');
    try {
      const result = await resetLearningState(botId, axis);
      onUpdate(result.learningState);
      if (editing) cancelEdit();
    } catch (e) {
      alert(`リセットエラー: ${e}`);
    } finally {
      setResetting(null);
    }
  };

  const updateAxisPrior = (axis: string, field: 'alpha' | 'beta', value: string) => {
    setEditPriors(prev => ({
      ...prev,
      [axis]: { ...prev[axis], [field]: value },
    }));
  };

  return (
    <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--text)]">学習状態（Thompson Sampling）</h3>
        <div className="flex gap-2">
          {!editing ? (
            <>
              <button
                onClick={startEdit}
                className="text-xs px-2 py-1 rounded border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors"
              >
                編集
              </button>
              <button
                onClick={() => handleReset()}
                disabled={resetting === 'all'}
                className="text-xs px-2 py-1 rounded border border-[var(--error)] text-[var(--error)] hover:bg-[var(--error)] hover:text-white transition-colors disabled:opacity-50"
              >
                {resetting === 'all' ? 'リセット中...' : '全リセット'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="text-xs px-3 py-1 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
              <button
                onClick={cancelEdit}
                className="text-xs px-2 py-1 rounded border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
              >
                キャンセル
              </button>
            </>
          )}
        </div>
      </div>
      <div className="space-y-2">
        {AXES.map(axis => {
          const prior = learningState.priors[axis];
          if (!prior) return null;
          const mean = prior.alpha / (prior.alpha + prior.beta);
          const n = prior.alpha + prior.beta + 1;
          const ci = 1.96 * Math.sqrt(mean * (1 - mean) / n);
          const ciLow = Math.max(0, mean - ci);
          const ciHigh = Math.min(1, mean + ci);

          return (
            <div key={axis} className="flex items-center gap-2">
              <div className="w-14 text-xs text-[var(--text-dim)]">{AXIS_LABELS[axis]}</div>
              <div className="flex-1 h-5 bg-[var(--bg)] rounded overflow-hidden relative">
                <div
                  className="absolute h-full opacity-20 rounded"
                  style={{
                    left: `${ciLow * 100}%`,
                    width: `${(ciHigh - ciLow) * 100}%`,
                    backgroundColor: AXIS_COLORS[axis],
                  }}
                />
                <div
                  className="h-full rounded relative z-10"
                  style={{
                    width: `${mean * 100}%`,
                    backgroundColor: AXIS_COLORS[axis],
                  }}
                />
              </div>
              {editing ? (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[var(--text-dim)]">α</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={editPriors[axis]?.alpha || ''}
                    onChange={e => updateAxisPrior(axis, 'alpha', e.target.value)}
                    className="w-14 text-[11px] font-mono px-1 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] text-right focus:border-[var(--accent)] outline-none"
                  />
                  <span className="text-[10px] text-[var(--text-dim)]">β</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={editPriors[axis]?.beta || ''}
                    onChange={e => updateAxisPrior(axis, 'beta', e.target.value)}
                    className="w-14 text-[11px] font-mono px-1 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] text-right focus:border-[var(--accent)] outline-none"
                  />
                  <button
                    onClick={() => handleReset(axis)}
                    disabled={resetting === axis}
                    className="text-[10px] px-1.5 py-0.5 rounded text-[var(--error)] hover:bg-[var(--error)] hover:text-white transition-colors"
                    title={`${AXIS_LABELS[axis]}をリセット`}
                  >
                    ↺
                  </button>
                </div>
              ) : (
                <div className="w-48 text-[10px] font-mono tabular-nums text-[var(--text-dim)] text-right">
                  α={prior.alpha.toFixed(1)} β={prior.beta.toFixed(1)} E={mean.toFixed(2)} [{ciLow.toFixed(2)},{ciHigh.toFixed(2)}]
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs text-[var(--text-dim)]">
          学習回数: {learningState.totalSelections}回
          {minutesAgo !== null && ` | 最終更新: ${minutesAgo < 60 ? `${minutesAgo}分前` : `${Math.round(minutesAgo / 60)}時間前`}`}
          {` | v${learningState.version}`}
        </div>
        {learningState.totalSelections > 0 && !editing && (
          <div className="text-[10px] text-[var(--text-dim)]">
            カテゴリ選択: {Object.entries(learningState.categorySelections)
              .sort(([,a], [,b]) => b - a)
              .slice(0, 5)
              .map(([cat, n]) => `${cat}(${n})`)
              .join(' ')}
          </div>
        )}
      </div>
    </div>
  );
}

function WeightsBreakdown({ decisionLog }: { decisionLog: any }) {
  if (!decisionLog?.sampledRaw || !decisionLog?.weightsUsed) return null;

  const sampledRaw: Record<string, number> = decisionLog.sampledRaw;
  const contextBonus: Record<string, number> = decisionLog.contextBonus || {};
  const finalWeights: Record<string, number> = decisionLog.weightsUsed;

  const bonusLabels: Record<string, string> = {
    timeliness: '朝',
    emotional_fit: '週末',
    continuity: '会話中',
  };

  return (
    <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
      <h3 className="text-sm font-semibold text-[var(--text)] mb-3">今回の重み配分</h3>
      <div className="space-y-1.5">
        {AXES.map(axis => {
          const raw = sampledRaw[axis] || 0;
          const bonus = contextBonus[axis] || 0;
          const final_ = finalWeights[axis] || 0;
          const hasBonus = Math.abs(bonus) > 0.001;

          return (
            <div key={axis} className="flex items-center gap-2 text-xs">
              <div className="w-14 text-[var(--text-dim)]">{AXIS_LABELS[axis]}</div>
              <div className="flex-1 font-mono tabular-nums text-[var(--text)]">
                {raw.toFixed(2)}
                {hasBonus && (
                  <span className="text-[var(--accent)]">
                    {' '}+ {bonus.toFixed(2)}
                    {bonusLabels[axis] && <span className="text-[var(--text-dim)]"> ({bonusLabels[axis]})</span>}
                  </span>
                )}
                {' '} = <span className="font-semibold">{final_.toFixed(2)}</span>
              </div>
              <div className="w-20 h-3 bg-[var(--bg)] rounded overflow-hidden">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${Math.min(final_ * 100, 100)}%`,
                    backgroundColor: AXIS_COLORS[axis],
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-4">
      <div className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium mb-1">{label}</div>
      <div className="text-2xl font-bold tabular-nums text-[var(--text)]">{value}</div>
      {sub && <div className="text-xs text-[var(--text-dim)] mt-1">{sub}</div>}
    </div>
  );
}

const MODE_LABELS: Record<string, string> = {
  '没頭モード': '🔥 没頭', '探索モード': '🤔 探索', '葛藤モード': '😤 葛藤',
  '不安モード': '😰 不安', '停滞モード': '😶 停滞', '達成モード': '🎉 達成',
};

const LAYER_LABELS: Record<number, string> = {
  1: 'Identity', 2: 'Vision', 3: 'Strategy', 4: 'Execution', 5: 'State',
};

function PremiseDisplay({ premise }: { premise: any }) {
  if (!premise) return null;

  return (
    <div className="mt-4 p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
      <div className="text-xs font-semibold text-[var(--text)] mb-2 uppercase tracking-[0.05em]">会話の前提</div>
      <div className="space-y-2 text-xs">
        <div className="flex items-start gap-2">
          <span className="text-[var(--text)] font-medium shrink-0 w-12">モード</span>
          <div>
            <span className="text-[var(--text)]">{MODE_LABELS[premise.estimatedMode] || premise.estimatedMode}</span>
            {premise.modeReason && <div className="text-[var(--text-dim)] mt-0.5">{premise.modeReason}</div>}
          </div>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-[var(--text)] font-medium shrink-0 w-12">Layer</span>
          <div>
            <span className="text-[var(--text)]">{premise.targetLayer} — {LAYER_LABELS[premise.targetLayer] || `Layer ${premise.targetLayer}`}</span>
            {premise.layerReason && <div className="text-[var(--text-dim)] mt-0.5">{premise.layerReason}</div>}
          </div>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-[var(--text)] font-medium shrink-0 w-12">介入</span>
          <div>
            <span className="text-[var(--text)]">{premise.interventionType}</span>
            {premise.interventionReason && <div className="text-[var(--text-dim)] mt-0.5">{premise.interventionReason}</div>}
          </div>
        </div>
        {premise.informationGap && (
          <div className="flex items-start gap-2">
            <span className="text-[var(--accent)] font-medium shrink-0 w-12">収集</span>
            <div>
              <span className="text-[var(--text)]">{premise.informationGap}</span>
              {premise.collectionHint && <div className="text-[var(--text-dim)] mt-0.5">{premise.collectionHint}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const PROFILE_OPTIONS = [
  { value: 'business', label: '自己実現型', desc: 'ビジネス・経営戦略・AI開発を重視', groups: { 'ビジネス系': 1.5, '趣味系': 0.5, '健康系': 0.8, '探索系': 1.0 } },
  { value: 'lifestyle', label: 'プライベート支援型', desc: '趣味・スポーツ・レジャーを重視', groups: { 'ビジネス系': 0.5, '趣味系': 1.5, '健康系': 1.2, '探索系': 0.8 } },
  { value: 'balanced', label: 'バランス型', desc: '全カテゴリ均等（デフォルト）', groups: { 'ビジネス系': 1.0, '趣味系': 1.0, '健康系': 1.0, '探索系': 1.0 } },
  { value: 'growth', label: '成長促進型', desc: '新発見・チャレンジ・探索を重視', groups: { 'ビジネス系': 1.0, '趣味系': 0.8, '健康系': 0.8, '探索系': 1.8 } },
  { value: 'wellbeing', label: 'ウェルビーイング型', desc: '健康・休息・リラックスを重視', groups: { 'ビジネス系': 0.5, '趣味系': 1.0, '健康系': 1.8, '探索系': 0.8 } },
] as const;

function ConversationProfileSelector({ currentProfile, botId, onUpdate }: {
  currentProfile: string;
  botId: string;
  onUpdate: (profile: string) => void;
}) {
  const selected = PROFILE_OPTIONS.find(p => p.value === currentProfile) || PROFILE_OPTIONS[2];

  const handleChange = async (value: string) => {
    try {
      await updateProactiveState(botId, { conversationProfile: value } as any);
      onUpdate(value);
    } catch (e) {
      alert(`保存エラー: ${e}`);
    }
  };

  return (
    <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
      <h3 className="text-sm font-semibold text-[var(--text)] mb-3">会話プロファイル</h3>
      <div className="flex gap-2 mb-4 flex-wrap">
        {PROFILE_OPTIONS.map(p => (
          <button
            key={p.value}
            onClick={() => handleChange(p.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              currentProfile === p.value
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg)] text-[var(--text-dim)] hover:text-[var(--text)] border border-[var(--border)]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-[var(--text-dim)] mb-3">{selected.desc}</p>
      <div className="space-y-1.5">
        {Object.entries(selected.groups).map(([group, mult]) => (
          <div key={group} className="flex items-center gap-2">
            <span className="w-20 text-xs text-[var(--text-dim)]">{group}</span>
            <div className="flex-1 h-4 bg-[var(--bg)] rounded overflow-hidden">
              <div
                className="h-full rounded"
                style={{
                  width: `${Math.min(mult / 2 * 100, 100)}%`,
                  backgroundColor: mult >= 1.3 ? 'var(--accent)' : mult <= 0.7 ? 'var(--error)' : 'var(--text-dim)',
                  opacity: mult <= 0.7 ? 0.5 : 1,
                }}
              />
            </div>
            <span className="w-10 text-xs font-mono text-right text-[var(--text-dim)]">{mult}x</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryWithPremise({ history }: { history: any[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
      <h3 className="text-sm font-semibold text-[var(--text)] mb-3">配信履歴</h3>
      {history.length === 0 ? (
        <div className="text-[var(--text-dim)] text-sm">履歴なし</div>
      ) : (
        <div className="space-y-1">
          {history.map((h: any, i: number) => (
            <div key={i}>
              <div
                className={`flex items-center gap-3 py-2 px-2 rounded cursor-pointer transition-colors ${
                  expandedIdx === i ? 'bg-[var(--bg)]' : 'hover:bg-[var(--bg)]/50'
                }`}
                onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
              >
                <span className="text-[var(--text-dim)] font-mono text-xs whitespace-nowrap">
                  {new Date(h.sentAt).toLocaleString('ja-JP', { timeZone: tz(), month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                {h.interestCategory ? (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: (INTEREST_COLORS[h.interestCategory] || '#6b7280') + '33',
                      color: INTEREST_COLORS[h.interestCategory] || '#6b7280',
                    }}
                  >
                    {INTEREST_LABELS[h.interestCategory] || h.interestCategory}
                  </span>
                ) : (
                  <span className="text-[10px] text-[var(--text-dim)]">{h.category}</span>
                )}
                <span className="text-xs text-[var(--text)] truncate flex-1">{h.preview || '—'}</span>
                <ReactionBadge reaction={h.reaction} delta={h.reactionDelta} />
                {(h.premise || h.intrinsicReward || h.rewardLog?.length) && (
                  <span className="text-[10px] text-[var(--accent)]">{expandedIdx === i ? '▼' : '▶'}</span>
                )}
              </div>
              {expandedIdx === i && (
                <div className="ml-4 mb-2">
                  {h.premise && <PremiseDisplay premise={h.premise} />}
                  {h.intrinsicReward?.signals?.length > 0 && (
                    <div className="mt-2 p-2 bg-[var(--bg)] rounded text-xs text-[var(--text-dim)]">
                      <span className="font-semibold text-[var(--text)]">内発的報酬:</span>{' '}
                      {h.intrinsicReward.signals.map((s: any) => `${s.id}(${s.reason})`).join(', ')}
                      {h.intrinsicReward.compositeBoost > 0 && (
                        <span className="text-[var(--accent)]"> [boost: +{h.intrinsicReward.compositeBoost.toFixed(2)}]</span>
                      )}
                    </div>
                  )}
                  {h.rewardLog?.length > 0 && (
                    <div className="mt-2 p-3 bg-[var(--bg)] rounded">
                      <div className="text-xs font-semibold text-[var(--text)] mb-2">報酬ログ</div>
                      <div className="space-y-1.5">
                        {h.rewardLog.map((r: any, ri: number) => (
                          <div key={ri} className="flex items-center gap-2 text-xs">
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                              r.type === 'reaction' ? 'bg-[var(--accent)]/15 text-[var(--accent)]' :
                              r.type === 'profile_collect' ? 'bg-[var(--success)]/15 text-[var(--success)]' :
                              'bg-[var(--info)]/15 text-[var(--info)]'
                            }`}>
                              {r.type === 'reaction' ? '\u{1F60A}' : r.type === 'profile_collect' ? '\u{1F4CB}' : '\u{1F4AC}'} {r.signal}
                            </span>
                            <span className={`font-mono ${r.value >= 0 ? 'text-[var(--success)]' : 'text-[var(--error)]'}`}>
                              {r.value >= 0 ? '+' : ''}{r.value.toFixed(2)}
                            </span>
                            <span className="text-[var(--text-dim)] truncate">{r.reason}</span>
                            <span className="text-[var(--text-dim)] font-mono shrink-0 ml-auto">
                              {new Date(r.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!h.premise && !h.intrinsicReward?.signals?.length && !h.rewardLog?.length && (
                    <div className="mt-1 p-2 text-xs text-[var(--text-dim)]">詳細データなし（premise 導入前の履歴）</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SIGNAL_META: Record<string, { label: string; mission: number; missionLabel: string; value: string; isMLX?: boolean }> = {
  'M1-a': { label: 'Goal Alignment', mission: 1, missionLabel: '自己実現支援', value: '+0.10' },
  'M2-a': { label: 'Wellbeing Timing', mission: 2, missionLabel: '心身の健康', value: '+0.15' },
  'M2-b': { label: 'Appropriate Silence', mission: 2, missionLabel: '心身の健康', value: '+0.10' },
  'M3-a': { label: 'New Insight Acquired', mission: 3, missionLabel: '情報収集', value: '+0.20' },
  'M3-b': { label: 'Insight Reinforced', mission: 3, missionLabel: '情報収集', value: '+0.10' },
  'M4-a': { label: 'Information Novelty', mission: 4, missionLabel: '情報提供', value: '+0.10' },
  'M4-b': { label: 'Cross-Domain Connection', mission: 4, missionLabel: '情報提供', value: '+0.05' },
  'M5-a': { label: 'Conversation Elicited', mission: 5, missionLabel: '価値観理解', value: '+0.10' },
  'M5-b': { label: 'Deep Engagement', mission: 5, missionLabel: '価値観理解', value: '+0.15' },
  'R1':   { label: 'Self-Actualization', mission: 1, missionLabel: '自己実現支援', value: '+0.15', isMLX: true },
  'R2':   { label: 'Wellbeing Response', mission: 2, missionLabel: '心身の健康', value: '+0.10', isMLX: true },
  'R3':   { label: 'New Information', mission: 3, missionLabel: '情報収集', value: '+0.20', isMLX: true },
  'R4':   { label: 'Discovery Reaction', mission: 4, missionLabel: '情報提供', value: '+0.10', isMLX: true },
  'R5':   { label: 'Values Expression', mission: 5, missionLabel: '価値観理解', value: '+0.15', isMLX: true },
  'L1-collect': { label: 'Identity情報収集', mission: 1, missionLabel: '自己実現支援', value: '+0.05' },
  'L2-collect': { label: 'Vision情報収集', mission: 2, missionLabel: '自己実現支援', value: '+0.25' },
  'L3-collect': { label: 'Strategy情報収集', mission: 3, missionLabel: '自己実現支援', value: '+0.20' },
  'L4-collect': { label: 'Execution情報収集', mission: 4, missionLabel: '自己実現支援', value: '+0.10' },
  'L5-collect': { label: 'State情報収集', mission: 5, missionLabel: '自己実現支援', value: '+0.05' },
  'L-action':  { label: '前進行動検出', mission: 1, missionLabel: '自己実現支援', value: '+0.15' },
};

const ALL_SIGNAL_IDS = Object.keys(SIGNAL_META);

function groupSignalsByMission(): { mission: number; missionLabel: string; signals: { id: string; meta: typeof SIGNAL_META[string] }[] }[] {
  const groups: Record<number, { mission: number; missionLabel: string; signals: { id: string; meta: typeof SIGNAL_META[string] }[] }> = {};
  for (const [id, meta] of Object.entries(SIGNAL_META)) {
    if (!groups[meta.mission]) {
      groups[meta.mission] = { mission: meta.mission, missionLabel: meta.missionLabel, signals: [] };
    }
    groups[meta.mission].signals.push({ id, meta });
  }
  // Add MLX-only group for R-signals that share mission with M-signals
  // They are already grouped by mission number, so just sort
  return Object.values(groups).sort((a, b) => a.mission - b.mission);
}

function IntrinsicRewardsSection({ intrinsicConfig, history, botId }: {
  intrinsicConfig: { lambda: number; enabledSignals: string[] } | null;
  history: any[];
  botId: string;
}) {
  const [lambda, setLambda] = useState(intrinsicConfig?.lambda ?? 0.3);
  const [enabledSignals, setEnabledSignals] = useState<string[]>(intrinsicConfig?.enabledSignals ?? ALL_SIGNAL_IDS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLambda(intrinsicConfig?.lambda ?? 0.3);
    setEnabledSignals(intrinsicConfig?.enabledSignals ?? ALL_SIGNAL_IDS);
  }, [intrinsicConfig]);

  const handleLambdaChange = async (newLambda: number) => {
    setLambda(newLambda);
    setSaving(true);
    try {
      await updateIntrinsicConfig(botId, { lambda: newLambda });
    } catch (e) {
      console.error('Failed to update lambda:', e);
    } finally {
      setSaving(false);
    }
  };

  const toggleSignal = async (signalId: string) => {
    const next = enabledSignals.includes(signalId)
      ? enabledSignals.filter(s => s !== signalId)
      : [...enabledSignals, signalId];
    setEnabledSignals(next);
    try {
      await updateIntrinsicConfig(botId, { enabledSignals: next });
    } catch (e) {
      console.error('Failed to update signals:', e);
    }
  };

  const missionGroups = groupSignalsByMission();

  // Filter history entries with intrinsicReward data
  const rewardHistory = history
    .filter((h: any) => h.intrinsicReward)
    .slice(0, 5);

  return (
    <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
      <h3 className="text-sm font-semibold text-[var(--text)] mb-4">内発的報酬（Intrinsic Rewards）</h3>

      {/* Lambda Slider */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--text-dim)]">内発的報酬の影響度</span>
          <span className="text-sm font-mono tabular-nums text-[var(--accent)]">
            {Math.round(lambda * 100)}%
            {saving && <span className="text-[var(--text-dim)] ml-1 text-xs">...</span>}
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={lambda}
          onChange={(e) => handleLambdaChange(parseFloat(e.target.value))}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
          style={{ background: `linear-gradient(to right, var(--accent) ${lambda * 100}%, var(--bg) ${lambda * 100}%)` }}
        />
        <div className="flex justify-between text-[10px] text-[var(--text-dim)] mt-1">
          <span>0% (外的報酬のみ)</span>
          <span>100% (内発的報酬最大)</span>
        </div>
      </div>

      {/* Signal Toggles */}
      <div className="mb-5">
        <div className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium mb-3">シグナル設定</div>
        <div className="space-y-4">
          {missionGroups.map(group => (
            <div key={group.mission}>
              <div className="text-xs font-medium text-[var(--text)] mb-1.5">
                使命{group.mission}: {group.missionLabel}
              </div>
              <div className="space-y-1">
                {group.signals.map(({ id, meta }) => (
                  <div key={id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-[var(--bg)] transition-colors">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleSignal(id)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          enabledSignals.includes(id) ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                            enabledSignals.includes(id) ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                      <span className="text-xs text-[var(--text)]">
                        <span className="font-mono text-[var(--text-dim)]">{id}</span> {meta.label}
                        {meta.isMLX && <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)]">MLX</span>}
                      </span>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-[var(--text-dim)]">({meta.value})</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Signal Firing History */}
      {rewardHistory.length > 0 && (
        <div>
          <div className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium mb-2">直近のシグナル発火</div>
          <div className="space-y-2">
            {rewardHistory.map((h: any, i: number) => {
              const reward = h.intrinsicReward;
              const date = new Date(h.sentAt).toLocaleString('ja-JP', { timeZone: tz(), month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
              return (
                <div key={i} className="bg-[var(--bg)] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-[var(--text)]">
                      <span className="font-mono text-[var(--text-dim)]">{date}</span>
                      {' '}{h.preview ? (h.preview.length > 30 ? h.preview.slice(0, 30) + '...' : h.preview) : ''}
                    </span>
                    <span className="text-xs font-mono tabular-nums text-[var(--accent)]">
                      boost: +{(reward.totalBoost || 0).toFixed(2)}
                    </span>
                  </div>
                  {reward.signals && reward.signals.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {reward.signals.map((sig: any, j: number) => {
                        const meta = SIGNAL_META[sig.id];
                        return (
                          <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)]">
                            {sig.id} {meta?.label || sig.id} ({meta?.value || `+${(sig.value || 0).toFixed(2)}`})
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryBar({ data }: { data: Record<string, number> }) {
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = sorted.length > 0 ? sorted[0][1] : 1;

  return (
    <div className="space-y-2">
      {sorted.map(([cat, count]) => (
        <div key={cat} className="flex items-center gap-2">
          <div className="w-24 text-xs text-[var(--text-dim)] truncate">{INTEREST_LABELS[cat] || cat}</div>
          <div className="flex-1 h-5 bg-[var(--bg)] rounded overflow-hidden">
            <div
              className="h-full rounded"
              style={{
                width: `${(count / max) * 100}%`,
                backgroundColor: INTEREST_COLORS[cat] || '#6b7280',
              }}
            />
          </div>
          <div className="w-8 text-xs text-[var(--text-dim)] text-right">{count}</div>
        </div>
      ))}
      {sorted.length === 0 && <div className="text-xs text-[var(--text-dim)]">データなし</div>}
    </div>
  );
}

function HourStats({ data }: { data: Record<number, { sent: number; reacted: number; positive: number }> }) {
  const hours = [9, 11, 14, 17, 20];
  return (
    <div className="space-y-2">
      {hours.map(h => {
        const stats = data[h] || { sent: 0, reacted: 0, positive: 0 };
        const rate = stats.sent > 0 ? Math.round((stats.reacted / stats.sent) * 100) : 0;
        return (
          <div key={h} className="flex items-center gap-2">
            <div className="w-12 text-xs text-[var(--text-dim)]">{h}:00</div>
            <div className="flex-1 h-5 bg-[var(--bg)] rounded overflow-hidden">
              <div
                className="h-full rounded bg-[var(--accent)]/60"
                style={{ width: `${rate}%` }}
              />
            </div>
            <div className="w-20 text-xs text-[var(--text-dim)] text-right">
              {rate}% ({stats.reacted}/{stats.sent})
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReactionBadge({ reaction, delta }: { reaction: string | null; delta: number }) {
  if (!reaction) return <span className="text-xs text-[var(--text-dim)]">—</span>;
  const color = delta > 0 ? 'text-[var(--success)]' : delta < 0 ? 'text-[var(--error)]' : 'text-[var(--text-dim)]';
  return (
    <span className={`text-xs ${color}`}>
      {reaction} ({delta > 0 ? '+' : ''}{delta.toFixed(1)})
    </span>
  );
}

const EVENT_SOURCE_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  calendar: 'Calendar',
  rss: 'RSS',
  github: 'GitHub',
};

const EVENT_SOURCE_FIELDS: Record<string, { key: string; label: string; type: 'number' | 'text' }[]> = {
  gmail: [
    { key: 'intervalMinutes', label: 'ポーリング間隔（分）', type: 'number' },
    { key: 'query', label: 'Gmail検索クエリ', type: 'text' },
  ],
  calendar: [
    { key: 'intervalMinutes', label: 'ポーリング間隔（分）', type: 'number' },
    { key: 'alertBeforeMinutes', label: 'イベント前アラート（分）', type: 'number' },
  ],
  rss: [
    { key: 'intervalMinutes', label: 'ポーリング間隔（分）', type: 'number' },
  ],
  github: [
    { key: 'webhookSecret', label: 'Webhook Secret', type: 'text' },
  ],
};

function CalendarExcludePanel({ botId, sources, setSources }: { botId: string; sources: any; setSources: (s: any) => void }) {
  const [calendars, setCalendars] = useState<{ id: string; summary: string; primary: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCalendarList()
      .then(setCalendars)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const excludeSet = new Set<string>(sources?.calendar?.excludeCalendars ?? []);

  const handleToggle = async (calId: string) => {
    const next = new Set(excludeSet);
    if (next.has(calId)) next.delete(calId);
    else next.add(calId);
    setSaving(true);
    try {
      const updated = await updateEventSource(botId, 'calendar', { excludeCalendars: [...next] });
      setSources(updated);
    } catch (e) {
      console.error('Failed to update excludeCalendars:', e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-xs text-[var(--text-dim)] mt-2">カレンダー一覧を取得中...</p>;
  if (calendars.length === 0) return null;

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-[var(--text-dim)]">カレンダー除外設定</span>
        {saving && <span className="text-[10px] text-[var(--text-dim)]">保存中...</span>}
      </div>
      <div className="space-y-1">
        {calendars.map((cal) => {
          const excluded = excludeSet.has(cal.id);
          return (
            <div key={cal.id} className="flex items-center gap-2">
              <button
                onClick={() => handleToggle(cal.id)}
                className={`relative inline-flex h-5 w-8 items-center rounded-full transition-colors ${
                  !excluded ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                }`}
              >
                <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                  !excluded ? 'translate-x-4' : 'translate-x-1'
                }`} />
              </button>
              <span className={`text-xs ${excluded ? 'text-[var(--text-dim)] line-through' : 'text-[var(--text)]'}`}>
                {cal.summary}{cal.primary ? ' (primary)' : ''}
              </span>
              <span className="text-[10px] text-[var(--text-dim)] truncate max-w-[200px]">{cal.id}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventSourcesSection({ botId }: { botId: string }) {
  const [sources, setSources] = useState<any>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    getEventSources(botId).then(setSources).catch(console.error);
  }, [botId]);

  if (!sources) return null;

  const handleToggle = async (source: string) => {
    const current = sources[source];
    setSaving(source);
    try {
      const updated = await updateEventSource(botId, source, { enabled: !current.enabled });
      setSources(updated);
    } catch (e) {
      console.error('Failed to update event source:', e);
    } finally {
      setSaving(null);
    }
  };

  const handleFieldChange = async (source: string, key: string, value: string | number) => {
    setSaving(source);
    try {
      const updated = await updateEventSource(botId, source, { [key]: value });
      setSources(updated);
    } catch (e) {
      console.error('Failed to update event source field:', e);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
      <h3 className="text-sm font-semibold text-[var(--text)] mb-4">イベントソース</h3>
      <div className="space-y-4">
        {Object.entries(EVENT_SOURCE_LABELS).map(([source, label]) => {
          const cfg = sources[source];
          if (!cfg) return null;
          const fields = EVENT_SOURCE_FIELDS[source] || [];
          return (
            <div key={source} className="bg-[var(--bg)] rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--text)]">{label}</span>
                  {saving === source && <span className="text-[10px] text-[var(--text-dim)]">保存中...</span>}
                </div>
                <button
                  onClick={() => handleToggle(source)}
                  className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
                    cfg.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                      cfg.enabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              {cfg.enabled && fields.length > 0 && (
                <div className="space-y-2 mt-3">
                  {fields.map((f) => (
                    <div key={f.key} className="flex items-center gap-3">
                      <label className="text-xs text-[var(--text-dim)] w-40 shrink-0">{f.label}</label>
                      <input
                        type={f.type}
                        value={cfg[f.key] ?? ''}
                        onChange={(e) => {
                          const val = f.type === 'number' ? Number(e.target.value) : e.target.value;
                          setSources((prev: any) => ({
                            ...prev,
                            [source]: { ...prev[source], [f.key]: val },
                          }));
                        }}
                        onBlur={(e) => {
                          const val = f.type === 'number' ? Number(e.target.value) : e.target.value;
                          handleFieldChange(source, f.key, val);
                        }}
                        className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                  ))}
                </div>
              )}
              {source === 'calendar' && cfg.enabled && (
                <CalendarExcludePanel botId={botId} sources={sources} setSources={setSources} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const WEIGHT_LABELS: Record<string, string> = { light: '軽め', medium: '中程度', heavy: '重め' };
const WEIGHTS = ['light', 'medium', 'heavy'] as const;

function IntentionalPauseSection({ botId }: { botId: string }) {
  const [config, setConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getIntentionalPause(botId).then(setConfig).catch(console.error);
  }, [botId]);

  if (!config) return null;

  const handleToggle = async () => {
    setSaving(true);
    try {
      const updated = await updateIntentionalPause(botId, { enabled: !config.enabled });
      setConfig(updated);
    } catch (e) {
      console.error('Failed to update intentional pause:', e);
    } finally {
      setSaving(false);
    }
  };

  const handlePremiseChange = async (weight: string, value: string) => {
    const premiseTexts = { ...config.premiseTexts, [weight]: value || null };
    setConfig((prev: any) => ({ ...prev, premiseTexts }));
  };

  const handlePremiseBlur = async (weight: string) => {
    setSaving(true);
    try {
      const updated = await updateIntentionalPause(botId, { premiseTexts: config.premiseTexts });
      setConfig(updated);
    } catch (e) {
      console.error('Failed to update premise:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleWaitChange = async (weight: string, value: number) => {
    const waitSeconds = { ...config.waitSeconds, [weight]: value };
    setConfig((prev: any) => ({ ...prev, waitSeconds }));
    setSaving(true);
    try {
      await updateIntentionalPause(botId, { waitSeconds });
    } catch (e) {
      console.error('Failed to update wait seconds:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)]">意図的な間（Intentional Pause）</h3>
          <p className="text-xs text-[var(--text-dim)] mt-1">メッセージ送信前に前置きテキストと待ち時間を挿入します</p>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-[10px] text-[var(--text-dim)]">保存中...</span>}
          <button
            onClick={handleToggle}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              config.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
                config.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>
      {config.enabled && (
        <div className="space-y-4">
          {WEIGHTS.map((w) => (
            <div key={w} className="bg-[var(--bg)] rounded-lg p-4">
              <div className="text-xs font-medium text-[var(--text)] mb-3">{WEIGHT_LABELS[w]}</div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-[var(--text-dim)] block mb-1">前置きテキスト</label>
                  <input
                    type="text"
                    value={config.premiseTexts?.[w] ?? ''}
                    onChange={(e) => handlePremiseChange(w, e.target.value)}
                    onBlur={() => handlePremiseBlur(w)}
                    placeholder="(なし)"
                    className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-[var(--text-dim)]">待ち時間</label>
                    <span className="text-xs font-mono tabular-nums text-[var(--accent)]">{config.waitSeconds?.[w] ?? 0}秒</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.5"
                    value={config.waitSeconds?.[w] ?? 0}
                    onChange={(e) => handleWaitChange(w, parseFloat(e.target.value))}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
                    style={{
                      background: `linear-gradient(to right, var(--accent) ${((config.waitSeconds?.[w] ?? 0) / 10) * 100}%, var(--bg) ${((config.waitSeconds?.[w] ?? 0) / 10) * 100}%)`,
                    }}
                  />
                  <div className="flex justify-between text-[10px] text-[var(--text-dim)] mt-1">
                    <span>0秒</span>
                    <span>10秒</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProactiveConfig() {
  const { activeBotId, bots } = useBotContext();
  const botName = bots.find((b) => b.id === activeBotId)?.name || activeBotId;
  const [stats, setStats] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [interests, setInterests] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Config state (preserved from original)
  const [enabled, setEnabled] = useState(false);
  const [schedule, setSchedule] = useState('');
  const [slackTarget, _setSlackTarget] = useState('');
  const [exclusions, setExclusions] = useState<string[]>([]);
  const [newExclusion, setNewExclusion] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [sendingBotId, setSendingBotId] = useState<string | null>(null);
  const sending = sendingBotId === activeBotId;
  const [allowNoReply, setAllowNoReply] = useState(true);

  useEffect(() => {
    if (!activeBotId) return;
    setLoading(true);
    Promise.all([
      getProactiveStats(activeBotId),
      getProactiveHistory(activeBotId, 30),
      getProactiveInterests(),
      getProactiveConfig(activeBotId),
    ])
      .then(([s, h, i, cfg]) => {
        setStats(s);
        setHistory(h);
        setInterests(i);
        setAllowNoReply(s.allowNoReply ?? true);
        setEnabled(cfg.enabled);
        setSchedule(cfg.schedule || '');
        _setSlackTarget(cfg.slackTarget || '');
        setExclusions(cfg.calendarExclusions || []);
      })
      .finally(() => setLoading(false));
  }, [activeBotId]);

  const addExclusion = () => {
    const trimmed = newExclusion.trim();
    if (trimmed && !exclusions.includes(trimmed)) {
      setExclusions([...exclusions, trimmed]);
      setNewExclusion('');
    }
  };

  const removeExclusion = (index: number) => {
    setExclusions(exclusions.filter((_, i) => i !== index));
  };

  const handleSave = async (): Promise<boolean> => {
    setSaving(true);
    try {
      await updateProactiveConfig(activeBotId, {
        enabled,
        schedule,
        calendarExclusions: exclusions,
      });
      setMessage('保存しました');
      setTimeout(() => setMessage(''), 2000);
      return true;
    } catch (e: any) {
      setMessage(`エラー: ${e.message}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndRestart = async () => {
    const saved = await handleSave();
    if (!saved) return;
    setSaving(true);
    try {
      await restartBot();
      setMessage('保存して反映しました');
      setTimeout(() => setMessage(''), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleSendNow = async () => {
    const targetBotId = activeBotId;
    setSendingBotId(targetBotId);
    setMessage('');
    try {
      const result = await runProactiveNow(targetBotId);
      if (result.status === 'success') {
        // Refresh stats only if still on the same bot
        const [s, h] = await Promise.all([
          getProactiveStats(targetBotId),
          getProactiveHistory(targetBotId, 30),
        ]);
        if (targetBotId === activeBotId) {
          setStats(s);
          setHistory(h);
          setMessage(`送信完了（${Math.round((result.durationMs || 0) / 1000)}秒）`);
          setTimeout(() => setMessage(''), 5000);
        }
      } else {
        if (targetBotId === activeBotId) {
          setMessage(`エラー: ${result.error || '不明なエラー'}`);
          setTimeout(() => setMessage(''), 5000);
        }
      }
    } catch (e: any) {
      if (targetBotId === activeBotId) {
        setMessage(`エラー: ${e.message}`);
        setTimeout(() => setMessage(''), 5000);
      }
    } finally {
      setSendingBotId(null);
    }
  };

  if (loading) return <div className="text-[var(--text-dim)]">読み込み中...</div>;

  const lastUpdated = interests?.lastUpdated
    ? new Date(interests.lastUpdated).toLocaleString('ja-JP', { timeZone: tz(), month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">
          Agent <span className="text-lg font-normal text-[var(--accent)]">— {botName}</span>
        </h2>
        <button
          onClick={handleSendNow}
          disabled={sending}
          className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {sending ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              送信中...
            </>
          ) : (
            '今すぐ送信'
          )}
        </button>
      </div>
      {message && !saving && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${message.startsWith('エラー') ? 'bg-[var(--error)]/10 text-[var(--error)]' : 'bg-[var(--success)]/10 text-[var(--success)]'}`}>
          {message}
        </div>
      )}

      {/* Auth Error Banner */}
      {stats?.lastAuthError && (
        <div className="mb-4 p-4 rounded-lg border-2 border-red-500 bg-red-500/10">
          <div className="flex items-center gap-2">
            <span className="text-red-500 text-lg">!</span>
            <div>
              <div className="text-sm font-semibold text-red-500">Slack 認証エラー</div>
              <div className="text-xs text-[var(--text-dim)]">
                {stats.lastAuthError.message}
                <span className="ml-2 font-mono">
                  ({new Date(stats.lastAuthError.timestamp).toLocaleString('ja-JP', { timeZone: tz(), month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })})
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {stats && !stats.error && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="総送信数" value={stats.totalSent} sub={`今週 ${stats.thisWeek} / 今日 ${stats.todayCount}`} />
            <StatCard label="反応率" value={`${stats.reactionRate}%`} sub={`${stats.positive + stats.negative} / ${stats.totalSent} 件に反応`} />
            <StatCard label="ポジティブ率" value={`${stats.positiveRate}%`} sub={`+${stats.positive} / -${stats.negative}`} />
            <StatCard label="今日の残り" value={`${stats.remainingToday} 回`} sub={stats.scheduledHours?.length ? `${stats.scheduledHours[0]}〜${stats.scheduledHours[stats.scheduledHours.length - 1]}時 (${stats.scheduledHours.length}回/日)` : ''} />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5">
              <h3 className="text-sm font-semibold text-[var(--text)] mb-3">カテゴリ別配信</h3>
              <CategoryBar data={stats.interestDist || {}} />
            </div>
            <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5">
              <h3 className="text-sm font-semibold text-[var(--text)] mb-3">時間帯別反応率</h3>
              <HourStats data={stats.hourStats || {}} />
            </div>
          </div>

        </>
      )}

      {/* Decision Log */}
      {stats.lastDecisionLog && (
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[var(--text)]">直近の判断ログ</h3>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                stats.lastDecisionLog.decision === 'send'
                  ? 'bg-[var(--success)]/20 text-[var(--success)]'
                  : 'bg-[var(--warning)]/20 text-[var(--warning)]'
              }`}>
                {stats.lastDecisionLog.decision === 'send' ? '送信' : 'NO_REPLY'}
              </span>
              <span className="text-xs text-[var(--text-dim)]">
                {stats.lastDecisionLog.timestamp
                  ? new Date(stats.lastDecisionLog.timestamp).toLocaleString('ja-JP', { timeZone: tz(), hour: '2-digit', minute: '2-digit' })
                  : ''}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
            <div>
              <span className="text-[var(--text-dim)] text-xs">判定ニーズ</span>
              <div className="text-[var(--text)]">{stats.lastDecisionLog.need || '—'}</div>
            </div>
            <div>
              <span className="text-[var(--text-dim)] text-xs">使用スキル</span>
              <div className="text-[var(--text)]">{stats.lastDecisionLog.skill || '—'}</div>
            </div>
          </div>

          <div className="mb-4">
            <span className="text-[var(--text-dim)] text-xs">判断理由</span>
            <div className="text-sm text-[var(--text)] mt-1">{stats.lastDecisionLog.reason || '—'}</div>
          </div>

          {stats.lastDecisionLog.message && (
            <div className="mt-4 bg-[var(--bg)] rounded-lg p-3">
              <span className="text-[var(--text-dim)] text-xs">送信メッセージ</span>
              <div className="text-sm text-[var(--text)] mt-1">{stats.lastDecisionLog.message}</div>
            </div>
          )}

          <PremiseDisplay premise={stats.lastDecisionLog?.premise} />
        </div>
      )}

      {/* 6-Axis Scored Candidates */}
      {(stats.scoredCandidates?.length > 0 || stats.lastDecisionLog?.scoredCandidates?.length > 0) && (
        <ScoredCandidatesList
          candidates={stats.scoredCandidates?.length > 0 ? stats.scoredCandidates : stats.lastDecisionLog?.scoredCandidates || []}
        />
      )}

      {/* Weights Breakdown */}
      <WeightsBreakdown decisionLog={stats.lastDecisionLog} />

      {/* Learning State (Thompson Sampling) */}
      <LearningStateSection
        learningState={stats.learningState}
        botId={activeBotId}
        onUpdate={(ls) => setStats((prev: any) => prev ? { ...prev, learningState: ls } : prev)}
      />

      {/* Intrinsic Rewards */}
      <IntrinsicRewardsSection
        intrinsicConfig={stats.intrinsicConfig}
        history={history}
        botId={activeBotId}
      />

      {/* Interest Cache */}
      {interests && interests.categories && (
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
          <h3 className="text-sm font-semibold text-[var(--text)] mb-1">興味キャッシュ</h3>
          <div className="text-xs text-[var(--text-dim)] mb-3">最終スキャン: {lastUpdated}</div>
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.entries(interests.categories).map(([catId, catData]: [string, any]) => (
              <span
                key={catId}
                className="text-xs px-2 py-1 rounded-full"
                style={{
                  backgroundColor: (INTEREST_COLORS[catId] || '#6b7280') + '22',
                  color: INTEREST_COLORS[catId] || '#6b7280',
                }}
              >
                {INTEREST_LABELS[catId] || catId} ({catData.count})
              </span>
            ))}
          </div>
          {interests.topItems && interests.topItems.length > 0 && (
            <div>
              <div className="text-xs text-[var(--text-dim)] mb-2">注目トピック (Top 5)</div>
              <div className="space-y-1">
                {interests.topItems.slice(0, 5).map((item: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span
                      className="px-1.5 py-0.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: (INTEREST_COLORS[item.category] || '#6b7280') + '22',
                        color: INTEREST_COLORS[item.category] || '#6b7280',
                      }}
                    >
                      {INTEREST_LABELS[item.category] || item.category}
                    </span>
                    <span className="text-[var(--text)] truncate">{item.title}</span>
                    <span className="text-[var(--text-dim)] shrink-0">{item.score}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Conversation Profile */}
      {stats && (
        <ConversationProfileSelector
          currentProfile={stats.conversationProfile || 'balanced'}
          botId={activeBotId}
          onUpdate={(p) => setStats((prev: any) => prev ? { ...prev, conversationProfile: p } : prev)}
        />
      )}

      {/* Configuration Section */}
      <div className="border-t border-[var(--border)] pt-6 mt-6">
        <h3 className="text-lg font-semibold mb-4 text-[var(--text)]">設定</h3>

        {/* Enable Toggle + No Reply Toggle */}
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">プロアクティブモード</h3>
              <p className="text-xs text-[var(--text-dim)] mt-1">有効にすると、スケジュールに基づいて自動的にメッセージを送信します</p>
            </div>
            <button
              onClick={() => setEnabled(!enabled)}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                enabled ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
                  enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          <div className="border-t border-[var(--border)] pt-4 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold">No Reply 判断</h4>
              <p className="text-xs text-[var(--text-dim)] mt-1">
                {allowNoReply
                  ? 'ON: LLMが「今は黙るべき」と判断したら送信しない'
                  : 'OFF: 常にスコアリング最上位の候補で送信する'}
              </p>
            </div>
            <button
              onClick={async () => {
                const next = !allowNoReply;
                setAllowNoReply(next);
                await updateProactiveState(activeBotId, { allowNoReply: next });
              }}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                allowNoReply ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
                  allowNoReply ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Schedule */}
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-lg font-semibold">配信スケジュール</h3>
              <p className="text-sm text-[var(--text-dim)] mt-1">
                ここで編集できるよ。保存すると `cron-jobs.json` に反映されて、再起動後に実行されるよ。
              </p>
              {stats?.scheduledHours?.length ? (
                <p className="text-xs text-[var(--text-dim)] mt-2">
                  {stats.scheduledHours[0]}〜{stats.scheduledHours[stats.scheduledHours.length - 1]}時 ({stats.scheduledHours.length}回/日)
                </p>
              ) : null}
            </div>
            <a
              href="/bot/cron-jobs"
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-dim)] transition-colors"
            >
              Cron Jobs で一覧 →
            </a>
          </div>
          <CronEditor value={schedule || '0 9,11,14,17,20 * * 1-5'} onChange={setSchedule} />
        </div>

        {/* Calendar Exclusions */}
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
          <h3 className="text-lg font-semibold mb-4">カレンダー除外設定</h3>
          <p className="text-xs text-[var(--text-dim)] mb-3">指定したキーワードを含むカレンダーイベント中はメッセージを送信しません</p>

          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newExclusion}
              onChange={(e) => setNewExclusion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addExclusion()}
              placeholder="除外キーワードを入力..."
              className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
            <button
              onClick={addExclusion}
              className="px-3 py-2 bg-[var(--border)] hover:bg-[var(--text-dim)] rounded-lg text-sm transition-colors"
            >
              追加
            </button>
          </div>

          {exclusions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {exclusions.map((ex, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-[var(--bg)]/50 border border-[var(--border)] rounded-full text-sm text-[var(--text)]"
                >
                  {ex}
                  <button
                    onClick={() => removeExclusion(i)}
                    className="text-[var(--text-dim)] hover:text-[var(--error)] ml-1"
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-dim)]">除外設定はありません</p>
          )}
        </div>

        {/* Event Sources */}
        <EventSourcesSection botId={activeBotId} />

        {/* Intentional Pause */}
        <IntentionalPauseSection botId={activeBotId} />

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            onClick={handleSaveAndRestart}
            disabled={saving}
            className="px-4 py-2 bg-[var(--success)] hover:bg-[var(--success-hover)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? '反映中...' : '保存して反映'}
          </button>
          {message && (
            <span className={`text-sm ${message.startsWith('エラー') ? 'text-[var(--error)]' : 'text-[var(--success)]'}`}>
              {message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
