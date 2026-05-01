import type { ProactiveState, UserInsight, Constants, BotConfigJson, PersonalityTemplates, CronJob, UserProfile, ProfileFieldMeta, CollectionConfig } from './types';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// --- Bots ---
export const getBots = () =>
  request<Array<{ id: string; name: string; enabled: boolean; models: { chat: string; cron: string }; personality: { type: string; motif: string } }>>('/bots');

export const getBot = (botId: string) =>
  request<BotConfigJson>(`/bots/${botId}`);

export const resolveIdentity = (botToken: string) =>
  request<{ botId: string; userId: string; displayName: string; username: string }>(
    '/bots/resolve-identity',
    { method: 'POST', body: JSON.stringify({ botToken }) },
  );

export const createBot = (config: Partial<BotConfigJson>) =>
  request<{ ok: boolean }>('/bots', {
    method: 'POST',
    body: JSON.stringify(config),
  });

export const updateBot = (botId: string, config: Partial<BotConfigJson>) =>
  request<{ ok: boolean }>(`/bots/${botId}`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });

export const deleteBot = (botId: string) =>
  request<{ ok: boolean }>(`/bots/${botId}`, { method: 'DELETE' });

export const enableBot = (botId: string) =>
  request<{ ok: boolean }>(`/bots/${botId}/enable`, { method: 'POST' });

export const disableBot = (botId: string) =>
  request<{ ok: boolean }>(`/bots/${botId}/disable`, { method: 'POST' });

// --- Per-Bot State ---
export const getState = (botId: string) =>
  request<ProactiveState>(`/bots/${botId}/state`);

export const updateWeights = (botId: string, weights: Record<string, number>) =>
  request<void>(`/bots/${botId}/state/weights`, {
    method: 'PUT',
    body: JSON.stringify({ categoryWeights: weights }),
  });

export const resetCooldown = (botId: string) =>
  request<void>(`/bots/${botId}/state/cooldown/reset`, { method: 'PUT' });

// --- Per-Bot Constants ---
export const getConstants = (botId: string) =>
  request<Constants>(`/bots/${botId}/constants`);

export const updateConstants = (botId: string, constants: Constants) =>
  request<void>(`/bots/${botId}/constants`, {
    method: 'PUT',
    body: JSON.stringify(constants),
  });

// --- Per-Bot Prompt ---
export const getPrompt = (botId: string) =>
  request<{ prompt: string; personality: { type: string; motif: string } }>(`/bots/${botId}/prompt`);

export const updatePrompt = (botId: string, prompt: string) =>
  request<void>(`/bots/${botId}/prompt`, {
    method: 'PUT',
    body: JSON.stringify({ prompt }),
  });

// --- Per-Bot Proactive Config ---
export const getProactiveConfig = (botId: string) =>
  request<{ enabled: boolean; schedule: string; slackTarget: string; calendarExclusions: string[] }>(`/bots/${botId}/proactive`);

export const updateProactiveConfig = (botId: string, config: { enabled?: boolean; schedule?: string; slackTarget?: string; calendarExclusions?: string[] }) =>
  request<void>(`/bots/${botId}/proactive`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });

export const runProactiveNow = (botId: string) => {
  const jobName = botId === 'mei' ? 'proactive-checkin' : `proactive-checkin-${botId}`;
  return request<{ status: string; durationMs?: number; error?: string }>(`/cron-jobs/${encodeURIComponent(jobName)}/run`, {
    method: 'POST',
  });
};

