import { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { getState, getEventSources } from '../api';
import { useBotContext } from '../components/BotContext';
import { useI18n } from '../i18n';
import { tz } from '../timezone';
import type { ProactiveState, SuggestionHistoryEntry } from '../types';
import { CATEGORY_LABELS, CATEGORY_COLORS, CHART_COLORS } from '../types';

function formatJST(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: tz() });
}

function formatTimeRemaining(until: string | null, hLabel: string, mLabel: string, clearedLabel: string): string {
  if (!until) return '---';
  const remaining = new Date(until).getTime() - Date.now();
  if (remaining <= 0) return clearedLabel;
  const mins = Math.ceil(remaining / 60000);
  if (mins >= 60) return `${Math.floor(mins / 60)}${hLabel}${mins % 60}${mLabel}`;
  return `${mins}${mLabel}`;
}

function getNextCronJST(): string {
  const now = new Date();
  const jst = new Date(now.toLocaleString('en-US', { timeZone: tz() }));
  const hours = [9, 11, 14, 17, 20];
  const currentHour = jst.getHours();
  const currentMin = jst.getMinutes();

  for (const h of hours) {
    if (h > currentHour || (h === currentHour && currentMin < 0)) {
      return `${h}:00 JST`;
    }
  }
  return '';
}

