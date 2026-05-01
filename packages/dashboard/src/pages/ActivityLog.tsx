import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { getState } from '../api';
import { useBotContext } from '../components/BotContext';
import { tz } from '../timezone';
import type { SuggestionHistoryEntry } from '../types';
import { CHART_COLORS } from '../types';

interface DayStats {
  date: string;
  sent: number;
  positive: number;
  negative: number;
  noReaction: number;
}

function groupByDate(history: SuggestionHistoryEntry[]): DayStats[] {
  const map = new Map<string, DayStats>();

  for (const entry of history) {
    const date = new Date(entry.sentAt).toLocaleDateString('ja-JP', { timeZone: tz() });
    if (!map.has(date)) {
      map.set(date, { date, sent: 0, positive: 0, negative: 0, noReaction: 0 });
    }
    const day = map.get(date)!;
    day.sent++;
    if (entry.reaction === null) {
      day.noReaction++;
    } else if (entry.reactionDelta > 0) {
      day.positive++;
    } else if (entry.reactionDelta < 0) {
      day.negative++;
    } else {
      day.noReaction++;
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const [aY, aM, aD] = a.date.split('/').map(Number);
    const [bY, bM, bD] = b.date.split('/').map(Number);
    return (aY - bY) || (aM - bM) || (aD - bD);
  });
}

export default function ActivityLog() {
  const { activeBotId } = useBotContext();
  const [days, setDays] = useState<DayStats[]>([]);

  useEffect(() => {
    if (!activeBotId) return;
    getState(activeBotId).then((s) => setDays(groupByDate(s.history)));
  }, [activeBotId]);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">アクティビティ</h2>

      {/* Chart */}
      {days.length > 0 && (
        <div className="bg-[var(--surface)] rounded-lg p-4 border border-[var(--border)] mb-8">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={days}>
              <XAxis dataKey="date" stroke={CHART_COLORS.axis} fontSize={11} />
              <YAxis stroke={CHART_COLORS.axis} fontSize={11} />
              <Tooltip
                contentStyle={{ backgroundColor: CHART_COLORS.tooltip.bg, border: `1px solid ${CHART_COLORS.tooltip.border}`, borderRadius: '8px' }}
              />
              <Legend />
              <Line type="monotone" dataKey="sent" name="送信" stroke={CHART_COLORS.primary} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="positive" name="ポジティブ" stroke="#4a8a4a" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="negative" name="ネガティブ" stroke="#b85040" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Day breakdown */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--text-dim)] text-xs uppercase tracking-[0.05em] font-medium border-b border-[var(--border)]">
              <th className="text-left p-3">日付</th>
              <th className="text-center p-3">送信数</th>
              <th className="text-center p-3">ポジティブ</th>
              <th className="text-center p-3">ネガティブ</th>
              <th className="text-center p-3">未反応</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((day) => (
              <tr key={day.date} className="border-b border-[var(--border)] hover:bg-[var(--surface-hover)]">
                <td className="p-3 text-[var(--text)]">{day.date}</td>
                <td className="p-3 text-center text-[var(--accent)] font-mono">{day.sent}</td>
                <td className="p-3 text-center text-[var(--success)] font-mono">{day.positive}</td>
                <td className="p-3 text-center text-[var(--error)] font-mono">{day.negative}</td>
                <td className="p-3 text-center text-[var(--text-dim)] font-mono">{day.noReaction}</td>
              </tr>
            ))}
            {days.length === 0 && (
              <tr><td colSpan={5} className="p-4 text-center text-[var(--text-dim)]">データなし</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
