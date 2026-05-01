import { useEffect, useState } from 'react';
import { getAllCronJobs, getCronJobDetail, runCronJob, updateCronJob, createCronJob } from '../api';
import { useBotContext } from '../components/BotContext';
import CronEditor from '../components/CronEditor';
import { describeCronExpr } from '../components/cronUtils';
import { tz } from '../timezone';
import type { CronJob } from '../types';

interface HistoryEntry {
  jobName: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'success' | 'error' | 'timeout';
  botId: string;
  error: string | null;
  outputPreview?: string;
}

function formatDateJST(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.toLocaleString('en-US', { month: '2-digit', timeZone: tz() }));
  const dd = String(d.toLocaleString('en-US', { day: '2-digit', timeZone: tz() }));
  const hh = String(d.toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: tz() })).padStart(2, '0');
  const min = String(d.toLocaleString('en-US', { minute: '2-digit', timeZone: tz() })).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${min}`;
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatSlackMrkdwn(text: string): string {
  return text
    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/~([^~]+)~/g, '<del>$1</del>')
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '<a href="$1" class="text-[var(--accent)] hover:underline" target="_blank">$2</a>')
    .replace(/<(https?:\/\/[^>]+)>/g, '<a href="$1" class="text-[var(--accent)] hover:underline" target="_blank">$1</a>')
    .replace(/<@[A-Z0-9]+>/g, '')
    .replace(/:([\w+-]+):/g, '')
    .replace(/\n/g, '<br/>');
}

function parseOutputPreview(raw: string): { text: string; attachments: string[] } | null {
  try {
    const parsed = JSON.parse(raw);
    const mainText = parsed.text || '';
    const attachments: string[] = [];
    if (parsed.attachments) {
      for (const att of parsed.attachments) {
        const parts: string[] = [];
        if (att.title) parts.push(`**${att.title}**`);
        if (att.text) parts.push(att.text);
        attachments.push(parts.join('\n'));
      }
    }
    return { text: mainText, attachments };
  } catch {
    return null;
  }
}

function SlackPreview({ raw }: { raw: string }) {
  const parsed = parseOutputPreview(raw);
  if (!parsed) {
    return <div className="text-xs text-[var(--text-dim)] whitespace-pre-wrap">{raw}</div>;
  }
  return (
    <div className="space-y-2">
      {parsed.text && (
        <div
          className="text-sm text-[var(--text)]"
          dangerouslySetInnerHTML={{ __html: formatSlackMrkdwn(parsed.text) }}
        />
      )}
      {parsed.attachments.map((att, i) => (
        <div
          key={i}
          className="border-l-2 border-[var(--border)] pl-3 text-xs text-[var(--text-dim)]"
          dangerouslySetInnerHTML={{ __html: formatSlackMrkdwn(att) }}
        />
      ))}
    </div>
  );
}

const CHANNEL_NAMES: Record<string, string> = {
  'C0AJT8XU8G0': '#secretary',
  'C0AHQV1ME4S': '#general',
  'U3SFGQXNH': 'DM (Akiraさん)',
};

const DEFAULT_CRON_SLACK_TARGET = 'C0AHPJMS5QE';

function channelName(id: string): string {
  return CHANNEL_NAMES[id] || id;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    success: 'bg-[var(--success)]/20 text-[var(--success)]',
    error: 'bg-[var(--error)]/20 text-[var(--error)]',
    timeout: 'bg-[var(--warning)]/20 text-[var(--warning)]',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles[status] || 'bg-[var(--surface-alt)] text-[var(--text-dim)]'}`}>
      {status}
    </span>
  );
}