export default function Overview() {
  const { activeBotId } = useBotContext();
  const { t } = useI18n();
  const [state, setState] = useState<ProactiveState | null>(null);
  const [error, setError] = useState('');
  const [eventSources, setEventSources] = useState<Record<string, { enabled: boolean }> | null>(null);

  useEffect(() => {
    if (!activeBotId) return;
    setState(null);
    setError('');
    setEventSources(null);
    getState(activeBotId).then(setState).catch((e) => setError(e.message));
    getEventSources(activeBotId).then(setEventSources).catch(() => {});
  }, [activeBotId]);

  if (error) return <div className="text-[var(--error)]">{t('common.error')}: {error}</div>;
  if (!state) return <div className="text-[var(--text-dim)]">{t('common.loading')}</div>;

  const cooldownActive = state.cooldown.until && new Date(state.cooldown.until).getTime() > Date.now();
  const totalReactions = state.stats.positiveReactions + state.stats.negativeReactions;
  const reactionRate = state.stats.totalSent > 0
    ? ((totalReactions / state.stats.totalSent) * 100).toFixed(1)
    : '0.0';

  const recentHistory = [...state.history].reverse().slice(0, 5);

  // Build trend data from history
  const trendData = state.history
    .filter((h) => h.reaction !== null)
    .slice(-20)
    .map((h) => ({
      date: new Date(h.sentAt).toLocaleDateString('ja-JP', { timeZone: tz(), month: 'short', day: 'numeric' }),
      delta: h.reactionDelta,
    }));

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">{t('overview.title')}</h2>

      {/* Status Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-[var(--surface)] rounded-lg p-4 border border-[var(--border)]">
          <p className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium mb-1">{t('overview.cooldown')}</p>
          <p className={`text-lg font-semibold ${cooldownActive ? 'text-[var(--warning)]' : 'text-[var(--success)]'}`}>
            {cooldownActive ? t('overview.cooldown.active') : t('overview.cooldown.cleared')}
          </p>
          <p className="text-xs text-[var(--text-dim)] mt-1">
            {cooldownActive ? formatTimeRemaining(state.cooldown.until, t('common.hours'), t('common.minutes'), t('overview.cleared')) : '---'}
          </p>
        </div>
        <div className="bg-[var(--surface)] rounded-lg p-4 border border-[var(--border)]">
          <p className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium mb-1">{t('overview.lastCheck')}</p>
          <p className="text-sm font-semibold text-[var(--text)]">
            {state.lastCheckAt ? formatJST(state.lastCheckAt) : t('overview.lastCheck.none')}
          </p>
        </div>
        <div className="bg-[var(--surface)] rounded-lg p-4 border border-[var(--border)]">
          <p className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium mb-1">{t('overview.nextCheck')}</p>
          <p className="text-sm font-semibold text-[var(--text)]">{getNextCronJST() || t('overview.nextTomorrow')}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-lg p-4 border border-[var(--border)]">
          <p className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium mb-1">{t('overview.backoff')}</p>
          <p className="text-lg font-semibold text-[var(--text)]">{state.cooldown.backoffMinutes}{t('common.minutes')}</p>
        </div>
      </div>

      {/* Event Sources */}
      {eventSources && (
        <div className="bg-[var(--surface)] rounded-lg p-4 border border-[var(--border)] mb-8">
          <p className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium mb-3">{t('overview.eventSources') || 'Event Sources'}</p>
          <div className="flex flex-wrap gap-3">
            {(['gmail', 'calendar', 'rss', 'github'] as const).map((source) => {
              const cfg = eventSources[source];
              const isOn = cfg?.enabled ?? false;
              return (
                <div key={source} className="flex items-center gap-2">
                  <span className="text-sm text-[var(--text)] capitalize">{source}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    isOn
                      ? 'bg-[var(--success)]/20 text-[var(--success)]'
                      : 'bg-[var(--border)]/50 text-[var(--text-dim)]'
                  }`}>
                    {isOn ? 'ON' : 'OFF'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-[var(--surface)] rounded-lg p-4 border border-[var(--border)]">
          <p className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium mb-1">{t('overview.sent')}</p>
          <p className="text-2xl font-bold tabular-nums text-[var(--accent)]">{state.stats.totalSent}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-lg p-4 border border-[var(--border)]">
          <p className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium mb-1">{t('overview.positive')}</p>
          <p className="text-2xl font-bold tabular-nums text-[var(--success)]">{state.stats.positiveReactions}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-lg p-4 border border-[var(--border)]">
          <p className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium mb-1">{t('overview.negative')}</p>
          <p className="text-2xl font-bold tabular-nums text-[var(--error)]">{state.stats.negativeReactions}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-lg p-4 border border-[var(--border)]">
          <p className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium mb-1">{t('overview.reactionRate')}</p>
          <p className="text-2xl font-bold tabular-nums text-[var(--info)]">{reactionRate}%</p>
        </div>
      </div>

      {/* Reaction Trend Chart */}
      {trendData.length >= 3 && (
        <div className="bg-[var(--surface)] rounded-lg p-4 border border-[var(--border)] mb-8">
          <h3 className="text-base font-semibold text-[var(--text)] mb-4">{t('overview.trend')}</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="gradientDelta" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" stroke={CHART_COLORS.axis} fontSize={11} />
              <YAxis stroke={CHART_COLORS.axis} fontSize={11} />
              <Tooltip
                contentStyle={{
                  backgroundColor: CHART_COLORS.tooltip.bg,
                  border: `1px solid ${CHART_COLORS.tooltip.border}`,
                  borderRadius: '8px',
                }}
                labelStyle={{ color: CHART_COLORS.axis }}
              />
              <Area type="monotone" dataKey="delta" stroke={CHART_COLORS.primary} fill="url(#gradientDelta)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent History */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)]">
        <div className="p-4 border-b border-[var(--border)]">
          <h3 className="text-base font-semibold text-[var(--text)]">{t('overview.recentHistory')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--text-dim)] text-xs uppercase tracking-[0.05em] font-medium border-b border-[var(--border)]">
                <th className="text-left p-3">{t('overview.sentAt')}</th>
                <th className="text-left p-3">{t('overview.category')}</th>
                <th className="text-left p-3">{t('overview.reaction')}</th>
                <th className="text-right p-3">{t('overview.delta')}</th>
              </tr>
            </thead>
            <tbody>
              {recentHistory.map((entry) => (
                <tr key={entry.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-hover)]">
                  <td className="p-3 text-[var(--text)]">{formatJST(entry.sentAt)}</td>
                  <td className="p-3">
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: CATEGORY_COLORS[entry.category] + '20',
                        color: CATEGORY_COLORS[entry.category],
                      }}
                    >
                      {CATEGORY_LABELS[entry.category]}
                    </span>
                  </td>
                  <td className="p-3 text-[var(--text)]">{entry.reaction ?? '---'}</td>
                  <td className={`p-3 text-right font-mono ${
                    entry.reactionDelta > 0 ? 'text-[var(--success)]' :
                    entry.reactionDelta < 0 ? 'text-[var(--error)]' : 'text-[var(--text-dim)]'
                  }`}>
                    {entry.reactionDelta > 0 ? '+' : ''}{entry.reactionDelta}
                  </td>
                </tr>
              ))}
              {recentHistory.length === 0 && (
                <tr><td colSpan={4} className="p-4 text-center text-[var(--text-dim)]">{t('overview.noHistory')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
