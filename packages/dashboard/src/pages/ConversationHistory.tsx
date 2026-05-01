import { useEffect, useState } from 'react';
import { getState } from '../api';
import { useBotContext } from '../components/BotContext';
import { tz } from '../timezone';
import type { SuggestionCategory, SuggestionHistoryEntry } from '../types';
import { CATEGORY_LABELS, CATEGORY_COLORS } from '../types';

const ALL_CATEGORIES: SuggestionCategory[] = [
  'email_reply', 'meeting_prep', 'deadline_risk', 'slack_followup',
  'energy_break', 'personal_event', 'hobby_leisure', 'flashback',
];

function formatJST(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: tz() });
}

export default function ConversationHistory() {
  const { activeBotId } = useBotContext();
  const [history, setHistory] = useState<SuggestionHistoryEntry[]>([]);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    if (!activeBotId) return;
    getState(activeBotId).then((s) => setHistory([...s.history].reverse()));
  }, [activeBotId]);

  const filtered = filter === 'all'
    ? history.slice(0, 30)
    : history.filter((h) => h.category === filter).slice(0, 30);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">会話履歴</h2>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
        >
          <option value="all">全カテゴリ</option>
          {ALL_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
          ))}
        </select>
      </div>

      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--text-dim)] text-xs uppercase tracking-[0.05em] font-medium border-b border-[var(--border)]">
              <th className="text-left p-3">送信日時</th>
              <th className="text-left p-3">カテゴリ</th>
              <th className="text-left p-3">反応</th>
              <th className="text-right p-3">デルタ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <tr key={entry.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-hover)]">
                <td className="p-3 text-[var(--text)] whitespace-nowrap">{formatJST(entry.sentAt)}</td>
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
                <td className={`p-3 ${
                  entry.reaction === null ? 'text-[var(--text-dim)]' :
                  entry.reactionDelta > 0 ? 'text-[var(--success)]' :
                  entry.reactionDelta < 0 ? 'text-[var(--error)]' : 'text-[var(--text-dim)]'
                }`}>
                  {entry.reaction ?? '---'}
                </td>
                <td className={`p-3 text-right font-mono ${
                  entry.reactionDelta > 0 ? 'text-[var(--success)]' :
                  entry.reactionDelta < 0 ? 'text-[var(--error)]' : 'text-[var(--text-dim)]'
                }`}>
                  {entry.reactionDelta > 0 ? '+' : ''}{entry.reactionDelta}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="p-4 text-center text-[var(--text-dim)]">履歴なし</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
