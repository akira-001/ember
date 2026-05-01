import { useEffect, useState } from 'react';
import { getModelsLimits, updateModelsLimits, restartBot } from '../api';
import { useBotContext } from '../components/BotContext';

const MODEL_OPTIONS = ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6'];

interface FormData {
  models: { chat: string; cron: string };
  rateLimits: {
    messagesPerMinute: number;
    botToBotMaxTurns: number;
    dailyLimit: number;
    cooldownMs: number;
  };
  tokenBudget: { hourlyUsd: number; dailyUsd: number };
}

export default function ModelsLimits() {
  const { activeBotId, bots } = useBotContext();
  const botName = bots.find((b) => b.id === activeBotId)?.name || activeBotId;
  const [data, setData] = useState<FormData | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!activeBotId) return;
    getModelsLimits(activeBotId).then((res) => {
      setData({
        models: res.models || { chat: 'claude-sonnet-4-6', cron: 'claude-haiku-4-5' },
        rateLimits: res.rateLimits || { messagesPerMinute: 10, botToBotMaxTurns: 5, dailyLimit: 200, cooldownMs: 3000 },
        tokenBudget: res.tokenBudget || { hourlyUsd: 1, dailyUsd: 10 },
      });
    });
  }, [activeBotId]);

  if (!data) return <div className="text-[var(--text-dim)]">読み込み中...</div>;

  const updateField = <K extends keyof FormData>(section: K, key: string, value: string | number) => {
    setData((prev) => {
      if (!prev) return prev;
      return { ...prev, [section]: { ...prev[section], [key]: value } };
    });
  };

  const handleSave = async () => {
    if (!data) return;
    setSaving(true);
    try {
      await updateModelsLimits(activeBotId, data);
      setMessage('保存しました');
      setTimeout(() => setMessage(''), 2000);
    } catch (e: any) {
      setMessage(`エラー: ${e.message}`);
    }
    setSaving(false);
  };

  const handleSaveAndRestart = async () => {
    if (!data) return;
    setSaving(true);
    try {
      await updateModelsLimits(activeBotId, data);
      await restartBot();
      setMessage('保存してBotに反映しました');
      setTimeout(() => setMessage(''), 3000);
    } catch (e: any) {
      setMessage(`エラー: ${e.message}`);
    }
    setSaving(false);
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">モデル & リミット <span className="text-lg font-normal text-[var(--accent)]">— {botName}</span></h2>

      {/* Model Selection */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <h3 className="text-lg font-semibold mb-4">モデル選択</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium block mb-1">Chat Model</label>
            <select
              value={data.models.chat}
              onChange={(e) => updateField('models', 'chat', e.target.value)}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium block mb-1">Cron Model</label>
            <select
              value={data.models.cron}
              onChange={(e) => updateField('models', 'cron', e.target.value)}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Rate Limits */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <h3 className="text-lg font-semibold mb-4">レートリミット</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {([
            { key: 'messagesPerMinute', label: 'Messages / Minute' },
            { key: 'botToBotMaxTurns', label: 'Bot-to-Bot Max Turns' },
            { key: 'dailyLimit', label: 'Daily Limit' },
            { key: 'cooldownMs', label: 'Cooldown (ms)' },
          ] as const).map(({ key, label }) => (
            <div key={key}>
              <label className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium block mb-1">{label}</label>
              <input
                type="number"
                value={data.rateLimits[key]}
                onChange={(e) => updateField('rateLimits', key, parseInt(e.target.value) || 0)}
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Token Budget */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <h3 className="text-lg font-semibold mb-4">トークン予算</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium block mb-1">Hourly Budget</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--text-dim)]">$</span>
              <input
                type="number"
                step="0.1"
                value={data.tokenBudget.hourlyUsd}
                onChange={(e) => updateField('tokenBudget', 'hourlyUsd', parseFloat(e.target.value) || 0)}
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium block mb-1">Daily Budget</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--text-dim)]">$</span>
              <input
                type="number"
                step="0.1"
                value={data.tokenBudget.dailyUsd}
                onChange={(e) => updateField('tokenBudget', 'dailyUsd', parseFloat(e.target.value) || 0)}
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>
        </div>
      </div>

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
  );
}
