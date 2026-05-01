import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { getState, updateWeights, restartBot } from '../api';
import { useBotContext } from '../components/BotContext';
import type { SuggestionCategory } from '../types';
import { CATEGORY_LABELS, CATEGORY_COLORS, CHART_COLORS } from '../types';

const CATEGORIES: SuggestionCategory[] = [
  'email_reply', 'meeting_prep', 'deadline_risk', 'slack_followup',
  'energy_break', 'personal_event', 'hobby_leisure', 'flashback',
];

export default function CategoryWeights() {
  const { activeBotId, bots } = useBotContext();
  const botName = bots.find((b) => b.id === activeBotId)?.name || activeBotId;
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!activeBotId) return;
    getState(activeBotId).then((s) => setWeights(s.categoryWeights));
  }, [activeBotId]);

  const chartData = CATEGORIES.map((cat) => ({
    name: CATEGORY_LABELS[cat],
    category: cat,
    value: weights[cat] ?? 1.0,
  }));

  const handleChange = (cat: string, value: number) => {
    setWeights((prev) => ({ ...prev, [cat]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateWeights(activeBotId, weights);
      setMessage('保存しました');
      setTimeout(() => setMessage(''), 2000);
    } catch (e: any) {
      setMessage(`エラー: ${e.message}`);
    }
    setSaving(false);
  };

  const handleSaveAndRestart = async () => {
    await handleSave();
    setSaving(true);
    try {
      await restartBot();
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    const reset: Record<string, number> = {};
    CATEGORIES.forEach((c) => (reset[c] = 1.0));
    setWeights(reset);
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">カテゴリ重み <span className="text-lg font-normal text-[var(--accent)]">— {botName}</span></h2>

      {/* Chart */}
      <div className="bg-[var(--surface)] rounded-lg p-4 border border-[var(--border)] mb-8">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 100 }}>
            <XAxis type="number" domain={[0, 2]} stroke={CHART_COLORS.axis} fontSize={11} />
            <YAxis type="category" dataKey="name" stroke={CHART_COLORS.axis} fontSize={12} width={95} />
            <Tooltip
              contentStyle={{ backgroundColor: CHART_COLORS.tooltip.bg, border: `1px solid ${CHART_COLORS.tooltip.border}`, borderRadius: '8px' }}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {chartData.map((entry) => (
                <Cell key={entry.category} fill={CATEGORY_COLORS[entry.category]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Sliders */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-6">
        <div className="space-y-5">
          {CATEGORIES.map((cat) => (
            <div key={cat} className="flex items-center gap-4">
              <span
                className="w-32 text-sm font-medium shrink-0"
                style={{ color: CATEGORY_COLORS[cat] }}
              >
                {CATEGORY_LABELS[cat]}
              </span>
              <input
                type="range"
                min={0.05}
                max={2.0}
                step={0.05}
                value={weights[cat] ?? 1.0}
                onChange={(e) => handleChange(cat, parseFloat(e.target.value))}
                className="flex-1 accent-[var(--accent)]"
              />
              <span className="w-14 text-right font-mono text-sm text-[var(--text)]">
                {(weights[cat] ?? 1.0).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-6 pt-4 border-t border-[var(--border)]">
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
          <button
            onClick={handleReset}
            className="px-4 py-2 bg-[var(--border)] hover:bg-[var(--text-dim)] rounded-lg text-sm font-medium transition-colors"
          >
            全てリセット (1.0)
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
