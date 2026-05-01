import { useEffect, useState } from 'react';
import { getAllMcpServers, getBotMcpServers, updateBotMcpServers, restartBot } from '../api';
import { useBotContext } from '../components/BotContext';

export default function McpServersPage() {
  const { activeBotId, bots } = useBotContext();
  const botName = bots.find((b) => b.id === activeBotId)?.name || activeBotId;
  const [allServers, setAllServers] = useState<string[]>([]);
  const [assignedServers, setAssignedServers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeBotId) return;
    setLoading(true);
    Promise.all([getAllMcpServers(), getBotMcpServers(activeBotId)])
      .then(([servers, assigned]) => {
        setAllServers(servers);
        setAssignedServers(assigned);
      })
      .finally(() => setLoading(false));
  }, [activeBotId]);

  const toggleServer = (name: string) => {
    setAssignedServers((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateBotMcpServers(activeBotId, assignedServers);
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

  if (loading) return <div className="text-[var(--text-dim)]">読み込み中...</div>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">連携アプリ <span className="text-lg font-normal text-[var(--accent)]">— {botName}</span></h2>

      {allServers.length === 0 ? (
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-6 text-[var(--text-dim)]">
          連携アプリが登録されていません
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          {allServers.map((server) => {
            const isAssigned = assignedServers.includes(server);
            return (
              <button
                key={server}
                onClick={() => toggleServer(server)}
                className={`text-left p-4 rounded-lg border transition-colors ${
                  isAssigned
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                    : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--text-dim)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--text)]">{server}</span>
                  {isAssigned && (
                    <svg className="w-4 h-4 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

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
  );
}