export const updateProactiveState = (botId: string, updates: { allowNoReply?: boolean; conversationProfile?: string }) =>
  request<{ ok: boolean }>(`/proactive/state?botId=${botId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });

// --- Per-Bot Models & Limits ---
export const getModelsLimits = (botId: string) =>
  request<{ models: { chat: string; cron: string }; rateLimits: any; tokenBudget: any }>(`/bots/${botId}/models`);

export const updateModelsLimits = (botId: string, config: { models?: any; rateLimits?: any; tokenBudget?: any }) =>
  request<void>(`/bots/${botId}/models`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });

// --- Per-Bot Cron Jobs ---
export const getBotCronJobs = (botId: string) =>
  request<string[]>(`/bots/${botId}/cron-jobs`);

export const updateBotCronJobs = (botId: string, jobs: string[]) =>
  request<void>(`/bots/${botId}/cron-jobs`, {
    method: 'PUT',
    body: JSON.stringify({ cronJobs: jobs }),
  });

// --- Per-Bot MCP Servers ---
export const getBotMcpServers = (botId: string) =>
  request<string[]>(`/bots/${botId}/mcp-servers`);

export const updateBotMcpServers = (botId: string, servers: string[]) =>
  request<void>(`/bots/${botId}/mcp-servers`, {
    method: 'PUT',
    body: JSON.stringify({ mcpServers: servers }),
  });

// --- Insights (shared) ---
export const getInsights = () => request<UserInsight[]>('/insights');

export const addInsight = (insight: Partial<UserInsight>) =>
  request<void>('/insights', {
    method: 'POST',
    body: JSON.stringify(insight),
  });

export const updateInsight = (index: number, insight: Partial<UserInsight>) =>
  request<void>(`/insights/${index}`, {
    method: 'PUT',
    body: JSON.stringify(insight),
  });

export const deleteInsight = (index: number) =>
  request<void>(`/insights/${index}`, { method: 'DELETE' });

// --- Personality Templates ---
export const getPersonalityTemplates = () =>
  request<PersonalityTemplates>('/personality/templates');

export const generatePrompt = (botName: string, type: string, motif: string) =>
  request<{ prompt: string }>('/personality/generate', {
    method: 'POST',
    body: JSON.stringify({ botName, type, motif }),
  });

// --- Cron Job CRUD ---
export const createCronJob = (job: { name: string; summary?: string; cron: string; message?: string; command?: string; slackTarget?: string; timeoutSeconds?: number; botId?: string }) =>
  request<{ ok: boolean; job: CronJob }>('/cron-jobs', {
    method: 'POST',
    body: JSON.stringify(job),
  });

export const getCronJobDetail = (name: string) =>
  request<{ job: any; history: any[] }>(`/cron-jobs/${encodeURIComponent(name)}`);

export const updateCronJob = (name: string, updates: Partial<CronJob>) =>
  request<{ ok: boolean }>(`/cron-jobs/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });

export const runCronJob = (name: string) =>
  request<{ status: string; output?: string; error?: string; durationMs?: number }>(`/cron-jobs/${encodeURIComponent(name)}/run`, { method: 'POST' });

// --- Proactive Analytics Types ---
export interface ScoredCandidateResponse {
  topic: string;
  source: string;
  category: string;
  scores: {
    timeliness: number;
    novelty: number;
    continuity: number;
    emotional_fit: number;
    affinity: number;
    surprise: number;
  };
  finalScore: number;
  explorationBonus?: number;
  selectionScore?: number;
  reasoning: string;
}

export interface LearningStateResponse {
  priors: Record<string, { alpha: number; beta: number }>;
  totalSelections: number;
  categorySelections: Record<string, number>;
  lastUpdated: string;
  version: number;
}

// --- Proactive Analytics ---
export const getProactiveStats = (botId: string) =>
  request<any>(`/proactive/stats?botId=${botId}`);

export const getProactiveHistory = (botId: string, limit = 20) =>
  request<any[]>(`/proactive/history?botId=${botId}&limit=${limit}`);

export const getProactiveInterests = () =>
  request<any>('/proactive/interests');

// --- Intrinsic Config ---
export const updateIntrinsicConfig = (botId: string, config: { lambda?: number; enabledSignals?: string[] }) =>
  request<{ ok: boolean; intrinsicConfig: any }>(`/proactive/intrinsic-config?botId=${botId}`, {
    method: 'PATCH',
    body: JSON.stringify(config),
  });

// --- Learning State Management ---
export const updateLearningState = (botId: string, priors: Record<string, { alpha: number; beta: number }>) =>
  request<{ ok: boolean; learningState: LearningStateResponse }>(`/proactive/learning-state?botId=${botId}`, {
    method: 'PUT',
    body: JSON.stringify({ priors }),
  });

export interface YomiganaRule {
  pattern: string;
  replacement: string;
}

