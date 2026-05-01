import { useEffect, useState, useCallback } from 'react';
import { tz } from '../timezone';

interface ThoughtEntry {
  timestamp: string;
  timeDisplay?: string;
  bot: string;
  type: 'send' | 'skip' | 'reaction' | 'reply' | 'reflect';
  decision?: 'send' | 'no_reply';
  modeEstimate?: string;
  message?: string;
  reason?: string;
  inner_thought?: string;
  plan?: string[];
  generate_score?: number[];
  evaluate_score?: number;
  category?: string;
  emoji?: string;
  replyPreview?: string;
}

const POLL_INTERVAL_MS = 30_000;
const DAYS = 7;

function formatJST(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ja-JP', { timeZone: tz(), month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function decisionLabel(e: ThoughtEntry): string {
  if (e.type === 'send') return 'SEND';
  if (e.type === 'skip') return 'SKIP';
  if (e.type === 'reaction') return `REACT :${e.emoji ?? '?'}:`;
  if (e.type === 'reply') return 'REPLY';
  if (e.type === 'reflect') return 'REFLECT';
  return e.type ?? '?';
}

function decisionTone(e: ThoughtEntry): string {
  if (e.type === 'send') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (e.type === 'skip') return 'border-slate-500/30 bg-slate-500/10 text-slate-200';
  if (e.type === 'reaction') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  if (e.type === 'reply') return 'border-sky-500/30 bg-sky-500/10 text-sky-200';
  return 'border-[var(--border)] bg-black/10 text-[var(--text-dim)]';
}

function topicOf(e: ThoughtEntry): string {
  if (e.message) return e.message.split('\n')[0].substring(0, 100);
  if (e.reason) return e.reason.substring(0, 100);
  if (e.replyPreview) return e.replyPreview.substring(0, 100);
  return '—';
}

export default function ThoughtTracePage() {
  const [entries, setEntries] = useState<ThoughtEntry[]>([]);
  const [filter, setFilter] = useState<'all' | 'mei' | 'eve'>('all');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchEntries = useCallback(async () => {
    try {
      const resp = await fetch(`/api/thought-trace?days=${DAYS}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setEntries(data.entries || []);
      setErr(null);
      setLastFetched(new Date());
    } catch (e: any) {
      setErr(e.message || 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
    const id = setInterval(fetchEntries, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchEntries]);

  const filtered = filter === 'all' ? entries : entries.filter(e => e.bot === filter);
  const innerThoughtFilled = filtered.filter(e => !!e.inner_thought).length;
  const fillRate = filtered.length > 0 ? Math.round((innerThoughtFilled / filtered.length) * 100) : 0;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--text)] mb-2">思考トレース</h1>
        <p className="text-sm text-[var(--text-dim)]">
          bot の事前 inner thought / Plan-Generate-Evaluate スコア。直近 {DAYS} 日。Inner Thoughts paper (arxiv 2501.00383) + Anthropic Plan-Generate-Evaluate。
        </p>
      </header>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
          {(['all', 'mei', 'eve'] as const).map(b => (
            <button
              key={b}
              onClick={() => setFilter(b)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                filter === b
                  ? 'bg-[var(--accent)]/20 text-[var(--text)]'
                  : 'text-[var(--text-dim)] hover:text-[var(--text)]'
              }`}
            >
              {b === 'all' ? '全 bot' : b}
            </button>
          ))}
        </div>
        <div className="text-xs text-[var(--text-dim)]">
          {filtered.length} 件 / inner_thought 充填率 <span className={fillRate >= 50 ? 'text-emerald-300' : 'text-amber-300'}>{fillRate}%</span>
        </div>
        <div className="ml-auto text-xs text-[var(--text-dim)]">
          {loading ? '読み込み中…' : lastFetched ? `更新 ${formatJST(lastFetched.toISOString())}` : ''}
        </div>
      </div>

      {err && (
        <div className="mb-4 px-3 py-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-200 text-sm">
          エラー: {err}
        </div>
      )}

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black/20 text-[10px] uppercase tracking-[0.18em] text-[var(--text-dim)]">
            <tr>
              <th className="text-left px-3 py-2 font-medium">時刻</th>
              <th className="text-left px-3 py-2 font-medium">Bot</th>
              <th className="text-left px-3 py-2 font-medium">判定</th>
              <th className="text-left px-3 py-2 font-medium">内なる声</th>
              <th className="text-left px-3 py-2 font-medium">話題 / 理由</th>
              <th className="text-right px-3 py-2 font-medium">eval</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-[var(--text-dim)]">エントリなし</td>
              </tr>
            )}
            {filtered.map((e, i) => (
              <tr key={`${e.timestamp}-${e.bot}-${i}`} className="border-t border-[var(--border)] hover:bg-black/10">
                <td className="px-3 py-2 text-[var(--text-dim)] font-mono text-xs whitespace-nowrap">{formatJST(e.timestamp)}</td>
                <td className="px-3 py-2 text-[var(--text)] uppercase text-xs">{e.bot}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${decisionTone(e)}`}>
                    {decisionLabel(e)}
                  </span>
                </td>
                <td className="px-3 py-2 text-[var(--text)] max-w-md">
                  {e.inner_thought ? (
                    <span title={e.plan ? `候補: ${e.plan.join(' / ')}${e.generate_score ? ` [${e.generate_score.map(s => s.toFixed(2)).join(', ')}]` : ''}` : undefined}>
                      “{e.inner_thought}”
                    </span>
                  ) : (
                    <span className="text-[var(--text-dim)]">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-[var(--text-dim)] max-w-md truncate">{topicOf(e)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {e.evaluate_score != null ? (
                    <span className={e.evaluate_score >= 0.7 ? 'text-emerald-300' : e.evaluate_score >= 0.4 ? 'text-amber-300' : 'text-slate-400'}>
                      {e.evaluate_score.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-[var(--text-dim)]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
