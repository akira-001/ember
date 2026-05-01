import { useState, useEffect } from 'react';
import { updateCollectionConfig } from '../api';
import { useI18n } from '../i18n';
import type { CollectionConfig } from '../types';

interface Props {
  config: CollectionConfig;
  onSaved: () => void;
}

const LAYER_WEIGHT_KEYS = [
  { key: 'L1', label: 'L1 Identity' },
  { key: 'L2', label: 'L2 Vision' },
  { key: 'L3', label: 'L3 Strategy' },
  { key: 'L4', label: 'L4 Execution' },
  { key: 'L5', label: 'L5 State' },
] as const;

const FREQUENCY_OPTIONS = [
  { value: 1, ja: '毎日', en: 'Daily' },
  { value: 3, ja: '3日おき', en: 'Every 3 days' },
  { value: 7, ja: '週1回', en: 'Weekly' },
  { value: 14, ja: '隔週', en: 'Biweekly' },
  { value: 30, ja: '月1回', en: 'Monthly' },
];

const CHOICE_OPTIONS = [2, 3, 4];

export default function CollectionConfigPanel({ config, onSaved }: Props) {
  const { t, lang } = useI18n();
  const [draft, setDraft] = useState<CollectionConfig>({ ...config });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setDraft({ ...config });
  }, [config]);

  const handleSave = async () => {
    setSaving(true);
    setSuccess(false);
    try {
      await updateCollectionConfig(draft);
      setSuccess(true);
      onSaved();
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      console.error('Failed to save config', e);
    } finally {
      setSaving(false);
    }
  };

  const setWeight = (lKey: string, value: number) => {
    setDraft(prev => ({
      ...prev,
      layerWeights: { ...prev.layerWeights, [lKey]: value },
    }));
  };

  return (
    <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5">
      <h3 className="text-sm font-semibold text-[var(--text)] mb-4">{t('profile.collectionConfig' as any)}</h3>

      {/* Layer Weights */}
      <div className="mb-4">
        <label className="text-xs text-[var(--text-dim)] uppercase tracking-wider font-medium mb-2 block">
          {t('profile.layerWeights' as any)}
        </label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {LAYER_WEIGHT_KEYS.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-dim)] w-24 shrink-0">{label}</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={draft.layerWeights[key] ?? 0}
                onChange={e => setWeight(key, parseFloat(e.target.value) || 0)}
                className="w-16 px-2 py-1 text-sm rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-dim)] w-24 shrink-0">L-Action</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={draft.actionReward ?? 0.15}
              onChange={e => setDraft(prev => ({ ...prev, actionReward: parseFloat(e.target.value) || 0 }))}
              className="w-16 px-2 py-1 text-sm rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>
      </div>

      {/* Frequency + Choice Count */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="text-xs text-[var(--text-dim)] uppercase tracking-wider font-medium mb-1 block">
            {t('profile.frequency' as any)}
          </label>
          <select
            value={draft.frequencyDays}
            onChange={e => setDraft(prev => ({ ...prev, frequencyDays: parseInt(e.target.value) }))}
            className="w-full px-2 py-1.5 text-sm rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          >
            {FREQUENCY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{lang === 'ja' ? opt.ja : opt.en}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--text-dim)] uppercase tracking-wider font-medium mb-1 block">
            {t('profile.choiceCount' as any)}
          </label>
          <select
            value={draft.choiceCount}
            onChange={e => setDraft(prev => ({ ...prev, choiceCount: parseInt(e.target.value) }))}
            className="w-full px-2 py-1.5 text-sm rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          >
            {CHOICE_OPTIONS.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? '...' : t('profile.save' as any)}
        </button>
        {success && (
          <span className="text-sm text-[var(--success)]">{t('common.saved' as any)}</span>
        )}
      </div>
    </div>
  );
}
