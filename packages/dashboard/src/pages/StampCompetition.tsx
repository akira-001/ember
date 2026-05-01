import { useEffect, useState } from 'react';
import { getStamps, getRewards } from '../api';
import { useBotContext } from '../components/BotContext';

// --- Types ---

interface BotStampScore {
  total: number;
  breakdown: Record<string, number>;
}

interface StampData {
  currentWeek?: {
    weekStart: string;
    weekEnd: string;
    scores: Record<string, BotStampScore>;
  };
  history?: { weekStart: string; weekEnd: string; scores: Record<string, number> }[];
}

interface SignalAgg {
  count: number;
  totalValue: number;
  mission: number;
}

interface RecentEntry {
  sentAt: string;
  category: string;
  preview: string;
  reaction: string | null;
  intrinsicSignals: { id: string; mission: number; value: number; reason: string }[];
  compositeBoost: number;
  rewardLog: { type: string; signal: string; value: number; reason: string }[];
}

interface BotRewards {
  name: string;
  totalMessages: number;
  signalAgg: Record<string, SignalAgg>;
  rewardLogAgg: Record<string, { count: number; totalValue: number }>;
  reactions: Record<string, number>;
  externalStamps: { current: number; historical: number; total: number };
  dailySignals: Record<string, Record<string, number>>;
  dailyBoosts: Record<string, { sum: number; count: number }>;
  recentEntries: RecentEntry[];
}

// --- Constants ---

const BOT_COLORS: Record<string, string> = { mei: '#8a4a6a', eve: '#6a5a9a' };
const getBotColor = (id: string) => BOT_COLORS[id] || '#5070a0';

const MISSION_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: 'Goal Alignment', color: '#c97a4a' },
  2: { label: 'Wellbeing', color: '#4a8a6a' },
  3: { label: 'Knowledge', color: '#5a7ab0' },
  4: { label: 'Info Value', color: '#9a6ab0' },
  5: { label: 'Relationship', color: '#b05a6a' },
};

const SIGNAL_LABELS: Record<string, string> = {
  'M1-a': 'ゴール整合',
  'M2-a': 'タイミング配慮',
  'M2-b': '適切な沈黙',
  'M3-a': '新インサイト獲得',
  'M4-a': '情報新規性',
  'M4-b': 'クロスドメイン',
  'M5-a': '会話引き出し',
  'M5-b': '深い対話',
  'R1': '自己実現',
  'R2': 'ウェルビーイング',
  'R3': '新情報獲得',
  'R4': '発見・驚き',
  'R5': '価値観表明',
  'L1-collect': 'L1 Identity',
  'L2-collect': 'L2 Vision',
  'L3-collect': 'L3 Strategy',
  'L4-collect': 'L4 Execution',
  'L5-collect': 'L5 State',
  'L-action': '行動報酬',
};

const REACTION_LABELS: Record<string, string> = {
  'text_engaged': 'テキスト返信',
  '+1': 'Good',
  'ok_hand': 'OK',
  'heart': 'Love',
  'text_positive': 'ポジティブ返信',
};

// --- Components ---