export const getEmberYomiganaDictionary = () =>
  fetch('/whisper/api/yomigana').then(async (res) => {
    if (!res.ok) {
      throw new Error(`API error ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<{ entries: YomiganaRule[] }>;
  });

export const updateEmberYomiganaDictionary = (entries: YomiganaRule[]) =>
  fetch('/whisper/api/yomigana', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  }).then(async (res) => {
    if (!res.ok) {
      throw new Error(`API error ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<{ ok: boolean; count: number }>;
  });

export const resetLearningState = (botId: string, axis?: string) =>
  request<{ ok: boolean; learningState: LearningStateResponse }>(`/proactive/learning-state/reset?botId=${botId}`, {
    method: 'POST',
    body: JSON.stringify(axis ? { axis } : {}),
  });

// === Profile API ===
export const getProfile = () => request<UserProfile>('/profile');
export const getProfileCompletions = () => request<Record<string, number>>('/profile/completions');
export const updateProfileField = (layer: string, field: string, data: Partial<ProfileFieldMeta>) =>
  request<{ ok: boolean }>(`/profile/layers/${layer}/fields/${field}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
export const updateCollectionConfig = (config: Partial<CollectionConfig>) =>
  request<{ ok: boolean }>('/profile/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });

// --- Event Sources ---
export const getEventSources = (botId: string) =>
  request<any>(`/bots/${botId}/event-sources`);

export const updateEventSource = (botId: string, source: string, config: any) =>
  request<any>(`/bots/${botId}/event-sources/${source}`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });

export interface AudioFixtureSidecarDraft {
  category: string;
  scene: string;
  variant: string;
  id: string;
  transcript: string;
  expected_source: string;
  expected_intervention: string;
  notes: string;
}

export const saveAudioFixtureIncoming = async (params: {
  baseName: string;
  previousBaseName?: string | null;
  wavBlob: Blob;
  sidecar: AudioFixtureSidecarDraft;
}) =>
  request<{ ok: boolean; saved: { wav: string; json: string } }>('/audio-fixtures/save', {
    method: 'POST',
    body: JSON.stringify({
      baseName: params.baseName,
      previousBaseName: params.previousBaseName ?? null,
      wavBase64: await blobToBase64(params.wavBlob),
      sidecar: params.sidecar,
    }),
  });

// --- Calendar List ---
export const getCalendarList = () =>
  request<{ id: string; summary: string; primary: boolean }[]>(`/calendars`);

// --- Intentional Pause ---
export const getIntentionalPause = (botId: string) =>
  request<any>(`/bots/${botId}/intentional-pause`);

export const updateIntentionalPause = (botId: string, config: any) =>
  request<any>(`/bots/${botId}/intentional-pause`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });

// --- Event Log ---
export const getEventLog = () =>
  request<any[]>('/event-log');

// --- Global ---
export const getAllCronJobs = () => request<CronJob[]>('/cron-jobs');
export const getAllMcpServers = () => request<string[]>('/mcp-servers');
export const getStamps = () => request<any>('/stamps');
export const getRewards = () => request<any>('/rewards');
export const restartBot = () =>
  request<{ message: string }>('/pm2/restart', { method: 'POST' });

// --- Local Models ---
export const getLocalModels = () =>
  request<{ config: any; status: { mlx: boolean; ollama: boolean } }>('/local-models');

export const updateLocalModels = (config: any) =>
  request<{ ok: boolean }>('/local-models', { method: 'PUT', body: JSON.stringify(config) });

export const getLocalModelJobs = () =>
  request<any[]>('/local-models/jobs');

export const updateJobBackend = (jobId: string, backend: 'mlx' | 'ollama', model?: string) =>
  request<{ ok: boolean }>(`/local-models/jobs/${jobId}`, {
    method: 'PATCH',
    body: JSON.stringify({ backend, ...(model ? { model } : {}) }),
  });

export const getOllamaModels = () =>
  request<Array<{ name: string; size: string; paramSize: string; quant: string }>>('/local-models/ollama/models');

export const getServerStatus = () =>
  request<{
    mlx: { running: boolean; autoStart: boolean; loadedModels: string[]; pid: number | null };
    ollama: { running: boolean; autoStart: boolean; loadedModels: { name: string; size: string }[]; pid: number | null; runnerPids?: number[] };
    whisper: { running: boolean; autoStart?: boolean; model: string; pid: number | null };
    voicevox: { running: boolean; autoStart: boolean; containerId: string | null };
    gptsovits?: { running: boolean; autoStart: boolean; pid: number | null };
    irodori?: { running: boolean; autoStart: boolean; pid: number | null };
    dashboard?: { running: boolean; autoStart: boolean; pid: number | null };
  }>('/local-models/server-status');

export const controlServer = (server: 'mlx' | 'ollama' | 'whisper' | 'voicevox' | 'irodori' | 'gptsovits', action: 'start' | 'stop' | 'auto-start' | 'load' | 'unload', body?: any) =>
  request<{ ok: boolean; message?: string }>(`/local-models/${server}/${action}`, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });

// --- Implicit Memory ---
export const getImplicitMemory = (botId: string) =>
  request<any>(`/bots/${botId}/implicit-memory`);

export const getImplicitMemoryLayer = (botId: string, layer: string) =>
  request<any[]>(`/bots/${botId}/implicit-memory/${layer}`);

export const getImplicitMemoryStats = (botId: string) =>
  request<Record<string, number>>(`/bots/${botId}/implicit-memory/stats`);

export const deleteImplicitMemoryEntry = (botId: string, layer: string, id: string) =>
  request<{ ok: boolean }>(`/bots/${botId}/implicit-memory/${layer}/${id}`, { method: 'DELETE' });
