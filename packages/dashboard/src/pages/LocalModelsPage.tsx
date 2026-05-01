import { useEffect, useState, useCallback, useRef } from 'react';
import { getLocalModels, updateLocalModels, getLocalModelJobs, getServerStatus, controlServer, updateJobBackend, getOllamaModels } from '../api';
import { useI18n } from '../i18n';

interface MlxConfig {
  url: string;
  model: string;
  timeoutMs: number;
}

interface OllamaConfig {
  url: string;
  embedModel: string;
}

interface LocalModelsConfig {
  mlx: MlxConfig;
  ollama: OllamaConfig;
}

interface ModelJob {
  id: string;
  name: string;
  type: 'mlx' | 'ollama';
  description: string;
  usedBy: string;
  model: string;
}

interface ServerStatus {
  mlx: { running: boolean; autoStart: boolean; loadedModels: string[]; pid: number | null };
  ollama: { running: boolean; autoStart: boolean; loadedModels: { name: string; size: string }[]; pid: number | null; runnerPids?: number[] };
  whisper: { running: boolean; autoStart?: boolean; model: string; pid: number | null };
  voicevox: { running: boolean; autoStart: boolean; containerId: string | null };
  gptsovits?: { running: boolean; autoStart: boolean; pid: number | null };
  irodori?: { running: boolean; autoStart: boolean; pid: number | null };
  dashboard?: { running: boolean; autoStart: boolean; pid: number | null };
}