function MissionRadar({ signalAgg, botColor }: { signalAgg: Record<string, SignalAgg>; botColor: string }) {
  const missionTotals: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const [, agg] of Object.entries(signalAgg)) {
    missionTotals[agg.mission] = (missionTotals[agg.mission] || 0) + agg.totalValue;
  }

  const maxVal = Math.max(...Object.values(missionTotals), 1);
  const missions = [1, 2, 3, 4, 5];
  const cx = 80, cy = 80, r = 60;

  const getPoint = (i: number, val: number) => {
    const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    const ratio = val / maxVal;
    return { x: cx + r * ratio * Math.cos(angle), y: cy + r * ratio * Math.sin(angle) };
  };

  const polygonPoints = missions.map((_, i) => {
    const p = getPoint(i, missionTotals[missions[i]]);
    return `${p.x},${p.y}`;
  }).join(' ');

  return (
    <div className="flex items-center gap-4">
      <svg width="160" height="160" viewBox="0 0 160 160">
        {/* Grid */}
        {[0.25, 0.5, 0.75, 1].map((scale) => (
          <polygon
            key={scale}
            points={missions.map((_, i) => {
              const p = getPoint(i, maxVal * scale);
              return `${p.x},${p.y}`;
            }).join(' ')}
            fill="none"
            stroke="var(--border)"
            strokeWidth="0.5"
            opacity={0.5}
          />
        ))}
        {/* Axes */}
        {missions.map((_, i) => {
          const p = getPoint(i, maxVal);
          return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="var(--border)" strokeWidth="0.5" opacity={0.3} />;
        })}
        {/* Data polygon */}
        <polygon points={polygonPoints} fill={botColor} fillOpacity={0.2} stroke={botColor} strokeWidth="1.5" />
        {/* Dots + Labels */}
        {missions.map((m, i) => {
          const p = getPoint(i, missionTotals[m]);
          const lp = getPoint(i, maxVal * 1.25);
          return (
            <g key={m}>
              <circle cx={p.x} cy={p.y} r="3" fill={botColor} />
              <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle" fontSize="7" fill="var(--text-dim)">
                {MISSION_LABELS[m]?.label.slice(0, 6)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="space-y-1">
        {missions.map((m) => (
          <div key={m} className="flex items-center gap-2 text-xs">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: MISSION_LABELS[m]?.color }} />
            <span className="text-[var(--text-dim)] w-24">{MISSION_LABELS[m]?.label}</span>
            <span className="font-mono tabular-nums">{missionTotals[m].toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SignalHeatmap({ signalAgg }: { signalAgg: Record<string, SignalAgg> }) {
  const signals = Object.entries(signalAgg).sort((a, b) => b[1].count - a[1].count);
  const maxCount = Math.max(...signals.map(([, a]) => a.count), 1);

  return (
    <div className="flex flex-wrap gap-2">
      {signals.map(([id, agg]) => {
        const intensity = agg.count / maxCount;
        const mColor = MISSION_LABELS[agg.mission]?.color || '#888';
        return (
          <div
            key={id}
            className="rounded px-2 py-1 text-xs"
            style={{
              backgroundColor: mColor,
              opacity: 0.3 + intensity * 0.7,
              color: 'white',
            }}
            title={`${SIGNAL_LABELS[id] || id}: ${agg.count}回, 累計${agg.totalValue.toFixed(2)}`}
          >
            <span className="font-medium">{SIGNAL_LABELS[id] || id}</span>
            <span className="ml-1 opacity-80">{agg.count}</span>
          </div>
        );
      })}
    </div>
  );
}

function RecentTimeline({ entries, botColor }: { entries: RecentEntry[]; botColor: string }) {
  return (
    <div className="space-y-1">
      {[...entries].reverse().slice(0, 12).map((e, i) => {
        const hasReaction = e.reaction !== null;
        const hasIntrinsic = e.intrinsicSignals.length > 0;
        const time = e.sentAt ? new Date(e.sentAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) : '';

        return (
          <div
            key={i}
            className="flex items-start gap-2 p-2 rounded hover:bg-[var(--surface-hover)] transition-colors"
          >
            {/* Timeline dot */}
            <div className="mt-1.5 shrink-0">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{
                  backgroundColor: hasReaction ? botColor : hasIntrinsic ? 'var(--text-dim)' : 'var(--border)',
                  opacity: hasReaction ? 1 : 0.5,
                }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--text-dim)] font-mono">{time}</span>
                {hasReaction && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: botColor, color: 'white', opacity: 0.8 }}>
                    {REACTION_LABELS[e.reaction!] || e.reaction}
                  </span>
                )}
                {e.compositeBoost > 0 && (
                  <span className="text-[10px] text-[var(--text-dim)]">
                    +{e.compositeBoost.toFixed(3)}
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--text)] truncate mt-0.5">{e.preview || e.category}</p>
              {hasIntrinsic && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {e.intrinsicSignals.map((s, j) => (
                    <span key={j} className="text-[9px] px-1 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-dim)]"
                      title={s.reason}>
                      {SIGNAL_LABELS[s.id] || s.id}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ExternalRewardBar({ stamps, reactions, botColor }: {
  stamps: { current: number; historical: number; total: number };
  reactions: Record<string, number>;
  botColor: string;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-3xl font-bold tabular-nums" style={{ color: botColor }}>{stamps.total}</span>
        <span className="text-xs text-[var(--text-dim)]">total external rewards</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(reactions).sort(([, a], [, b]) => b - a).map(([type, count]) => (
          <div key={type} className="flex items-center gap-1 bg-[var(--surface-hover)] rounded px-2 py-1">
            <span className="text-xs">{REACTION_LABELS[type] || type}</span>
            <span className="text-xs font-mono text-[var(--text-dim)]">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Main ---

export default function StampCompetition() {
  const { bots } = useBotContext();
  const [stampData, setStampData] = useState<StampData | null>(null);
  const [rewards, setRewards] = useState<Record<string, BotRewards> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeBot, setActiveBot] = useState<string>('');

  useEffect(() => {
    setLoading(true);
    Promise.all([getStamps(), getRewards()])
      .then(([s, r]) => {
        setStampData(s);
        setRewards(r);
        setError('');
        if (!activeBot && Object.keys(r).length > 0) {
          setActiveBot(Object.keys(r)[0]);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-[var(--text-dim)]">読み込み中...</div>;
  if (error) return <div className="text-[var(--error)]">エラー: {error}</div>;
  if (!rewards) return null;

  const botIds = Object.keys(rewards);
  const currentWeek = stampData?.currentWeek;

  // Compute total intrinsic value per bot
  const intrinsicTotals: Record<string, number> = {};
  for (const [botId, data] of Object.entries(rewards)) {
    intrinsicTotals[botId] = Object.values(data.signalAgg).reduce((s, a) => s + a.totalValue, 0);
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-1">報酬履歴</h2>
      <p className="text-sm text-[var(--text-dim)] mb-6">
        強化学習の外部報酬・内在報酬シグナルを可視化
      </p>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {botIds.map((botId) => {
          const r = rewards[botId];
          const extTotal = r.externalStamps.total;
          const intTotal = intrinsicTotals[botId];
          return (
            <button
              key={botId}
              onClick={() => setActiveBot(botId)}
              className={`bg-[var(--surface)] rounded-lg border p-4 text-left transition-all ${
                activeBot === botId ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : 'border-[var(--border)] hover:border-[var(--text-dim)]'
              }`}
            >
              <p className="text-xs text-[var(--text-dim)] uppercase tracking-wide mb-2">{r.name}</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums" style={{ color: getBotColor(botId) }}>{extTotal}</span>
                <span className="text-[10px] text-[var(--text-dim)]">ext</span>
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-lg font-semibold tabular-nums text-[var(--text)]">{intTotal.toFixed(1)}</span>
                <span className="text-[10px] text-[var(--text-dim)]">intrinsic</span>
              </div>
              <p className="text-[10px] text-[var(--text-dim)] mt-2">{r.totalMessages} messages</p>
            </button>
          );
        })}

        {/* Current Week Summary */}
        {currentWeek && (
          <div className="col-span-2 bg-[var(--surface)] rounded-lg border border-[var(--border)] p-4">
            <p className="text-xs text-[var(--text-dim)] uppercase tracking-wide mb-2">
              今週 {currentWeek.weekStart} ~ {currentWeek.weekEnd}
            </p>
            <div className="flex gap-6">
              {botIds.map((botId) => {
                const score = currentWeek.scores[botId];
                return (
                  <div key={botId}>
                    <span className="text-xs text-[var(--text-dim)]">{rewards[botId].name}</span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-bold tabular-nums" style={{ color: getBotColor(botId) }}>
                        {score?.total ?? 0}
                      </span>
                      {score && Object.keys(score.breakdown).length > 0 && (
                        <span className="text-[10px] text-[var(--text-dim)]">
                          ({Object.entries(score.breakdown).map(([e, c]) => `${e}×${c}`).join(', ')})
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Active Bot Detail */}
      {activeBot && rewards[activeBot] && (() => {
        const r = rewards[activeBot];
        const color = getBotColor(activeBot);

        return (
          <div className="space-y-6">
            {/* Two-column: Radar + External */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Mission Radar */}
              <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5">
                <h3 className="text-sm font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-4">
                  ミッション別 内在報酬
                </h3>
                <MissionRadar signalAgg={r.signalAgg} botColor={color} />
              </div>

              {/* External Rewards */}
              <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5">
                <h3 className="text-sm font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-4">
                  外部報酬（リアクション）
                </h3>
                <ExternalRewardBar stamps={r.externalStamps} reactions={r.reactions} botColor={color} />
              </div>
            </div>

            {/* Signal Heatmap */}
            <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5">
              <h3 className="text-sm font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-4">
                シグナル発火頻度
              </h3>
              <SignalHeatmap signalAgg={r.signalAgg} />
            </div>

            {/* Recent Timeline */}
            <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5">
              <h3 className="text-sm font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-4">
                直近のメッセージと報酬
              </h3>
              <RecentTimeline entries={r.recentEntries} botColor={color} />
            </div>
          </div>
        );
      })()}

      {/* Weekly History Table */}
      {stampData?.history && stampData.history.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-4">
            外部報酬 週間履歴
          </h3>
          <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[var(--text-dim)] text-xs uppercase tracking-[0.05em] font-medium border-b border-[var(--border)]">
                    <th className="text-left p-3">期間</th>
                    {bots.map((bot) => (
                      <th key={bot.id} className="text-right p-3">
                        <span style={{ color: getBotColor(bot.id) }}>{bot.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stampData.history.map((week, i) => (
                    <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--surface-hover)]">
                      <td className="p-3 text-[var(--text)] whitespace-nowrap">
                        {week.weekStart} ~ {week.weekEnd}
                      </td>
                      {bots.map((bot) => (
                        <td key={bot.id} className="p-3 text-right font-mono text-[var(--text)]">
                          {week.scores[bot.id] ?? '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
