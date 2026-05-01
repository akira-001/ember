import { useEffect, useState } from 'react';
import { getConstants, updateConstants, restartBot } from '../api';
import { useBotContext } from '../components/BotContext';
import type { Constants } from '../types';

interface ConstantDef {
  key: keyof Constants;
  label: string;
  description: string;
  step: number;
}

const CONSTANT_DEFS: ConstantDef[] = [
  { key: 'LEARNING_RATE', label: 'LEARNING_RATE', description: '重み更新の学習率', step: 0.01 },
  { key: 'WEIGHT_MIN', label: 'WEIGHT_MIN', description: 'カテゴリ重みの下限', step: 0.01 },
  { key: 'WEIGHT_MAX', label: 'WEIGHT_MAX', description: 'カテゴリ重みの上限', step: 0.1 },
  { key: 'MAX_HISTORY', label: 'MAX_HISTORY', description: '履歴保持数の上限', step: 10 },
  { key: 'MAX_BACKOFF_MINUTES', label: 'MAX_BACKOFF_MINUTES', description: '最大バックオフ時間(分)', step: 30 },
  { key: 'INSIGHT_BASE_HALF_LIFE', label: 'INSIGHT_BASE_HALF_LIFE', description: 'インサイト減衰の基本半減期(日)', step: 5 },
  { key: 'INSIGHT_DECAY_FLOOR', label: 'INSIGHT_DECAY_FLOOR', description: '減衰の下限値', step: 0.05 },
  { key: 'INSIGHT_DEFAULT_AROUSAL', label: 'INSIGHT_DEFAULT_AROUSAL', description: 'デフォルトのarousal値', step: 0.05 },
  { key: 'INSIGHT_REINFORCE_DELTA', label: 'INSIGHT_REINFORCE_DELTA', description: '強化時のarousal増加量', step: 0.01 },
  { key: 'INSIGHT_ACTIVE_THRESHOLD', label: 'INSIGHT_ACTIVE_THRESHOLD', description: 'アクティブ判定の閾値', step: 0.05 },
  { key: 'INSIGHT_SIMILARITY_THRESHOLD', label: 'INSIGHT_SIMILARITY_THRESHOLD', description: '類似度判定の閾値', step: 0.01 },
];

export default function ConstantsPage() {
  const { activeBotId, bots } = useBotContext();
  const botName = bots.find((b) => b.id === activeBotId)?.name || activeBotId;
  const [values, setValues] = useState<Constants | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!activeBotId) return;
    getConstants(activeBotId).then(setValues);
  }, [activeBotId]);

  if (!values) return <div className="text-[var(--text-dim)]">読み込み中...</div>;

  const handleChange = (key: keyof Constants, val: string) => {
    const num = parseFloat(val);
    if (!isNaN(num)) {
      setValues((prev) => prev ? { ...prev, [key]: num } : prev);
    }
  };

  const handleSave = async () => {
    if (!values) return;
    setSaving(true);
    try {
      await updateConstants(activeBotId, values);
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

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">定数設定 <span className="text-lg font-normal text-[var(--accent)]">— {botName}</span></h2>

      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {CONSTANT_DEFS.map((def) => (
            <div key={def.key} className="bg-[var(--bg)]/50 rounded-lg p-4 border border-[var(--border)]/50">
              <label className="text-xs font-mono text-[var(--accent)] block mb-1">{def.label}</label>
              <p className="text-xs text-[var(--text-dim)] mb-2">{def.description}</p>
              <input
                type="number"
                step={def.step}
                value={values[def.key]}
                onChange={(e) => handleChange(def.key, e.target.value)}
                className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-3 py-2 text-sm text-[var(--text)] font-mono focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-6 pt-4 border-t border-[var(--border)]">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? '保存中...' : '全て保存'}
          </button>
          <button
            onClick={handleSaveAndRestart}
            disabled={saving}
            className="px-4 py-2 bg-[var(--success)] hover:brightness-110 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
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