export default function LocalModelsPage() {
  const { t } = useI18n();
  const [config, setConfig] = useState<LocalModelsConfig | null>(null);
  const [status, setStatus] = useState<{ mlx: boolean; ollama: boolean }>({ mlx: false, ollama: false });
  const [jobs, setJobs] = useState<ModelJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveMsg, setSaveMsg] = useState('');
  const [error, setError] = useState('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [loadModelName, setLoadModelName] = useState('');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

  const refreshStatus = useCallback(async () => {
    try {
      const ss = await getServerStatus();
      setServerStatus(ss);
    } catch {
      // ignore - server may be down
    }
  }, []);

  useEffect(() => {
    Promise.all([
      getLocalModels(),
      getLocalModelJobs(),
      getServerStatus().catch(() => null),
      getOllamaModels().catch(() => []),
    ])
      .then(([modelsData, jobsData, ss, olModels]) => {
        setConfig(modelsData.config);
        setStatus(modelsData.status);
        setJobs(jobsData);
        if (ss) setServerStatus(ss);
        setOllamaModels(olModels.map((m: any) => m.name));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const autoSave = useCallback((newConfig: LocalModelsConfig) => {
    setConfig(newConfig);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await updateLocalModels(newConfig);
        setSaveMsg('保存しました');
        const fresh = await getLocalModels();
        setStatus(fresh.status);
        setTimeout(() => setSaveMsg(''), 2000);
      } catch (e: any) {
        setError(e.message);
      }
    }, 800);
  }, []);

  const handleAction = async (actionKey: string, fn: () => Promise<any>) => {
    setActionLoading(actionKey);
    setError('');
    try {
      await fn();
      // Small delay for process to start/stop
      await new Promise((r) => setTimeout(r, 1000));
      await refreshStatus();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <div className="text-[var(--text-dim)]">読み込み中...</div>;

  if (!config) return <div className="text-[var(--error)]">設定を読み込めませんでした</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">{t('sidebar.localModels')}</h2>
        {saveMsg && (
          <span className="text-sm text-[var(--success)]">{saveMsg}</span>
        )}
      </div>

      {error && (
        <div className="bg-[var(--error)]/10 border border-[var(--error)] rounded-lg p-3 mb-6 text-sm text-[var(--error)]">
          {error}
        </div>
      )}

      {/* Dashboard API */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-base font-semibold text-[var(--text)]">Dashboard API</h3>
          <StatusDot alive={true} />
        </div>

        {serverStatus?.dashboard && (
          <div className="flex items-center gap-4 mb-4 py-2 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
            <span className="text-xs text-[var(--text-dim)] font-mono">PID: {serverStatus.dashboard.pid}</span>
            <span className="text-[var(--border)]">|</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-dim)]">Auto-Start</span>
              <button
                onClick={() =>
                  handleAction('dashboard-auto', () =>
                    controlServer('dashboard' as any, 'auto-start', { enabled: !serverStatus.dashboard?.autoStart })
                  )
                }
                disabled={actionLoading !== null}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                  serverStatus.dashboard.autoStart ? 'bg-[var(--accent)]' : 'bg-[var(--text-dim)]'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    serverStatus.dashboard.autoStart ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        <p className="text-xs text-[var(--text-dim)]">
          Ember ダッシュボード API サーバー (launchd: local.dashboard.serve, port 3456)
          <br />
          <span className="text-[var(--text-dim)]/70">Activity Monitor: <span className="font-mono">node</span> として表示</span>
        </p>
      </div>

      {/* MLX Server */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-base font-semibold text-[var(--text)]">MLX Server</h3>
          <StatusDot alive={serverStatus?.mlx.running ?? status.mlx} />
        </div>

        {/* Server Controls */}
        {serverStatus && (
          <ServerControlBar
            running={serverStatus.mlx.running}
            autoStart={serverStatus.mlx.autoStart}
            pid={serverStatus.mlx.pid}
            actionLoading={actionLoading}
            onStart={() => handleAction('mlx-start', () => controlServer('mlx', 'start'))}
            onStop={() => handleAction('mlx-stop', () => controlServer('mlx', 'stop'))}
            onToggleAutoStart={(enabled) =>
              handleAction('mlx-auto', () => controlServer('mlx', 'auto-start', { enabled }))
            }
            startKey="mlx-start"
            stopKey="mlx-stop"
            autoKey="mlx-auto"
          />
        )}

        <p className="text-xs text-[var(--text-dim)] mb-4">
          ローカル MLX 推論サーバー (launchd: local.mlx.serve)
          <br />
          <span className="text-[var(--text-dim)]/70">Activity Monitor: <span className="font-mono">Python</span> として表示</span>
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-[var(--text-dim)] mb-1">Model</label>
            <input
              type="text"
              value={config.mlx.model}
              onChange={(e) => autoSave({ ...config, mlx: { ...config.mlx, model: e.target.value } })}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-dim)] mb-1">Timeout (ms)</label>
            <input
              type="number"
              value={config.mlx.timeoutMs}
              onChange={(e) => autoSave({ ...config, mlx: { ...config.mlx, timeoutMs: Number(e.target.value) } })}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-[var(--text-dim)] mb-1">API URL</label>
            <input
              type="text"
              value={config.mlx.url}
              onChange={(e) => autoSave({ ...config, mlx: { ...config.mlx, url: e.target.value } })}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] font-mono placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
        </div>

        {/* MLX Loaded Models */}
        {serverStatus && serverStatus.mlx.running && (
          <div className="mt-4 pt-4 border-t border-[var(--border)]">
            <h4 className="text-xs font-medium text-[var(--text-dim)] mb-2">Loaded Models</h4>
            {serverStatus.mlx.loadedModels.length === 0 ? (
              <p className="text-xs text-[var(--text-dim)]">No models loaded</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {serverStatus.mlx.loadedModels.map((m) => (
                  <span
                    key={m}
                    className="inline-block px-2.5 py-1 rounded-md text-xs font-mono bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20"
                  >
                    {m}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Ollama Server */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-base font-semibold text-[var(--text)]">Ollama Server</h3>
          <StatusDot alive={serverStatus?.ollama.running ?? status.ollama} />
        </div>

        {/* Server Controls */}
        {serverStatus && (
          <ServerControlBar
            running={serverStatus.ollama.running}
            autoStart={serverStatus.ollama.autoStart}
            pid={serverStatus.ollama.pid}
            actionLoading={actionLoading}
            onStart={() => handleAction('ollama-start', () => controlServer('ollama', 'start'))}
            onStop={() => handleAction('ollama-stop', () => controlServer('ollama', 'stop'))}
            onToggleAutoStart={(enabled) =>
              handleAction('ollama-auto', () => controlServer('ollama', 'auto-start', { enabled }))
            }
            startKey="ollama-start"
            stopKey="ollama-stop"
            autoKey="ollama-auto"
          />
        )}

        <p className="text-xs text-[var(--text-dim)] mb-4">
          ローカル Ollama サーバー (launchd: local.ollama.serve2)
          <br />
          <span className="text-[var(--text-dim)]/70">Activity Monitor: <span className="font-mono">ollama</span> (serve: PID {serverStatus?.ollama.pid ?? '—'})</span>
          {serverStatus?.ollama.runnerPids && serverStatus.ollama.runnerPids.length > 0 && (
            <>
              <br />
              <span className="text-[var(--text-dim)]/70">
                Runner: {serverStatus.ollama.runnerPids.map((p) => (
                  <span key={p} className="font-mono">PID {p}</span>
                )).reduce((acc: React.ReactNode[], el, i) => i === 0 ? [el] : [...acc, ', ', el], [] as React.ReactNode[])}
                <span className="ml-1">(Activity Monitor でメモリ大のプロセス)</span>
              </span>
            </>
          )}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-[var(--text-dim)] mb-1">Embed Model</label>
            <input
              type="text"
              value={config.ollama.embedModel}
              onChange={(e) => autoSave({ ...config, ollama: { ...config.ollama, embedModel: e.target.value } })}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-dim)] mb-1">API URL</label>
            <input
              type="text"
              value={config.ollama.url}
              onChange={(e) => autoSave({ ...config, ollama: { ...config.ollama, url: e.target.value } })}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] font-mono placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
        </div>

        {/* Ollama Loaded Models */}
        {serverStatus && serverStatus.ollama.running && (
          <div className="mt-4 pt-4 border-t border-[var(--border)]">
            <h4 className="text-xs font-medium text-[var(--text-dim)] mb-3">Loaded Models</h4>
            {serverStatus.ollama.loadedModels.length > 0 && (
              <table className="w-full text-sm mb-3">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left py-1.5 px-2 text-xs font-medium text-[var(--text-dim)]">Model</th>
                    <th className="text-left py-1.5 px-2 text-xs font-medium text-[var(--text-dim)]">Size</th>
                    <th className="text-right py-1.5 px-2 text-xs font-medium text-[var(--text-dim)]"></th>
                  </tr>
                </thead>
                <tbody>
                  {serverStatus.ollama.loadedModels.map((m) => (
                    <tr key={m.name} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-1.5 px-2 font-mono text-xs text-[var(--text)]">{m.name}</td>
                      <td className="py-1.5 px-2 text-xs text-[var(--text-dim)]">{m.size}</td>
                      <td className="py-1.5 px-2 text-right">
                        <button
                          onClick={() =>
                            handleAction(`unload-${m.name}`, () =>
                              controlServer('ollama', 'unload', { model: m.name })
                            )
                          }
                          disabled={actionLoading !== null}
                          className="px-2 py-0.5 rounded text-xs border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--error)] hover:border-[var(--error)] transition-colors disabled:opacity-50"
                        >
                          {actionLoading === `unload-${m.name}` ? 'Unloading...' : 'Unload'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {serverStatus.ollama.loadedModels.length === 0 && (
              <p className="text-xs text-[var(--text-dim)] mb-3">No models loaded</p>
            )}

            {/* Load model input */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={loadModelName}
                onChange={(e) => setLoadModelName(e.target.value)}
                placeholder="Model name (e.g. llama3.2)"
                className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text)] font-mono placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
              <button
                onClick={() => {
                  if (!loadModelName.trim()) return;
                  handleAction('ollama-load', () =>
                    controlServer('ollama', 'load', { model: loadModelName.trim() })
                  ).then(() => setLoadModelName(''));
                }}
                disabled={!loadModelName.trim() || actionLoading !== null}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionLoading === 'ollama-load' ? 'Loading...' : 'Load'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Whisper Server */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-base font-semibold text-[var(--text)]">Whisper Server</h3>
          <StatusDot alive={serverStatus?.whisper.running ?? false} />
        </div>

        {serverStatus && (
          <ServerControlBar
            running={serverStatus.whisper.running}
            autoStart={serverStatus.whisper.autoStart ?? false}
            pid={serverStatus.whisper.pid}
            actionLoading={actionLoading}
            onStart={() => handleAction('whisper-start', () => controlServer('whisper', 'start'))}
            onStop={() => handleAction('whisper-stop', () => controlServer('whisper', 'stop'))}
            onToggleAutoStart={(enabled) =>
              handleAction('whisper-auto', () => controlServer('whisper', 'auto-start', { enabled }))
            }
            startKey="whisper-start"
            stopKey="whisper-stop"
            autoKey="whisper-auto"
          />
        )}

        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-[var(--text-dim)]">
            faster-whisper 音声認識サーバー (port 8767)
            <br />
            <span className="text-[var(--text-dim)]/70">Activity Monitor: <span className="font-mono">Python</span> として表示（MLX Server とは別プロセス）</span>
          </p>
          <a
            href="/ember-chat"
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent)]/20 text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/30 transition-colors whitespace-nowrap"
          >
            Ember Chat を開く
          </a>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-xs text-[var(--text-dim)]">STT Model</span>
            <div className="text-[var(--text)] font-mono text-xs">whisper large-v3 (int8)</div>
          </div>
          <div>
            <span className="text-xs text-[var(--text-dim)]">Memory</span>
            <div className="text-[var(--text)] font-mono text-xs">~2.1 GB</div>
          </div>
          <div>
            <span className="text-xs text-[var(--text-dim)]">URL</span>
            <div className="text-[var(--text)] font-mono text-xs">http://localhost:8767</div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <h4 className="text-xs font-medium text-[var(--text-dim)] mb-2">依存サービス</h4>
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="flex items-center gap-1.5">
              <span className={`inline-block w-2 h-2 rounded-full ${serverStatus?.ollama.running ? 'bg-[var(--success)]' : 'bg-[var(--error)]'}`} />
              <span className="text-[var(--text-dim)]">Ollama (LLM応答: gemma4:e4b)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`inline-block w-2 h-2 rounded-full ${serverStatus?.voicevox?.running ? 'bg-[var(--success)]' : 'bg-[var(--error)]'}`} />
              <span className="text-[var(--text-dim)]">VOICEVOX (TTS: port 50021)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`inline-block w-2 h-2 rounded-full ${serverStatus?.irodori?.running ? 'bg-[var(--success)]' : 'bg-[var(--error)]'}`} />
              <span className="text-[var(--text-dim)]">Irodori (TTS: port 7860)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`inline-block w-2 h-2 rounded-full ${serverStatus?.gptsovits?.running ? 'bg-[var(--success)]' : 'bg-[var(--error)]'}`} />
              <span className="text-[var(--text-dim)]">GPT-SoVITS (TTS: port 9880)</span>
            </span>
          </div>
        </div>
      </div>

      {/* VOICEVOX Server */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-base font-semibold text-[var(--text)]">VOICEVOX Server</h3>
          <StatusDot alive={serverStatus?.voicevox?.running ?? false} />
        </div>

        {serverStatus?.voicevox && (
          <div className="flex items-center gap-4 mb-4 py-2 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
            {serverStatus.voicevox.containerId && (
              <span className="text-xs text-[var(--text-dim)] font-mono">Container: {serverStatus.voicevox.containerId}</span>
            )}
            {serverStatus.voicevox.containerId && <span className="text-[var(--border)]">|</span>}

            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-dim)]">Auto-Start</span>
              <button
                onClick={() =>
                  handleAction('voicevox-auto', () =>
                    controlServer('voicevox', 'auto-start', { enabled: !serverStatus.voicevox.autoStart })
                  )
                }
                disabled={actionLoading !== null}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                  serverStatus.voicevox.autoStart ? 'bg-[var(--accent)]' : 'bg-[var(--text-dim)]'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    serverStatus.voicevox.autoStart ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <span className="text-[var(--border)]">|</span>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleAction('voicevox-start', () => controlServer('voicevox', 'start'))}
                disabled={serverStatus.voicevox.running || actionLoading !== null}
                className="px-3 py-1 rounded-md text-xs font-medium bg-[var(--success)]/20 text-[var(--success)] border border-[var(--success)]/30 hover:bg-[var(--success)]/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {actionLoading === 'voicevox-start' ? 'Starting...' : 'Start'}
              </button>
              <button
                onClick={() => handleAction('voicevox-stop', () => controlServer('voicevox', 'stop'))}
                disabled={!serverStatus.voicevox.running || actionLoading !== null}
                className="px-3 py-1 rounded-md text-xs font-medium bg-[var(--error)]/20 text-[var(--error)] border border-[var(--error)]/30 hover:bg-[var(--error)]/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {actionLoading === 'voicevox-stop' ? 'Stopping...' : 'Stop'}
              </button>
            </div>
          </div>
        )}

        <p className="text-xs text-[var(--text-dim)] mb-3">
          音声合成エンジン (Docker: voicevox/voicevox_engine:cpu-latest)
          <br />
          <span className="text-[var(--text-dim)]/70">Activity Monitor: <span className="font-mono">com.docker</span> 内で稼働（個別プロセスとして表示されない）</span>
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-xs text-[var(--text-dim)]">URL</span>
            <div className="text-[var(--text)] font-mono text-xs">http://localhost:50021</div>
          </div>
          <div>
            <span className="text-xs text-[var(--text-dim)]">Engine</span>
            <div className="text-[var(--text)] font-mono text-xs">voicevox_engine (CPU)</div>
          </div>
        </div>
      </div>

      {/* Irodori TTS */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-base font-semibold text-[var(--text)]">Irodori TTS</h3>
          <StatusDot alive={serverStatus?.irodori?.running ?? false} />
        </div>

        {serverStatus?.irodori && (
          <ServerControlBar
            running={serverStatus.irodori.running}
            autoStart={serverStatus.irodori.autoStart}
            pid={serverStatus.irodori.pid}
            actionLoading={actionLoading}
            onStart={() => handleAction('irodori-start', () => controlServer('irodori', 'start'))}
            onStop={() => handleAction('irodori-stop', () => controlServer('irodori', 'stop'))}
            onToggleAutoStart={(enabled) =>
              handleAction('irodori-auto', () => controlServer('irodori', 'auto-start', { enabled }))
            }
            startKey="irodori-start"
            stopKey="irodori-stop"
            autoKey="irodori-auto"
          />
        )}

        <p className="text-xs text-[var(--text-dim)] mb-3">
          Irodori Flow Matching 音声合成 (launchd: local.irodori.serve, port 7860)
          <br />
          <span className="text-[var(--text-dim)]/70">Activity Monitor: <span className="font-mono">Python</span> として表示</span>
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-xs text-[var(--text-dim)]">URL</span>
            <div className="text-[var(--text)] font-mono text-xs">http://localhost:7860</div>
          </div>
          <div>
            <span className="text-xs text-[var(--text-dim)]">Model</span>
            <div className="text-[var(--text)] font-mono text-xs">Flow Matching TTS</div>
          </div>
        </div>
      </div>

      {/* GPT-SoVITS */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-base font-semibold text-[var(--text)]">GPT-SoVITS</h3>
          <StatusDot alive={serverStatus?.gptsovits?.running ?? false} />
        </div>

        {serverStatus?.gptsovits && (
          <ServerControlBar
            running={serverStatus.gptsovits.running}
            autoStart={serverStatus.gptsovits.autoStart}
            pid={serverStatus.gptsovits.pid}
            actionLoading={actionLoading}
            onStart={() => handleAction('gptsovits-start', () => controlServer('gptsovits', 'start'))}
            onStop={() => handleAction('gptsovits-stop', () => controlServer('gptsovits', 'stop'))}
            onToggleAutoStart={(enabled) =>
              handleAction('gptsovits-auto', () => controlServer('gptsovits', 'auto-start', { enabled }))
            }
            startKey="gptsovits-start"
            stopKey="gptsovits-stop"
            autoKey="gptsovits-auto"
          />
        )}

        <p className="text-xs text-[var(--text-dim)] mb-3">
          GPT-SoVITS ゼロショット音声クローン (launchd: local.gptsovits.serve, port 9880)
          <br />
          <span className="text-[var(--text-dim)]/70">Activity Monitor: <span className="font-mono">Python</span> として表示</span>
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-xs text-[var(--text-dim)]">URL</span>
            <div className="text-[var(--text)] font-mono text-xs">http://localhost:9880</div>
          </div>
          <div>
            <span className="text-xs text-[var(--text-dim)]">Model</span>
            <div className="text-[var(--text)] font-mono text-xs">v2ProPlus</div>
          </div>
          <div>
            <span className="text-xs text-[var(--text-dim)]">Ref Audio</span>
            <div className="text-[var(--text)] font-mono text-xs">emilia.wav</div>
          </div>
        </div>
      </div>

      {/* Using Jobs */}
      <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5">
        <h3 className="text-base font-semibold text-[var(--text)] mb-4">使用中のジョブ</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="text-left py-2 px-3 text-xs font-medium text-[var(--text-dim)]">Name</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-[var(--text-dim)]">Type</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-[var(--text-dim)]">Description</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-[var(--text-dim)]">Model</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-[var(--text-dim)]">Source</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-2.5 px-3 text-[var(--text)]">{job.name}</td>
                  <td className="py-2.5 px-3">
                    <select
                      value={job.type}
                      onChange={async (e) => {
                        const newBackend = e.target.value as 'mlx' | 'ollama';
                        try {
                          await updateJobBackend(job.id, newBackend);
                          const freshJobs = await getLocalModelJobs();
                          setJobs(freshJobs);
                        } catch (err: any) {
                          setError(err.message);
                        }
                      }}
                      className={`px-2 py-0.5 rounded text-xs font-medium border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--accent)] ${
                        job.type === 'mlx'
                          ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                          : 'bg-[var(--success)]/20 text-[var(--success)]'
                      }`}
                    >
                      <option value="mlx">MLX</option>
                      <option value="ollama">OLLAMA</option>
                    </select>
                  </td>
                  <td className="py-2.5 px-3 text-[var(--text-dim)]">{job.description}</td>
                  <td className="py-2.5 px-3 font-mono text-xs">
                    {(() => {
                      const loadedNames = job.type === 'ollama'
                        ? new Set((serverStatus?.ollama.loadedModels || []).map(m => m.name))
                        : new Set(serverStatus?.mlx.loadedModels || []);
                      const selectedModel = job.type === 'ollama'
                        ? ollamaModels.find((m) => m === job.model || m === job.model + ':latest' || m.replace(/:latest$/, '') === job.model) || job.model
                        : job.model;
                      const isLoaded = loadedNames.has(selectedModel) || loadedNames.has(selectedModel.replace(/:latest$/, ''));

                      return (
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${isLoaded ? 'bg-[var(--success)]' : 'bg-[var(--text-dim)]/30'}`}
                            title={isLoaded ? 'Loaded' : 'Not loaded'}
                          />
                          {job.type === 'ollama' && ollamaModels.length > 0 ? (
                            <>
                              <select
                                value={selectedModel}
                                onChange={async (e) => {
                                  try {
                                    await updateJobBackend(job.id, job.type, e.target.value);
                                    const freshJobs = await getLocalModelJobs();
                                    setJobs(freshJobs);
                                  } catch (err: any) {
                                    setError(err.message);
                                  }
                                }}
                                className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-0.5 text-xs text-[var(--text)] font-mono focus:outline-none focus:border-[var(--accent)] cursor-pointer"
                              >
                                {ollamaModels.map((m) => {
                                  const loaded = loadedNames.has(m) || loadedNames.has(m.replace(/:latest$/, ''));
                                  return <option key={m} value={m}>{loaded ? '\u25CF ' : '\u25CB '}{m}</option>;
                                })}
                              </select>
                              {!isLoaded && (
                                <button
                                  onClick={() => handleAction(`load-job-${job.id}`, async () => {
                                    await controlServer('ollama', 'load', { model: selectedModel });
                                    await refreshStatus();
                                  })}
                                  disabled={actionLoading !== null}
                                  className="px-2 py-0.5 rounded text-xs font-medium bg-[var(--accent)]/20 text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/30 transition-colors disabled:opacity-50 whitespace-nowrap"
                                >
                                  {actionLoading === `load-job-${job.id}` ? 'Loading...' : 'Load'}
                                </button>
                              )}
                            </>
                          ) : (
                            <span className="text-[var(--text)]">{job.model}</span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="py-2.5 px-3 text-[var(--text-dim)] font-mono text-xs">{job.usedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusDot({ alive }: { alive: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          alive ? 'bg-[var(--success)]' : 'bg-[var(--error)]'
        }`}
      />
      <span className={alive ? 'text-[var(--success)]' : 'text-[var(--error)]'}>
        {alive ? 'Online' : 'Offline'}
      </span>
    </span>
  );
}

interface ServerControlBarProps {
  running: boolean;
  autoStart: boolean;
  pid: number | null;
  actionLoading: string | null;
  onStart: () => void;
  onStop: () => void;
  onToggleAutoStart: (enabled: boolean) => void;
  startKey: string;
  stopKey: string;
  autoKey: string;
}

function ServerControlBar({
  running,
  autoStart,
  pid,
  actionLoading,
  onStart,
  onStop,
  onToggleAutoStart,
  startKey,
  stopKey,
  autoKey,
}: ServerControlBarProps) {
  return (
    <div className="flex items-center gap-4 mb-4 py-2 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
      {/* PID */}
      {pid && (
        <span className="text-xs text-[var(--text-dim)] font-mono">PID: {pid}</span>
      )}

      {/* Separator */}
      <span className="text-[var(--border)]">|</span>

      {/* Auto-Start Toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-dim)]">Auto-Start</span>
        <button
          onClick={() => onToggleAutoStart(!autoStart)}
          disabled={actionLoading !== null}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
            autoStart ? 'bg-[var(--accent)]' : 'bg-[var(--text-dim)]'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              autoStart ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Separator */}
      <span className="text-[var(--border)]">|</span>

      {/* Start / Stop */}
      <div className="flex items-center gap-2">
        <button
          onClick={onStart}
          disabled={running || actionLoading !== null}
          className="px-3 py-1 rounded-md text-xs font-medium bg-[var(--success)]/20 text-[var(--success)] border border-[var(--success)]/30 hover:bg-[var(--success)]/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {actionLoading === startKey ? 'Starting...' : 'Start'}
        </button>
        <button
          onClick={onStop}
          disabled={!running || actionLoading !== null}
          className="px-3 py-1 rounded-md text-xs font-medium bg-[var(--error)]/20 text-[var(--error)] border border-[var(--error)]/30 hover:bg-[var(--error)]/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {actionLoading === stopKey ? 'Stopping...' : 'Stop'}
        </button>
      </div>
    </div>
  );
}
