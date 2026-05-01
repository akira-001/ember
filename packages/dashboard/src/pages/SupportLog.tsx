import { useEffect, useState } from 'react';
import { getProactiveHistory } from '../api';
import { useBotContext } from '../components/BotContext';
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

function ReactionBadge({ reaction, delta }: { reaction: string | null; delta: number }) {
  if (!reaction) return <span className="text-xs text-[var(--text-dim)]">—</span>;
  const color = delta > 0 ? 'text-[var(--success)]' : delta < 0 ? 'text-[var(--error)]' : 'text-[var(--text-dim)]';
  return (
    <span className={`text-xs ${color}`}>
      {reaction} ({delta > 0 ? '+' : ''}{delta.toFixed(1)})
    </span>
  );
}

export default function SupportLog() {
  const { activeBotId, bots } = useBotContext();
  const botName = bots.find((b) => b.id === activeBotId)?.name || activeBotId;
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!activeBotId) return;
    setLoading(true);
    getProactiveHistory(activeBotId, 100)
      .then((h) => setHistory(h))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [activeBotId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--text-dim)]">読み込み中…</div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-[var(--text)]">支援ログ</h2>
        <p className="text-sm text-[var(--text-dim)] mt-1">{botName} の配信履歴</p>
      </div>

      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5">
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
                                {r.type === 'reaction' ? '😊' : r.type === 'profile_collect' ? '📋' : '💬'} {r.signal}
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
    </div>
  );
}
