import { useEffect, useState } from 'react';
import { getPersonalityTemplates, getPrompt, generatePrompt, updatePrompt, restartBot } from '../api';
import { useBotContext } from '../components/BotContext';
import type { PersonalityTemplate, BackgroundMotifTemplate } from '../types';

export default function PersonalityConfig() {
  const { activeBotId, bots } = useBotContext();
  const [types, setTypes] = useState<PersonalityTemplate[]>([]);
  const [motifs, setMotifs] = useState<BackgroundMotifTemplate[]>([]);
  const [selectedType, setSelectedType] = useState('');
  const [selectedMotif, setSelectedMotif] = useState('');
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPersonalityTemplates().then((data) => {
      setTypes(data.types);
      setMotifs(data.motifs);
    });
  }, []);

  useEffect(() => {
    if (!activeBotId) return;
    setLoading(true);
    getPrompt(activeBotId)
      .then((data) => {
        setPrompt(data.prompt || '');
        if (data.personality?.type) setSelectedType(data.personality.type);
        if (data.personality?.motif) setSelectedMotif(data.personality.motif);
      })
      .finally(() => setLoading(false));
  }, [activeBotId]);

  const botName = bots.find((b) => b.id === activeBotId)?.name || activeBotId;

  const handleGenerate = async () => {
    if (!selectedType || !selectedMotif) {
      setMessage('タイプとモチーフを両方選択してください');
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    setGenerating(true);
    try {
      const result = await generatePrompt(botName, selectedType, selectedMotif);
      setPrompt(result.prompt);
      setMessage('プロンプトを生成しました');
      setTimeout(() => setMessage(''), 2000);
    } catch (e: any) {
      setMessage(`エラー: ${e.message}`);
    }
    setGenerating(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updatePrompt(activeBotId, prompt);
      setMessage('保存しました');
      setTimeout(() => setMessage(''), 2000);
    } catch (e: any) {
      setMessage(`エラー: ${e.message}`);
    }
    setSaving(false);
  };

  const handleSaveAndRestart = async () => {
    setSaving(true);
    try {
      await updatePrompt(activeBotId, prompt);
      await restartBot();
      setMessage('保存してBotに反映しました');
      setTimeout(() => setMessage(''), 3000);
    } catch (e: any) {
      setMessage(`エラー: ${e.message}`);
    }
    setSaving(false);
  };

  if (loading) return <div className="text-[var(--text-dim)]">読み込み中...</div>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">パーソナリティ設定</h2>

      {/* Personality Types */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <h3 className="text-lg font-semibold mb-4">パーソナリティタイプ</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {types.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedType(t.id)}
              className={`text-left p-4 rounded-lg border transition-colors ${
                selectedType === t.id
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                  : 'border-[var(--border)] bg-[var(--bg)] hover:border-[var(--text-dim)]'
              }`}
            >
              <div className="text-sm font-medium text-[var(--text)]">{t.label}</div>
              <div className="text-xs text-[var(--text-dim)] mt-1">{t.thinkingStyle}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Background Motifs */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <h3 className="text-lg font-semibold mb-4">背景モチーフ</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {motifs.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelectedMotif(m.id)}
              className={`text-left p-4 rounded-lg border transition-colors ${
                selectedMotif === m.id
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                  : 'border-[var(--border)] bg-[var(--bg)] hover:border-[var(--text-dim)]'
              }`}
            >
              <div className="text-sm font-medium text-[var(--text)]">{m.label}</div>
              <div className="text-xs text-[var(--text-dim)] mt-1">{m.tag}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Generate Button */}
      <div className="mb-6">
        <button
          onClick={handleGenerate}
          disabled={generating || !selectedType || !selectedMotif}
          className="px-4 py-2 bg-[var(--info)] hover:bg-[#405a8a] rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {generating ? '生成中...' : 'プロンプト生成'}
        </button>
      </div>

      {/* Prompt Editor */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <h3 className="text-lg font-semibold mb-4">システムプロンプト</h3>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={16}
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] font-mono focus:outline-none focus:border-[var(--accent)] resize-y"
          placeholder="システムプロンプトを入力..."
        />
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
