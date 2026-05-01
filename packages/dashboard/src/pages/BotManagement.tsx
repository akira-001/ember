/// <reference types="vite/client" />
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { enableBot, disableBot, deleteBot } from '../api';
import { useBotContext } from '../components/BotContext';
import { useI18n } from '../i18n';

const API = import.meta.env.VITE_API_URL || '';

export default function BotManagement() {
  const { bots, refreshBots, setActiveBotId } = useBotContext();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleToggle = async (botId: string, currentlyEnabled: boolean) => {
    setLoading((prev) => ({ ...prev, [botId]: true }));
    setError('');
    try {
      if (currentlyEnabled) {
        await disableBot(botId);
      } else {
        await enableBot(botId);
      }
      await refreshBots();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading((prev) => ({ ...prev, [botId]: false }));
    }
  };

  const handleDelete = async (botId: string) => {
    setLoading((prev) => ({ ...prev, [botId]: true }));
    setError('');
    try {
      await deleteBot(botId);
      await refreshBots();
      setConfirmDelete(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading((prev) => ({ ...prev, [botId]: false }));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">{t('bots.title')}</h2>
        <Link
          to="/system/bots/new"
          className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium rounded-lg transition-colors"
        >
          {t('bots.newBot')}
        </Link>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-[var(--error)]/10 border border-[var(--error)] rounded-lg text-[var(--error)] text-sm">
          {error}
        </div>
      )}

      {bots.length === 0 ? (
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-12 text-center">
          <p className="text-[var(--text-dim)] mb-4">{t('bots.empty')}</p>
          <Link
            to="/system/bots/new"
            className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium rounded-lg transition-colors"
          >
            {t('bots.createFirst')}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {bots.map((bot) => (
            <div
              key={bot.id}
              className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 flex flex-col gap-4"
            >
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--text)]">{bot.name}</h3>
                  <p className="text-xs text-[var(--text-dim)] font-mono mt-0.5">{bot.id}</p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    bot.enabled
                      ? 'text-[var(--success)]'
                      : 'text-[var(--text-dim)]'
                  }`}
                  style={{
                    backgroundColor: bot.enabled
                      ? 'rgba(74,138,74,0.12)'
                      : 'rgba(138,112,96,0.15)',
                  }}
                >
                  {bot.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>

              {/* Info */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <button
                  className="text-left hover:bg-[var(--surface-alt)] rounded p-1 -m-1 transition-colors"
                  onClick={() => { setActiveBotId(bot.id); navigate('/bot/models'); }}
                >
                  <p className="text-xs text-[var(--text-dim)] mb-0.5">{t('bots.model')}</p>
                  <p className="text-[var(--accent)] font-mono text-xs underline underline-offset-2">{bot.models.chat}</p>
                </button>
                <div>
                  <p className="text-xs text-[var(--text-dim)] mb-0.5">{t('bots.personality')}</p>
                  <p className="text-[var(--text-dim)] text-xs">
                    {bot.personality.type} / {bot.personality.motif}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2 border-t border-[var(--border)]">
                {/* Toggle switch */}
                <button
                  onClick={() => handleToggle(bot.id, bot.enabled)}
                  disabled={loading[bot.id]}
                  className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50"
                  style={{
                    backgroundColor: bot.enabled ? 'var(--accent)' : 'var(--text-dim)',
                  }}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      bot.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-xs text-[var(--text-dim)]">
                  {bot.enabled ? 'ON' : 'OFF'}
                </span>

                <div className="flex-1" />

                {/* Delete */}
                {confirmDelete === bot.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--error)]">{t('bots.confirmDelete')}</span>
                    <button
                      onClick={() => handleDelete(bot.id)}
                      disabled={loading[bot.id]}
                      className="px-3 py-1 bg-[var(--error)] hover:brightness-110 text-white text-xs rounded transition-colors disabled:opacity-50"
                    >
                      {t('bots.delete')}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="px-3 py-1 bg-[var(--surface-alt)] hover:brightness-110 text-[var(--text-dim)] text-xs rounded transition-colors"
                    >
                      {t('bots.cancel')}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(bot.id)}
                    className="px-3 py-1 text-[var(--error)] hover:brightness-110 hover:bg-[var(--error)]/10 text-xs rounded transition-colors"
                  >
                    {t('bots.delete')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CmuxBridgeStatus />
    </div>
  );
}

function CmuxBridgeStatus() {
  const [status, setStatus] = useState<{ running: boolean; lastLog: string; pendingRequests: number } | null>(null);
  const [error, setError] = useState('');

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API}/api/cmux/status`);
      if (!res.ok) throw new Error('Failed to fetch');
      setStatus(await res.json());
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 10000);
    return () => clearInterval(id);
  }, []);

  const handleRestart = async () => {
    try {
      await fetch(`${API}/api/cmux/restart`, { method: 'POST' });
      setTimeout(fetchStatus, 2000);
    } catch {}
  };

  return (
    <div className="mt-8">
      <h3 className="text-lg font-bold mb-3">cmux Bridge</h3>
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4">
        {error ? (
          <p className="text-[var(--error)] text-sm">{error}</p>
        ) : !status ? (
          <p className="text-[var(--text-dim)] text-sm">Loading...</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${status.running ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm font-medium">
                {status.running ? 'Running' : 'Stopped'}
              </span>
              {status.pendingRequests > 0 && (
                <span className="text-xs text-[var(--text-dim)]">
                  (pending: {status.pendingRequests})
                </span>
              )}
              <button
                onClick={handleRestart}
                className="ml-auto px-3 py-1 bg-[var(--surface-alt)] hover:brightness-110 text-xs rounded transition-colors"
              >
                Restart
              </button>
            </div>
            {status.lastLog && (
              <pre className="text-xs text-[var(--text-dim)] bg-[var(--surface-alt)] p-2 rounded overflow-x-auto whitespace-pre-wrap">
                {status.lastLog}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
