import { useEffect, useState, useCallback } from 'react';
import { getInsights, addInsight, updateInsight, deleteInsight, getImplicitMemory, getImplicitMemoryStats, deleteImplicitMemoryEntry } from '../api';
import { useBotContext } from '../components/BotContext';
import { tz } from '../timezone';
import type { UserInsight } from '../types';

function formatJST(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: tz() });
}

function calcDecay(learnedAt: string, arousal: number): number {
  const daysOld = (Date.now() - new Date(learnedAt).getTime()) / 86400000;
  if (daysOld <= 0) return 1.0;
  const halfLife = 60 * (1 + arousal);
  const decay = Math.pow(0.5, daysOld / halfLife);
  return Math.max(0.3, decay);
}

function arousalColor(arousal: number): string {
  if (arousal < 0.3) return 'text-[var(--error)]';
  if (arousal < 0.6) return 'text-[var(--warning)]';
  return 'text-[var(--success)]';
}

const TABS = [
  { key: 'facts', label: '事実' },
  { key: 'preferences', label: '嗜好' },
  { key: 'patterns', label: 'パターン' },
  { key: 'values', label: '価値観' },
  { key: 'expressions', label: '言い回し' },
  { key: 'corrections', label: '修正履歴' },
  { key: 'legacy', label: 'レガシー' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const LAYER_KEYS = ['facts', 'preferences', 'patterns', 'values', 'expressions'] as const;

interface MemoryEntry {
  id: string;
  content: string;
  context: string;
  source: string;
  confidence: number;
  intensity?: string;
  learnedAt: string;
  lastReinforcedAt: string;
  reinforceCount: number;
}

interface CorrectionEntry {
  id: string;
  originalMemoryId: string;
  trigger: 'explicit_denial' | 'contradiction' | 'pattern_shift';
  before: string;
  after: string;
  reason: string;
  correctedAt: string;
}

interface ImplicitMemoryData {
  facts: MemoryEntry[];
  preferences: MemoryEntry[];
  patterns: MemoryEntry[];
  values: MemoryEntry[];
  expressions: MemoryEntry[];
  corrections: CorrectionEntry[];
}

function confidenceColor(c: number): string {
  if (c >= 0.7) return 'var(--success)';
  if (c >= 0.4) return 'var(--warning)';
  return 'var(--error)';
}

function sourceBadge(source: string) {
  const colors: Record<string, string> = {
    listening: 'var(--accent)',
    slack_message: 'var(--success)',
    slack_reaction: 'var(--warning)',
    proactive: 'var(--info, var(--accent))',
    calendar: 'var(--warning)',
    email: 'var(--error)',
    rss: 'var(--text-dim)',
    inferred: 'var(--text-dim)',
  };
  const bg = colors[source] || 'var(--text-dim)';
  return (
    <span
      style={{ backgroundColor: bg, opacity: 0.85 }}
      className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium text-white"
    >
      {source}
    </span>
  );
}

function triggerBadge(trigger: CorrectionEntry['trigger']) {
  const map: Record<string, { label: string; color: string }> = {
    explicit_denial: { label: '否定', color: 'var(--error)' },
    contradiction: { label: '矛盾', color: 'var(--warning)' },
    pattern_shift: { label: '変化', color: 'var(--accent)' },
  };
  const { label, color } = map[trigger] || { label: trigger, color: 'var(--text-dim)' };
  return (
    <span
      style={{ backgroundColor: color, opacity: 0.85 }}
      className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium text-white"
    >
      {label}
    </span>
  );
}

// ---- Legacy sub-component (old insights table) ----
function LegacyInsights() {
  const [insights, setInsights] = useState<UserInsight[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [formText, setFormText] = useState('');
  const [formArousal, setFormArousal] = useState(0.5);
  const [error, setError] = useState('');

  const load = () => {
    getInsights().then(setInsights).catch((e) => setError(e.message));
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    try {
      await addInsight({ insight: formText, arousal: formArousal, source: 'dashboard' });
      setShowForm(false);
      setFormText('');
      setFormArousal(0.5);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleUpdate = async () => {
    if (editIndex === null) return;
    try {
      await updateInsight(editIndex, { insight: formText, arousal: formArousal });
      setEditIndex(null);
      setFormText('');
      setFormArousal(0.5);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDelete = async (index: number) => {
    if (!confirm('このインサイトを削除しますか?')) return;
    try {
      await deleteInsight(index);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const startEdit = (index: number) => {
    setEditIndex(index);
    setFormText(insights[index].insight);
    setFormArousal(insights[index].arousal);
    setShowForm(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-[var(--text-dim)]">旧インサイトシステム (user-insights.json)</p>
        <button
          onClick={() => { setShowForm(true); setEditIndex(null); setFormText(''); setFormArousal(0.5); }}
          className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors"
        >
          追加
        </button>
      </div>

      {error && <div className="text-[var(--error)] mb-4 text-sm">{error}</div>}

      {(showForm || editIndex !== null) && (
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-4 mb-6">
          <div className="space-y-3">
            <div>
              <label className="text-xs text-[var(--text-dim)] block mb-1">インサイト</label>
              <input
                value={formText}
                onChange={(e) => setFormText(e.target.value)}
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                placeholder="Akiraさんについてのインサイト..."
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-dim)] block mb-1">Arousal: {formArousal.toFixed(2)}</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={formArousal}
                onChange={(e) => setFormArousal(parseFloat(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={editIndex !== null ? handleUpdate : handleAdd}
                className="px-4 py-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded text-sm transition-colors"
              >
                {editIndex !== null ? '更新' : '追加'}
              </button>
              <button
                onClick={() => { setShowForm(false); setEditIndex(null); }}
                className="px-4 py-1.5 bg-[var(--surface-hover)] hover:bg-[var(--border)] rounded text-sm transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--text-dim)] text-xs uppercase tracking-[0.05em] font-medium border-b border-[var(--border)]">
              <th className="text-left p-3">インサイト</th>
              <th className="text-center p-3">Arousal</th>
              <th className="text-center p-3">強化回数</th>
              <th className="text-center p-3">Decay</th>
              <th className="text-left p-3">学習日時</th>
              <th className="text-right p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {insights.map((ins, i) => {
              const decay = calcDecay(ins.learnedAt, ins.arousal);
              return (
                <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--surface-hover)]">
                  <td className="p-3 text-[var(--text)] max-w-md truncate">{ins.insight}</td>
                  <td className={`p-3 text-center font-mono ${arousalColor(ins.arousal)}`}>
                    {ins.arousal.toFixed(2)}
                  </td>
                  <td className="p-3 text-center text-[var(--text)]">{ins.reinforceCount}</td>
                  <td className="p-3 text-center font-mono text-[var(--text)]">{decay.toFixed(3)}</td>
                  <td className="p-3 text-[var(--text-dim)] text-xs whitespace-nowrap">{formatJST(ins.learnedAt)}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => startEdit(i)}
                      className="text-[var(--accent)] hover:opacity-80 text-xs mr-3"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => handleDelete(i)}
                      className="text-[var(--error)] hover:opacity-80 text-xs"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              );
            })}
            {insights.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-center text-[var(--text-dim)]">インサイトなし</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Main Page ----
export default function UserInsightsPage() {
  const { activeBotId } = useBotContext();
  const [tab, setTab] = useState<TabKey>('facts');
  const [memory, setMemory] = useState<ImplicitMemoryData | null>(null);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!activeBotId) return;
    setLoading(true);
    try {
      const [mem, st] = await Promise.all([
        getImplicitMemory(activeBotId),
        getImplicitMemoryStats(activeBotId),
      ]);
      setMemory(mem);
      setStats(st);
      setError('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [activeBotId]);

  useEffect(() => { load(); }, [load]);

  const handleDeleteEntry = async (layer: string, id: string) => {
    if (!activeBotId) return;
    if (!confirm('このエントリを削除しますか?')) return;
    try {
      await deleteImplicitMemoryEntry(activeBotId, layer, id);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const entries = memory && tab !== 'corrections' && tab !== 'legacy'
    ? (memory[tab as keyof Omit<ImplicitMemoryData, 'corrections'>] as MemoryEntry[])
    : [];

  const corrections = memory?.corrections ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">ユーザーインサイト</h2>
        {loading && <span className="text-xs text-[var(--text-dim)]">読み込み中...</span>}
      </div>

      {error && <div className="text-[var(--error)] mb-4 text-sm">{error}</div>}

      {/* Stats summary */}
      {stats && (
        <div className="flex gap-3 mb-6 flex-wrap">
          {LAYER_KEYS.map((k) => (
            <div key={k} className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-center min-w-[80px]">
              <div className="text-lg font-bold text-[var(--text)]">{stats[k] ?? 0}</div>
              <div className="text-[10px] text-[var(--text-dim)]">{TABS.find(t => t.key === k)?.label}</div>
            </div>
          ))}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-center min-w-[80px]">
            <div className="text-lg font-bold text-[var(--text)]">{stats.corrections ?? 0}</div>
            <div className="text-[10px] text-[var(--text-dim)]">修正</div>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--accent)] rounded-lg px-3 py-2 text-center min-w-[80px]">
            <div className="text-lg font-bold text-[var(--accent)]">{stats.total ?? 0}</div>
            <div className="text-[10px] text-[var(--text-dim)]">合計</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-[var(--border)] overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
              tab === t.key
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-dim)] hover:text-[var(--text)]'
            }`}
          >
            {t.label}
            {stats && t.key !== 'legacy' && (
              <span className="ml-1.5 text-[10px] opacity-60">
                {t.key === 'corrections' ? (stats.corrections ?? 0) : (stats[t.key] ?? 0)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'legacy' ? (
        <LegacyInsights />
      ) : tab === 'corrections' ? (
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--text-dim)] text-xs uppercase tracking-[0.05em] font-medium border-b border-[var(--border)]">
                <th className="text-left p-3">変更前</th>
                <th className="text-center p-3"></th>
                <th className="text-left p-3">変更後</th>
                <th className="text-center p-3">トリガー</th>
                <th className="text-left p-3">理由</th>
                <th className="text-left p-3">日時</th>
              </tr>
            </thead>
            <tbody>
              {corrections.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-hover)]">
                  <td className="p-3 text-[var(--text)] max-w-[200px] truncate">{c.before}</td>
                  <td className="p-3 text-center text-[var(--text-dim)]">&rarr;</td>
                  <td className="p-3 text-[var(--text)] max-w-[200px] truncate">{c.after}</td>
                  <td className="p-3 text-center">{triggerBadge(c.trigger)}</td>
                  <td className="p-3 text-[var(--text-dim)] text-xs max-w-[200px] truncate">{c.reason}</td>
                  <td className="p-3 text-[var(--text-dim)] text-xs whitespace-nowrap">{formatJST(c.correctedAt)}</td>
                </tr>
              ))}
              {corrections.length === 0 && (
                <tr><td colSpan={6} className="p-4 text-center text-[var(--text-dim)]">修正履歴なし</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--text-dim)] text-xs uppercase tracking-[0.05em] font-medium border-b border-[var(--border)]">
                <th className="text-left p-3">内容</th>
                <th className="text-center p-3">確信度</th>
                <th className="text-center p-3">ソース</th>
                <th className="text-left p-3">最終強化</th>
                <th className="text-right p-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-hover)]">
                  <td className="p-3 text-[var(--text)] max-w-md">
                    <div className="truncate">{entry.content}</div>
                    {entry.context && (
                      <div className="text-[10px] text-[var(--text-dim)] mt-0.5 truncate">{entry.context}</div>
                    )}
                  </td>
                  <td className="p-3 text-center">
                    <div className="flex items-center gap-2 justify-center">
                      <div className="w-16 h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.round(entry.confidence * 100)}%`,
                            backgroundColor: confidenceColor(entry.confidence),
                          }}
                        />
                      </div>
                      <span className="text-xs font-mono text-[var(--text-dim)]">
                        {entry.confidence.toFixed(2)}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 text-center">{sourceBadge(entry.source)}</td>
                  <td className="p-3 text-[var(--text-dim)] text-xs whitespace-nowrap">
                    {formatJST(entry.lastReinforcedAt)}
                    {entry.reinforceCount > 0 && (
                      <span className="ml-1 text-[var(--accent)]">x{entry.reinforceCount}</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => handleDeleteEntry(tab, entry.id)}
                      className="text-[var(--error)] hover:opacity-80 text-xs"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr><td colSpan={5} className="p-4 text-center text-[var(--text-dim)]">エントリなし</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
