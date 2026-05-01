import { useEffect, useState } from 'react';
import { restartBot } from '../api';
import { useBotContext } from '../components/BotContext';
import { setTimezone } from '../timezone';
import { globalConfigEvents } from '../globalConfigEvents';

const TIMEZONES = [
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST, UTC+9)' },
  { value: 'America/New_York', label: 'America/New_York (EST/EDT, UTC-5/-4)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST/PDT, UTC-8/-7)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST/CDT, UTC-6/-5)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST, UTC+0/+1)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET/CEST, UTC+1/+2)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET/CEST, UTC+1/+2)' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (CST, UTC+8)' },
  { value: 'Asia/Seoul', label: 'Asia/Seoul (KST, UTC+9)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT, UTC+8)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST, UTC+5:30)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT, UTC+10/+11)' },
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland (NZST/NZDT, UTC+12/+13)' },
  { value: 'UTC', label: 'UTC (UTC+0)' },
];

interface GlobalSettings {
  botConversationChannel?: string;
  timezone?: string;
  debugMode?: boolean;
  emberChatStandalone?: boolean;
}

export default function GlobalConfig() {
  const { bots } = useBotContext();
  const [settings, setSettings] = useState<GlobalSettings>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Restart state
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartMsg, setRestartMsg] = useState('');

  // Channel save state
  const [channelDirty, setChannelDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/global')
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data) => {
        setSettings({
          botConversationChannel: data.botConversationChannel || '',
          timezone: data.timezone || 'Asia/Tokyo',
          debugMode: data.debugMode || false,
          emberChatStandalone: data.emberChatStandalone || false,
        });
      })
      .catch(() => {
        // Backend may not have /api/global yet - use defaults
        setSettings({ botConversationChannel: '', timezone: 'Asia/Tokyo', debugMode: false, emberChatStandalone: false });
      })
      .finally(() => setLoading(false));
  }, []);

  const handleChannelChange = (value: string) => {
    setSettings((prev) => ({ ...prev, botConversationChannel: value }));
    setChannelDirty(true);
  };

  const handleSaveChannel = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/global', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botConversationChannel: settings.botConversationChannel }),
      });
      if (!res.ok) throw new Error('Save failed');
      setChannelDirty(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDebug = async () => {
    const newValue = !settings.debugMode;
    setSettings((prev) => ({ ...prev, debugMode: newValue }));
    try {
      await fetch('/api/global', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debugMode: newValue }),
      });
    } catch {
      // revert on failure
      setSettings((prev) => ({ ...prev, debugMode: !newValue }));
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    setRestartMsg('');
    try {
      const result = await restartBot();
      setRestartMsg(result.message || 'All bots restarted successfully');
      setConfirmRestart(false);
    } catch (e: any) {
      setRestartMsg(`Error: ${e.message}`);
    } finally {
      setRestarting(false);
    }
  };

  if (loading) return <div className="text-[var(--text-dim)]">読み込み中...</div>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">グローバル設定</h2>

      {error && (
        <div className="bg-[var(--error)]/10 border border-[var(--error)] rounded-lg p-3 mb-6 text-sm text-[var(--error)]">
          {error}
        </div>
      )}

      {/* Bot Conversation Channel */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <h3 className="text-base font-semibold text-[var(--text)] mb-3">Bot Conversation Channel</h3>
        <p className="text-xs text-[var(--text-dim)] mb-3">
          ボット同士が会話するSlackチャンネルのIDを設定
        </p>
        <div className="flex gap-3 items-center">
          <input
            type="text"
            value={settings.botConversationChannel || ''}
            onChange={(e) => handleChannelChange(e.target.value)}
            placeholder="C0123456789"
            className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--accent)] transition-colors"
          />
          <button
            onClick={handleSaveChannel}
            disabled={!channelDirty || saving}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              channelDirty
                ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white'
                : 'bg-[var(--surface-alt)] text-[var(--text-dim)] cursor-not-allowed'
            }`}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* Timezone */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <h3 className="text-base font-semibold text-[var(--text)] mb-3">タイムゾーン</h3>
        <p className="text-xs text-[var(--text-dim)] mb-3">
          全ボットの日時判定に使用するタイムゾーン。proactive agent の日付境界やスケジューラーに影響します。
        </p>
        <select
          value={settings.timezone || 'Asia/Tokyo'}
          onChange={async (e) => {
            const newTz = e.target.value;
            setSettings((prev) => ({ ...prev, timezone: newTz }));
            setTimezone(newTz);
            try {
              await fetch('/api/global', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ timezone: newTz }),
              });
            } catch (err: any) {
              setError(err.message);
            }
          }}
          className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] transition-colors w-full"
        >
          {TIMEZONES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Cogmem Settings */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <h3 className="text-base font-semibold text-[var(--text)] mb-3">Cogmem Settings</h3>
        <p className="text-xs text-[var(--text-dim)] mb-2">
          認知記憶モデルの設定はファイルで管理されています。
        </p>
        <div className="bg-[var(--bg)] rounded px-3 py-2 text-xs font-mono text-[var(--text-dim)]">
          ~/.config/cogmem/cogmem.toml
        </div>
        <p className="text-xs text-[var(--text-dim)] mt-2">
          各ボットの cogmem 有効/無効はボット個別設定から変更できます。
        </p>
      </div>

      {/* Debug Mode */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <h3 className="text-base font-semibold text-[var(--text)] mb-3">Debug Mode</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--text-dim)]">
              デバッグモードを有効にすると、詳細なログが出力されます。
            </p>
          </div>
          <button
            onClick={handleToggleDebug}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              settings.debugMode ? 'bg-[var(--accent)]' : 'bg-[var(--text-dim)]'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                settings.debugMode ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Ember Chat Standalone */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <h3 className="text-base font-semibold text-[var(--text)] mb-3">Ember Chat Standalone</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--text-dim)]">
              有効にすると、ダッシュボードのサイドバーからEmber Chatを非表示にします。Electronアプリ使用時に設定同期の競合を防ぎます。
            </p>
          </div>
          <button
            onClick={async () => {
              const newValue = !settings.emberChatStandalone;
              setSettings((prev) => ({ ...prev, emberChatStandalone: newValue }));
              try {
                await fetch('/api/global', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ emberChatStandalone: newValue }),
                });
                globalConfigEvents.emit();
              } catch {
                setSettings((prev) => ({ ...prev, emberChatStandalone: !newValue }));
              }
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              settings.emberChatStandalone ? 'bg-[var(--accent)]' : 'bg-[var(--text-dim)]'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                settings.emberChatStandalone ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* PM2 Controls */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <h3 className="text-base font-semibold text-[var(--text)] mb-3">PM2 Controls</h3>
        <p className="text-xs text-[var(--text-dim)] mb-2">
          稼働中のボット: {bots.filter((b) => b.enabled).map((b) => b.name).join(', ') || 'なし'}
        </p>

        {restartMsg && (
          <div
            className={`rounded-lg px-3 py-2 text-sm mb-3 ${
              restartMsg.startsWith('Error')
                ? 'bg-[var(--error)]/10 border border-[var(--error)] text-[var(--error)]'
                : 'bg-[var(--success)]/10 border border-[var(--success)] text-[var(--success)]'
            }`}
          >
            {restartMsg}
          </div>
        )}

        {!confirmRestart ? (
          <button
            onClick={() => setConfirmRestart(true)}
            className="px-4 py-2 bg-[var(--error)] hover:bg-[#983838] rounded-lg text-sm font-medium transition-colors"
          >
            Restart All Bots
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--warning)]">本当に全ボットを再起動しますか？</span>
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="px-4 py-2 bg-[var(--error)] hover:bg-[#983838] rounded-lg text-sm font-medium transition-colors"
            >
              {restarting ? '再起動中...' : '実行'}
            </button>
            <button
              onClick={() => setConfirmRestart(false)}
              className="px-4 py-2 bg-[var(--surface-alt)] hover:brightness-110 rounded-lg text-sm font-medium transition-colors"
            >
              キャンセル
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