export default function CronJobsPage() {
  const { bots } = useBotContext();
  const [allJobs, setAllJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ job: CronJob; history: HistoryEntry[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [editedCron, setEditedCron] = useState<string | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState<string | null>(null);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newJob, setNewJob] = useState({ name: '', summary: '', cron: '0 9 * * *', message: '', command: '', botId: 'mei', slackTarget: DEFAULT_CRON_SLACK_TARGET });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setLoading(true);
    getAllCronJobs()
      .then((jobs) => setAllJobs(jobs))
      .finally(() => setLoading(false));
  }, []);

  const handleRun = async (name: string) => {
    setRunning(true);
    setRunResult(null);
    try {
      const result = await runCronJob(name);
      if (result.status === 'success') {
        setRunResult(`完了 (${((result.durationMs || 0) / 1000).toFixed(1)}s)`);
        const data = await getCronJobDetail(name);
        setDetail(data);
      } else {
        setRunResult(`エラー: ${result.error}`);
      }
    } catch (e: any) {
      setRunResult(`エラー: ${e.message}`);
    }
    setRunning(false);
    setTimeout(() => setRunResult(null), 5000);
  };

  const handleCardClick = async (jobName: string) => {
    if (selectedJob === jobName) {
      setSelectedJob(null);
      setDetail(null);
      setEditedCron(null);
      setEditedPrompt(null);
      return;
    }
    setSelectedJob(jobName);
    setEditedCron(null);
    setEditedPrompt(null);
    setDetailLoading(true);
    try {
      const data = await getCronJobDetail(jobName);
      setDetail(data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  if (loading) return <div className="text-[var(--text-dim)]">読み込み中...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">定期実行の設定 <span className="text-lg font-normal text-[var(--text-dim)]">— 共通</span></h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg text-sm font-medium transition-colors"
        >
          {showCreate ? '閉じる' : '新規作成'}
        </button>
      </div>

      {showCreate && (
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 mb-6">
          <h3 className="text-lg font-semibold mb-4">新しい定期実行</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium block mb-1">ジョブ名 *</label>
                <input
                  type="text"
                  value={newJob.name}
                  onChange={(e) => setNewJob({ ...newJob, name: e.target.value.replace(/\s/g, '-').toLowerCase() })}
                  placeholder="my-new-job"
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] font-mono focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium block mb-1">概要</label>
                <input
                  type="text"
                  value={newJob.summary}
                  onChange={(e) => setNewJob({ ...newJob, summary: e.target.value })}
                  placeholder="このジョブの説明"
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium block mb-1">タイプ</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setNewJob({ ...newJob, command: '', message: newJob.message || '' })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      !newJob.command
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                        : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text-dim)]'
                    }`}
                  >
                    Claude Code
                  </button>
                  <button
                    onClick={() => setNewJob({ ...newJob, command: newJob.command || 'echo hello', message: '' })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      newJob.command
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                        : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text-dim)]'
                    }`}
                  >
                    コマンド
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium block mb-1">Bot</label>
                <div className="flex gap-2">
                  {bots.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => setNewJob({ ...newJob, botId: b.id })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        newJob.botId === b.id
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                          : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text-dim)]'
                      }`}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {newJob.command ? (
              <div>
                <label className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium block mb-1">コマンド</label>
                <input
                  type="text"
                  value={newJob.command}
                  onChange={(e) => setNewJob({ ...newJob, command: e.target.value })}
                  placeholder="cd /path && ./script.sh"
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] font-mono focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            ) : (
              <div>
                <label className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium block mb-1">プロンプト</label>
                <textarea
                  value={newJob.message}
                  onChange={(e) => setNewJob({ ...newJob, message: e.target.value })}
                  placeholder="Claude に実行させるタスクの指示"
                  rows={3}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] resize-y"
                />
              </div>
            )}

            <div>
              <label className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium block mb-1">スケジュール</label>
              <CronEditor
                value={newJob.cron}
                onChange={(cron) => setNewJob({ ...newJob, cron })}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={async () => {
                  if (!newJob.name || !newJob.cron) return;
                  setCreating(true);
                  try {
                    await createCronJob({
                      name: newJob.name,
                      summary: newJob.summary,
                      cron: newJob.cron,
                      message: newJob.command ? '' : newJob.message,
                      command: newJob.command || undefined,
                      slackTarget: newJob.slackTarget,
                      botId: newJob.botId,
                    });
                    setAllJobs(await getAllCronJobs());
                    setShowCreate(false);
                    setNewJob({ name: '', summary: '', cron: '0 9 * * *', message: '', command: '', botId: 'mei', slackTarget: DEFAULT_CRON_SLACK_TARGET });
                    setRunResult('ジョブを作成しました');
                    setTimeout(() => setRunResult(null), 3000);
                  } catch (e: any) {
                    setRunResult(`エラー: ${e.message}`);
                  } finally {
                    setCreating(false);
                  }
                }}
                disabled={creating || !newJob.name || !newJob.cron}
                className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {creating ? '作成中...' : '作成'}
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="text-xs text-[var(--accent)] hover:underline"
              >
                キャンセル
              </button>
              {runResult && (
                <span className={`text-sm ${runResult.startsWith('エラー') ? 'text-[var(--error)]' : 'text-[var(--success)]'}`}>
                  {runResult}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {allJobs.filter((j) => !j.name.startsWith('proactive-checkin')).length === 0 ? (
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-6 text-[var(--text-dim)]">
          定期実行が登録されていません
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          {allJobs.filter((j) => !j.name.startsWith('proactive-checkin')).map((job) => {
            const isSelected = selectedJob === job.name;
            return (
              <button
                key={job.name}
                onClick={() => handleCardClick(job.name)}
                className={`text-left p-4 rounded-lg border transition-colors ${
                  isSelected
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                    : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--text-dim)]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-[var(--text)]">{job.name}</span>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: job.enabled ? 'rgba(74,138,74,0.12)' : 'rgba(138,112,96,0.15)',
                      color: job.enabled ? 'var(--success)' : 'var(--text-dim)',
                    }}
                  >
                    {job.enabled ? 'enabled' : 'disabled'}
                  </span>
                </div>
                {job.summary && (
                  <div className="text-xs text-[var(--text-dim)] mb-2">{job.summary}</div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-dim)]">{describeCronExpr(job.cron)}</span>
                  {job.botId && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--surface-alt)] text-[var(--text-dim)]">
                      {bots.find((b) => b.id === job.botId)?.name || job.botId}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail Panel */}
      {selectedJob && (
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-6">
          {detailLoading ? (
            <div className="text-[var(--text-dim)]">読み込み中...</div>
          ) : detail ? (
            <>
              {/* Job Info */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-semibold text-[var(--text)]">{detail.job.name}</h3>
                  <div className="flex items-center gap-2">
                    {runResult && (
                      <span className={`text-xs ${runResult.startsWith('エラー') ? 'text-[var(--error)]' : 'text-[var(--success)]'}`}>
                        {runResult}
                      </span>
                    )}
                    <button
                      onClick={() => handleRun(detail.job.name)}
                      disabled={running}
                      className="px-3 py-1.5 bg-[var(--info)] hover:bg-[#405a8a] rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      {running ? '実行中...' : '手動実行'}
                    </button>
                  </div>
                </div>
                {detail.job.summary && (
                  <div className="text-sm text-[var(--accent)] mb-1">{detail.job.summary}</div>
                )}
                {detail.job.description && (
                  <div className="text-sm text-[var(--text-dim)] mb-4">{detail.job.description}</div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div className="col-span-2 md:col-span-4 bg-[var(--surface-alt)] p-4 rounded-lg border border-[var(--border)]">
                    <div className="mb-3">
                      <span className="text-[var(--text-dim)] font-medium">スケジュール (Cron)</span>
                    </div>

                    <CronEditor
                      value={editedCron ?? detail.job.cron}
                      onChange={(newCron) => {
                        if (editedCron === null) setEditedCron(detail.job.cron);
                        setEditedCron(newCron);
                      }}
                    />
                    {editedCron !== null && editedCron !== detail.job.cron && (
                      <div className="flex items-center gap-3 mt-3">
                        <button
                          onClick={async () => {
                            setSavingSchedule(true);
                            try {
                              await updateCronJob(detail.job.name, { cron: editedCron });
                              const data = await getCronJobDetail(detail.job.name);
                              setDetail(data);
                              setAllJobs(await getAllCronJobs());
                              setEditedCron(null);
                            } catch (e: any) {
                              setRunResult(`エラー: ${e.message}`);
                            } finally {
                              setSavingSchedule(false);
                            }
                          }}
                          disabled={savingSchedule}
                          className="px-4 py-2 bg-[var(--accent)] text-[#ffffff] rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
                        >
                          {savingSchedule ? '保存中...' : '保存'}
                        </button>
                        <button
                          onClick={() => setEditedCron(null)}
                          className="text-xs text-[var(--accent)] hover:underline"
                        >
                          キャンセル
                        </button>
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="text-[var(--text-dim)]">タイムゾーン</span>
                    <div className="text-[var(--text)]">{detail.job.tz}</div>
                  </div>
                  <div>
                    <span className="text-[var(--text-dim)]">Bot</span>
                    <div className="text-[var(--text)]">
                      {bots.find((b) => b.id === detail.job.botId)?.name || detail.job.botId || 'mei'}
                    </div>
                  </div>
                  <div>
                    <span className="text-[var(--text-dim)]">ステータス</span>
                    <div>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: detail.job.enabled ? 'rgba(74,138,74,0.12)' : 'rgba(138,112,96,0.15)',
                          color: detail.job.enabled ? 'var(--success)' : 'var(--text-dim)',
                        }}
                      >
                        {detail.job.enabled ? 'enabled' : 'disabled'}
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="text-[var(--text-dim)]">送信先</span>
                    <div className="text-[var(--text)] text-xs">{channelName(detail.job.slackTarget)}</div>
                  </div>
                  <div>
                    <span className="text-[var(--text-dim)]">タイムアウト</span>
                    <div className="text-[var(--text)]">{detail.job.timeoutSeconds}s</div>
                  </div>
                  <div>
                    <span className="text-[var(--text-dim)]">Slack送信</span>
                    <div>
                      <button
                        className="text-xs px-2 py-0.5 rounded-full cursor-pointer"
                        style={{
                          backgroundColor: detail.job.silentMode ? 'rgba(138,112,96,0.15)' : 'rgba(74,138,74,0.12)',
                          color: detail.job.silentMode ? 'var(--text-dim)' : 'var(--success)',
                        }}
                        onClick={async () => {
                          await updateCronJob(detail.job.name, { silentMode: !detail.job.silentMode });
                          const data = await getCronJobDetail(detail.job.name);
                          if (data) setDetail(data);
                        }}
                      >
                        {detail.job.silentMode ? 'OFF' : 'ON'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Prompt / Command Editor */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-[var(--text-dim)]">
                    {detail.job.command ? 'コマンド' : 'プロンプト'}
                  </h4>
                </div>
                <textarea
                  value={editedPrompt ?? (detail.job.command || detail.job.message || '')}
                  onChange={(e) => setEditedPrompt(e.target.value)}
                  rows={detail.job.command ? 3 : 8}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] font-mono focus:outline-none focus:border-[var(--accent)] resize-y"
                  placeholder={detail.job.command ? 'cd /path && ./script.sh' : 'Claude に実行させるタスクの指示...'}
                />
                {editedPrompt !== null && editedPrompt !== (detail.job.command || detail.job.message || '') && (
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      onClick={async () => {
                        setSavingPrompt(true);
                        try {
                          const update = detail.job.command
                            ? { command: editedPrompt }
                            : { message: editedPrompt };
                          await updateCronJob(detail.job.name, update);
                          const data = await getCronJobDetail(detail.job.name);
                          setDetail(data);
                          setEditedPrompt(null);
                          setRunResult('保存しました');
                          setTimeout(() => setRunResult(null), 3000);
                        } catch (e: any) {
                          setRunResult(`エラー: ${e.message}`);
                        } finally {
                          setSavingPrompt(false);
                        }
                      }}
                      disabled={savingPrompt}
                      className="px-4 py-2 bg-[var(--accent)] text-[#ffffff] rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
                    >
                      {savingPrompt ? '保存中...' : '保存'}
                    </button>
                    <button
                      onClick={() => setEditedPrompt(null)}
                      className="text-xs text-[var(--accent)] hover:underline"
                    >
                      キャンセル
                    </button>
                  </div>
                )}
              </div>

              {/* Output Sample */}
              {(() => {
                const liveOutput = detail.history.find(h => h.outputPreview)?.outputPreview;
                const sampleRaw = liveOutput || detail.job.outputExample;
                if (!sampleRaw) return null;
                return (
                  <div className="mb-6">
                    <h4 className="text-sm font-semibold text-[var(--text-dim)] mb-2">
                      {liveOutput ? '直近の出力' : '出力イメージ'}
                    </h4>
                    <div className="bg-[var(--bg)] rounded-lg p-4 max-h-48 overflow-y-auto">
                      <SlackPreview raw={sampleRaw} />
                    </div>
                  </div>
                );
              })()}

              {/* Execution History */}
              <div>
                <h4 className="text-sm font-semibold text-[var(--text-dim)] mb-3">実行履歴</h4>
                {detail.history.length === 0 ? (
                  <div className="text-[var(--text-dim)] text-sm">実行履歴がありません</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[var(--text-dim)] text-xs uppercase tracking-[0.05em] font-medium border-b border-[var(--border)]">
                          <th className="text-left py-2 pr-4">日時</th>
                          <th className="text-left py-2 pr-4">所要時間</th>
                          <th className="text-left py-2 pr-4">ステータス</th>
                          <th className="text-left py-2">エラー</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.history.map((entry, i) => (
                          <tr key={i} className="border-b border-[var(--border)]/50">
                            <td className="py-2 pr-4 text-[var(--text)] font-mono text-xs">
                              {formatDateJST(entry.startedAt)}
                            </td>
                            <td className="py-2 pr-4 text-[var(--text-dim)]">
                              {formatDuration(entry.durationMs)}
                            </td>
                            <td className="py-2 pr-4">
                              <StatusBadge status={entry.status} />
                            </td>
                            <td className="py-2 text-[var(--text-dim)] text-xs max-w-xs truncate">
                              {entry.error || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-[var(--text-dim)]">データを取得できませんでした</div>
          )}
        </div>
      )}
    </div>
  );
}
