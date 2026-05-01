// dashboard/src/components/ember-chat/ChatSettings.tsx
import { useEffect, useState } from 'react';
import type { EmberSettings, Speaker, OllamaModel, YomiganaEntry, YomiganaRule } from './types';
import { SPEED_OPTIONS, STEPS_OPTIONS, TTS_ENGINES } from './types';
import { getEmberYomiganaDictionary, updateEmberYomiganaDictionary } from '../../api';

interface Props {
  settings: EmberSettings;
  speakers: Speaker[];
  botSpeakers: Record<string, Speaker[]>;
  models: OllamaModel[];
  onUpdateSetting: <K extends keyof EmberSettings>(key: K, value: EmberSettings[K]) => void;
  onUpdateSettings: (partial: Partial<EmberSettings>) => void;
  onLoadSpeakers: (engine?: string) => Promise<Speaker[]>;
  onBotEngineChange: (botId: string, engine: string) => void;
  onPreview: () => void;
  onStopAudio: () => void;
  onPlayBot: (botId: string) => void;
}

function SelectField({ label, value, onChange, children }: {
  label: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1.5 text-sm rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
      >
        {children}
      </select>
    </div>
  );
}

export default function ChatSettings({
  settings, speakers, botSpeakers, models,
  onUpdateSetting, onUpdateSettings, onLoadSpeakers, onBotEngineChange,
  onPreview, onStopAudio, onPlayBot,
}: Props) {
  const [personalDraft, setPersonalDraft] = useState<YomiganaEntry[]>(settings.yomiganaPersonalEntries || []);
  const [sharedDraft, setSharedDraft] = useState<YomiganaRule[]>([]);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [sharedError, setSharedError] = useState('');
  const [draftError, setDraftError] = useState('');
  const isIrodori = settings.ttsEngine === 'irodori';
  const isGptSovits = settings.ttsEngine === 'gptsovits';

  useEffect(() => {
    setPersonalDraft((settings.yomiganaPersonalEntries || []).map((entry) => ({
      from: entry.from || '',
      to: entry.to || '',
    })));
    setDraftError('');
  }, [settings.yomiganaPersonalEntries]);

  useEffect(() => {
    let active = true;
    setSharedLoading(true);
    getEmberYomiganaDictionary()
      .then((data) => {
        if (!active) return;
        setSharedDraft((data.entries || []).map((entry) => ({
          pattern: entry.pattern || '',
          replacement: entry.replacement || '',
        })));
        setSharedError('');
      })
      .catch(() => {
        if (!active) return;
        setSharedError('共有辞書を読み込めなかったよ');
      })
      .finally(() => {
        if (active) setSharedLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleEngineChange = async (engine: string) => {
    const newSpeakers = await onLoadSpeakers(engine);
    const updates: Partial<EmberSettings> = { ttsEngine: engine };
    if (newSpeakers.length > 0) {
      const firstId = String(newSpeakers[0].styles[0]?.id ?? '');
      updates.voiceSelect = firstId;
      // Reset bot voice only if bot has no independent engine (follows global)
      for (const botId of ['mei', 'eve'] as const) {
        const engineKey = `${botId}Engine` as keyof EmberSettings;
        if (!settings[engineKey]) {
          updates[`${botId}Voice` as keyof EmberSettings] = firstId as never;
        }
      }
    }
    onUpdateSettings(updates);
  };

  const addPersonalEntry = () => {
    setPersonalDraft((prev) => [...prev, { from: '', to: '' }]);
    setDraftError('');
  };

  const updatePersonalEntry = (index: number, key: keyof YomiganaEntry, value: string) => {
    setPersonalDraft((prev) => prev.map((entry, i) => (i === index ? { ...entry, [key]: value } : entry)));
  };

  const removePersonalEntry = (index: number) => {
    setPersonalDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const savePersonalEntries = () => {
    const normalized = personalDraft
      .map((entry) => ({
        from: entry.from.trim(),
        to: entry.to.trim(),
      }))
      .filter((entry) => entry.from && entry.to);

    const invalid = normalized.find((entry) => entry.from.length > 64 || entry.to.length > 64);
    if (invalid) {
      setDraftError('辞書の1行は64文字以内にしてね。');
      return;
    }

    onUpdateSettings({ yomiganaPersonalEntries: normalized });
    setDraftError('');
  };

  const addSharedEntry = () => {
    setSharedDraft((prev) => [...prev, { pattern: '', replacement: '' }]);
    setSharedError('');
  };

  const updateSharedEntry = (index: number, key: keyof YomiganaRule, value: string) => {
    setSharedDraft((prev) => prev.map((entry, i) => (i === index ? { ...entry, [key]: value } : entry)));
  };

  const removeSharedEntry = (index: number) => {
    setSharedDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const saveSharedEntries = async () => {
    const normalized = sharedDraft
      .map((entry) => ({
        pattern: entry.pattern.trim(),
        replacement: entry.replacement.trim(),
      }))
      .filter((entry) => entry.pattern && entry.replacement);

    const invalid = normalized.find((entry) => entry.pattern.length > 128 || entry.replacement.length > 64);
    if (invalid) {
      setSharedError('共有辞書の1行は pattern 128文字、読み 64文字以内にしてね。');
      return;
    }

    try {
      await updateEmberYomiganaDictionary(normalized);
      setSharedError('');
    } catch (e) {
      setSharedError(`共有辞書を保存できなかったよ: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      {/* Row 1: Engine, Model, Voice, Speed */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <SelectField label="TTS Engine" value={settings.ttsEngine} onChange={handleEngineChange}>
          {TTS_ENGINES.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
        </SelectField>
        <SelectField label="Model" value={settings.modelSelect} onChange={(v) => onUpdateSetting('modelSelect', v)}>
          {models.map(m => <option key={m.name} value={m.name}>{m.name} ({m.size})</option>)}
        </SelectField>
        <SelectField label="Voice" value={settings.voiceSelect} onChange={(v) => onUpdateSetting('voiceSelect', v)}>
          {speakers.map(s => s.styles.map(st => (
            <option key={st.id} value={st.id}>{s.name} - {st.name}</option>
          )))}
        </SelectField>
        {isGptSovits ? (
          <div />
        ) : isIrodori ? (
          <SelectField label="Steps" value={settings.speedSelect} onChange={(v) => onUpdateSetting('speedSelect', v)}>
            {STEPS_OPTIONS.map(s => <option key={s} value={s}>{s === 'auto' ? 'Auto' : s}</option>)}
          </SelectField>
        ) : (
          <SelectField label="Speed" value={settings.speedSelect} onChange={(v) => onUpdateSetting('speedSelect', v)}>
            {SPEED_OPTIONS.map(s => <option key={s} value={s}>{s}x</option>)}
          </SelectField>
        )}
      </div>

      {/* Row 2: Bot voices (per-bot engine) */}
      <div className="flex flex-col gap-2 mb-3">
        {['mei', 'eve'].map(botId => {
          const engineKey = `${botId}Engine` as keyof EmberSettings;
          const voiceKey = `${botId}Voice` as keyof EmberSettings;
          const speedKey = `${botId}Speed` as keyof EmberSettings;
          const botEngine = String(settings[engineKey] || settings.ttsEngine);
          const botIrodori = botEngine === 'irodori';
          const botGptSovits = botEngine === 'gptsovits';
          const botSpks = botSpeakers[botId] || speakers;
          return (
            <div key={botId} className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[var(--accent)] uppercase w-8">{botId}</span>
              <select
                value={botEngine}
                onChange={(e) => onBotEngineChange(botId, e.target.value)}
                className="w-24 px-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
              >
                {TTS_ENGINES.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
              </select>
              <select
                value={String(settings[voiceKey])}
                onChange={(e) => onUpdateSetting(voiceKey, e.target.value)}
                className="flex-1 px-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
              >
                {botSpks.map(s => s.styles.map(st => (
                  <option key={st.id} value={st.id}>{s.name} - {st.name}</option>
                )))}
              </select>
              {!botGptSovits && (
                <select
                  value={String(settings[speedKey])}
                  onChange={(e) => onUpdateSetting(speedKey, e.target.value)}
                  className="w-16 px-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                >
                  {(botIrodori ? STEPS_OPTIONS : SPEED_OPTIONS).map(s => (
                    <option key={s} value={s}>{botIrodori ? (s === 'auto' ? 'Auto' : s) : `${s}x`}</option>
                  ))}
                </select>
              )}
              <button
                onClick={() => onPlayBot(botId)}
                className="px-3 py-1 text-xs rounded border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
              >
                Play
              </button>
            </div>
          );
        })}
      </div>

      {/* Row 3: Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onUpdateSetting('proactiveEnabled', !settings.proactiveEnabled)}
          className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
            settings.proactiveEnabled
              ? 'border-[var(--success)] text-[var(--success)]'
              : 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--text-dim)]'
          }`}
        >
          Proactive {settings.proactiveEnabled ? 'ON' : 'OFF'}
        </button>
        <button
          onClick={() => onUpdateSetting('emojiEnabled', !settings.emojiEnabled)}
          className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
            settings.emojiEnabled
              ? 'border-[var(--success)] text-[var(--success)]'
              : 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--text-dim)]'
          }`}
        >
          Emoji {settings.emojiEnabled ? 'ON' : 'OFF'}
        </button>
        <button
          onClick={() => onUpdateSetting('debugMode', !settings.debugMode)}
          title="bot の inner thought / Plan-Generate-Evaluate スコアをチャット内に表示"
          className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
            settings.debugMode
              ? 'border-amber-400 text-amber-300'
              : 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--text-dim)]'
          }`}
        >
          Debug {settings.debugMode ? 'ON' : 'OFF'}
        </button>
        <button
          onClick={onPreview}
          className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--text-dim)] transition-colors"
        >
          Preview
        </button>
        <button
          onClick={() => onStopAudio()}
          className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--error)] hover:text-[var(--error)] transition-colors"
          >
          Stop
        </button>
      </div>

      {/* Row 4: Shared yomigana dictionary */}
      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.05em] font-medium text-[var(--text-dim)]">Shared Yomigana Dictionary</div>
            <p className="text-xs text-[var(--text-dim)] mt-1">
              ここで保存した内容が共有辞書になるよ。`大谷翔平` のような読みを、みんな共通で使えるようにしているよ。パターンは正規表現も使えるよ。
            </p>
          </div>
          <button
            onClick={addSharedEntry}
            className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
          >
            Add
          </button>
        </div>

        {sharedLoading ? (
          <div className="text-xs text-[var(--text-dim)] border border-dashed border-[var(--border)] rounded px-3 py-2">
            読み込み中...
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sharedDraft.length === 0 ? (
              <div className="text-xs text-[var(--text-dim)] border border-dashed border-[var(--border)] rounded px-3 py-2">
                まだ共有辞書はないよ。`Add` で追加してね。
              </div>
            ) : (
              sharedDraft.map((entry, index) => (
                <div key={`${index}-${entry.pattern}-${entry.replacement}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <input
                    value={entry.pattern}
                    onChange={(e) => updateSharedEntry(index, 'pattern', e.target.value)}
                    placeholder="パターン"
                    className="px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                  />
                  <input
                    value={entry.replacement}
                    onChange={(e) => updateSharedEntry(index, 'replacement', e.target.value)}
                    placeholder="読み"
                    className="px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    onClick={() => removeSharedEntry(index)}
                    className="px-3 py-2 text-xs rounded border border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--error)] hover:text-[var(--error)] transition-colors"
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-xs text-[var(--text-dim)]">
            {sharedDraft.filter((entry) => entry.pattern.trim() && entry.replacement.trim()).length} 件の候補
          </div>
          <div className="flex items-center gap-2">
            {sharedError && <span className="text-xs text-[var(--error)]">{sharedError}</span>}
            <button
              onClick={saveSharedEntries}
              className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>

      {/* Row 5: Personal yomigana dictionary */}
      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.05em] font-medium text-[var(--text-dim)]">Yomigana Dictionary</div>
            <p className="text-xs text-[var(--text-dim)] mt-1">
              ここは個人辞書の上書き用だよ。共有辞書より優先して、`Akira` のような読み間違えを必要に応じて追加できるよ。
            </p>
          </div>
          <button
            onClick={addPersonalEntry}
            className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
          >
            Add
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {personalDraft.length === 0 ? (
            <div className="text-xs text-[var(--text-dim)] border border-dashed border-[var(--border)] rounded px-3 py-2">
              まだ個人辞書はないよ。`Add` で追加してね。
            </div>
          ) : (
            personalDraft.map((entry, index) => (
              <div key={`${index}-${entry.from}-${entry.to}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <input
                  value={entry.from}
                  onChange={(e) => updatePersonalEntry(index, 'from', e.target.value)}
                  placeholder="対象の文字列"
                  className="px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
                <input
                  value={entry.to}
                  onChange={(e) => updatePersonalEntry(index, 'to', e.target.value)}
                  placeholder="読み"
                  className="px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  onClick={() => removePersonalEntry(index)}
                  className="px-3 py-2 text-xs rounded border border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--error)] hover:text-[var(--error)] transition-colors"
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-xs text-[var(--text-dim)]">
            {personalDraft.filter((entry) => entry.from.trim() && entry.to.trim()).length} 件の候補
          </div>
          <div className="flex items-center gap-2">
            {draftError && <span className="text-xs text-[var(--error)]">{draftError}</span>}
            <button
              onClick={savePersonalEntries}
              className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
