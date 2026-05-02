// dashboard/src/components/ember-chat/useAlwaysOn.ts
//
// Ports the RMS-based Voice Activity Detection (VAD) loop from the legacy
// always-on.js (Silero VAD + RMS fallback). Only the RMS path is implemented
// here — adequate to send detected speech to the voice_chat server, which
// then emits user_text / assistant_text / status WebSocket messages that the
// existing useEmberChat handler renders.

import { useCallback, useEffect, useRef, useState } from 'react';

import type { AlwaysOnState } from './ServerStatusBar';

const CONSENT_KEY = 'ember.alwaysOn.consented';
const ENABLED_KEY = 'ember.alwaysOn.enabled';

const RMS_THRESHOLD = 0.02;
const MIN_SPEECH_MS = 500;
const SILENCE_TIMEOUT_MS = 800;
const STALE_MS = 2 * 60 * 1000;
const RESTART_MS = 10 * 60 * 1000;

// Soft hint: matched devices score higher, but getUserMedia success decides final pick.
// Electron's "Default - X" alias often returns silent streams, so we always skip those.
const PREFERRED_MIC_PATTERN: RegExp | null = /MacBook Pro/i;

interface MicCandidate {
  deviceId: string;
  label: string;
  score: number;
  reason: string;
}

interface MicProbeResult {
  ok: boolean;
  peak: number;
  rms: number;
  durationMs: number;
  reason: string;
}

interface MicAttemptDiagnostic {
  label: string;
  score: number;
  result: MicProbeResult;
}

interface MicAcquireResult {
  stream: MediaStream | null;
  chosen: { deviceId: string; label: string; peak: number; rms: number } | null;
  attempts: MicAttemptDiagnostic[];
  errors: string[];
  permissionDenied?: boolean;
}

async function acquireDisplayAudioStream(): Promise<{ stream: MediaStream | null; reason: string }> {
  if (!navigator.mediaDevices.getDisplayMedia) return { stream: null, reason: 'getDisplayMedia-unavailable' };
  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    displayStream.getVideoTracks().forEach((track) => track.stop());
    const audioTracks = displayStream.getAudioTracks();
    if (audioTracks.length === 0) {
      displayStream.getTracks().forEach((track) => track.stop());
      return { stream: null, reason: 'no-audio-track' };
    }
    return { stream: new MediaStream(audioTracks), reason: 'granted' };
  } catch (err) {
    console.warn('[AlwaysOn] display/system audio capture failed', err);
    return { stream: null, reason: `display-capture-error: ${(err as Error).message}` };
  }
}

async function probeStreamLevel(stream: MediaStream, durationMs = 900): Promise<MicProbeResult> {
  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    return { ok: false, peak: 0, rms: 0, durationMs: 0, reason: 'audio-context-unavailable' };
  }
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let peak = 0;
    let rmsSum = 0;
    let samples = 0;
    const started = performance.now();
    while (performance.now() - started < durationMs) {
      analyser.getFloatTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i += 1) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
        sumSq += data[i] * data[i];
      }
      rmsSum += Math.sqrt(sumSq / data.length);
      samples += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const rms = samples > 0 ? rmsSum / samples : 0;
    return {
      ok: peak >= 0.003 || rms >= 0.0005,
      peak,
      rms,
      durationMs: Math.round(performance.now() - started),
      reason: peak >= 0.003 || rms >= 0.0005 ? 'audible' : 'silent',
    };
  } catch (err) {
    return { ok: false, peak: 0, rms: 0, durationMs: 0, reason: `probe-error: ${(err as Error).message}` };
  } finally {
    if (ctx) {
      try { await ctx.close(); } catch { /* ignore */ }
    }
  }
}

async function labelForDevice(deviceId: string): Promise<string> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const dev = devices.find((d) => d.deviceId === deviceId);
    if (dev?.label) return dev.label;
  } catch { /* ignore */ }
  return deviceId ? deviceId.slice(0, 8) : '(default)';
}

function rankMicCandidates(devices: MediaDeviceInfo[]): MicCandidate[] {
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d) => {
      const label = d.label || '';
      let score = 50;
      let reason = 'available';
      // Electron "Default - X" alias returns silent stream — score below 0 to drop.
      if (/^Default\s*[-–:]/i.test(label)) {
        score = -100;
        reason = 'default-alias-skipped';
      } else if (PREFERRED_MIC_PATTERN && PREFERRED_MIC_PATTERN.test(label)) {
        score = 100;
        reason = 'preferred-pattern-match';
      }
      // Penalize virtual devices (Teams, BlackHole, Loopback, etc.)
      if (/(Virtual|Teams|BlackHole|Loopback|VB-Cable|iShowU)/i.test(label)) {
        score -= 30;
        reason += ',virtual-penalty';
      }
      // Prefer non-empty labels; empty labels usually mean unrecoverable enumeration.
      if (!label) {
        score -= 50;
        reason = 'no-label';
      }
      return { deviceId: d.deviceId, label, score, reason };
    })
    .filter((c) => c.score >= 0)
    .sort((a, b) => b.score - a.score);
}

async function acquireHealthyMicStream(
  audioConstraints: MediaTrackConstraints,
  selectedDeviceId?: string,
): Promise<MicAcquireResult> {
  const attempts: MicAttemptDiagnostic[] = [];
  const errors: string[] = [];

  // Permission-first path: getUserMedia success means the user/system allowed
  // capture. Do not reject a stream just because the room is quiet at startup.
  // Start with the OS/browser default device. This matches the old one-click
  // behavior and avoids Electron/macOS cases where an exact deviceId returns a
  // granted but silent stream.
  let fallback: MicAcquireResult | null = null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    const result = await probeStreamLevel(stream);
    attempts.push({ label: '(system default)', score: 250, result });
    console.log('[AlwaysOn] system default mic acquired');
    if (result.ok) {
      return { stream, chosen: { deviceId: '', label: '(system default)', peak: result.peak, rms: result.rms }, attempts, errors };
    }
    fallback = { stream, chosen: { deviceId: '', label: '(system default)', peak: result.peak, rms: result.rms }, attempts, errors };
  } catch (err) {
    const e = err as DOMException;
    errors.push(`system default getUserMedia failed: ${e.message}`);
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
      return { stream: null, chosen: null, attempts, errors, permissionDenied: true };
    }
  }

  if (selectedDeviceId) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...audioConstraints, deviceId: { exact: selectedDeviceId } },
      });
      const label = await labelForDevice(selectedDeviceId);
      const result = await probeStreamLevel(stream);
      attempts.push({ label, score: 200, result });
      console.log(`[AlwaysOn] user-selected mic acquired: '${label}'`);
      if (result.ok) {
        if (fallback?.stream) fallback.stream.getTracks().forEach((t) => t.stop());
        return { stream, chosen: { deviceId: selectedDeviceId, label, peak: result.peak, rms: result.rms }, attempts, errors };
      }
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      const e = err as DOMException;
      errors.push(`user-selected getUserMedia failed: ${e.message}`);
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
        return { stream: null, chosen: null, attempts, errors, permissionDenied: true };
      }
      // fall through to candidate scan
    }
  }

  // Step 1: probe-then-enumerate to get device labels.
  let probeStream: MediaStream | null = null;
  try {
    probeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    errors.push(`probe getUserMedia failed: ${(err as Error).message}`);
  }
  let candidates: MicCandidate[] = [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    candidates = rankMicCandidates(devices);
  } catch (err) {
    errors.push(`enumerateDevices failed: ${(err as Error).message}`);
  } finally {
    if (probeStream) probeStream.getTracks().forEach((t) => t.stop());
  }
  console.log('[AlwaysOn] mic candidates ranked:', candidates.map((c) => `${c.label}(score=${c.score},${c.reason})`));

  // Step 2: try each candidate and return the first stream the OS grants.
  for (const cand of candidates) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...audioConstraints, deviceId: { exact: cand.deviceId } },
      });
      const result = await probeStreamLevel(stream);
      attempts.push({ label: cand.label, score: cand.score, result });
      console.log(`[AlwaysOn] candidate mic acquired: '${cand.label}'`);
      if (result.ok) {
        if (fallback?.stream) fallback.stream.getTracks().forEach((t) => t.stop());
        return { stream, chosen: { deviceId: cand.deviceId, label: cand.label, peak: result.peak, rms: result.rms }, attempts, errors };
      }
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      const e = err as DOMException;
      attempts.push({
        label: cand.label,
        score: cand.score,
        result: { ok: false, peak: 0, rms: 0, durationMs: 0, reason: `acquire-error: ${e.message}` },
      });
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
        return { stream: null, chosen: null, attempts, errors, permissionDenied: true };
      }
    }
  }

  // Last resort: keep the granted default stream so permission flow remains
  // one-click even when the room or OS input path is currently silent.
  if (fallback) {
    const displayAudio = await acquireDisplayAudioStream();
    if (displayAudio.stream) {
      const result = await probeStreamLevel(displayAudio.stream);
      attempts.push({ label: '(system/display audio)', score: 300, result });
      if (result.ok) {
        fallback.stream?.getTracks().forEach((t) => t.stop());
        return {
          stream: displayAudio.stream,
          chosen: { deviceId: 'display-audio', label: '(system/display audio)', peak: result.peak, rms: result.rms },
          attempts,
          errors,
        };
      }
      displayAudio.stream.getTracks().forEach((t) => t.stop());
    } else {
      attempts.push({
        label: '(system/display audio)',
        score: 300,
        result: { ok: false, peak: 0, rms: 0, durationMs: 0, reason: displayAudio.reason },
      });
    }
    console.warn('[AlwaysOn] no audible mic found; using granted system default stream');
    return fallback;
  }

  return { stream: null, chosen: null, attempts, errors };
}

function summarizeMicAcquire(result: MicAcquireResult): string {
  const lines: string[] = [];
  if (result.chosen) {
    if (result.chosen.peak >= 0 && result.chosen.rms >= 0) {
      lines.push(`mic chosen: '${result.chosen.label}' (peak=${result.chosen.peak.toFixed(4)}, rms=${result.chosen.rms.toFixed(5)})`);
    } else {
      lines.push(`mic chosen: '${result.chosen.label}' (permission granted)`);
    }
  } else {
    lines.push('mic chosen: NONE — all candidates failed');
  }
  if (result.attempts.length > 0) {
    lines.push('attempts:');
    for (const a of result.attempts) {
      lines.push(`  - ${a.label}: ${a.result.ok ? 'OK' : 'FAIL'} ${a.result.reason}`);
    }
  }
  if (result.errors.length > 0) {
    lines.push(`errors: ${result.errors.join('; ')}`);
  }
  return lines.join('\n');
}

function hasAudibleAttempt(result: MicAcquireResult): boolean {
  return result.attempts.some((attempt) => attempt.result.ok);
}

export interface UseAlwaysOnOptions {
  wsRef: React.MutableRefObject<WebSocket | null>;
  inputDeviceId?: string; // empty = auto
}

export interface UseAlwaysOnReturn {
  state: AlwaysOnState;
  consentRequired: boolean;
  lastError: string | null;
  toggle: () => void;
  acceptConsent: () => void;
  declineConsent: () => void;
}

interface InternalRefs {
  micStream: MediaStream | null;
  audioCtx: AudioContext | null;
  checkInterval: ReturnType<typeof setInterval> | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  speechStart: number | null;
  silenceTimer: ReturnType<typeof setTimeout> | null;
  lastAudioSendTs: number;
  watchdog: ReturnType<typeof setInterval> | null;
  // raw chunk recorder
  rawChunkInterval: ReturnType<typeof setInterval> | null;
  currentChunkRecorder: MediaRecorder | null;
  chunkStream: MediaStream | null;
  chunkStreamMode: 'dedicated_no_ec_ns' | 'shared_fallback';
  rawMicStream: MediaStream | null;
  rawChunkStream: MediaStream | null;
  restartingAfterTinyAudio: boolean;
}

export function useAlwaysOn({ wsRef, inputDeviceId }: UseAlwaysOnOptions): UseAlwaysOnReturn {
  // Restore enabled state from previous launch. Combined with Electron's
  // autoplay-policy relaxation in main.js, mic auto-acquisition works.
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(ENABLED_KEY) === 'true';
  });
  const [consentRequired, setConsentRequired] = useState(false);
  const [stale, setStale] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
    }
  }, [enabled]);

  const refs = useRef<InternalRefs>({
    micStream: null,
    audioCtx: null,
    checkInterval: null,
    recorder: null,
    chunks: [],
    speechStart: null,
    silenceTimer: null,
    lastAudioSendTs: 0,
    watchdog: null,
    rawChunkInterval: null,
    currentChunkRecorder: null,
    chunkStream: null,
    chunkStreamMode: 'shared_fallback',
    rawMicStream: null,
    rawChunkStream: null,
    restartingAfterTinyAudio: false,
  });

  const sendDiagnostic = useCallback((kind: string, message: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: 'client_diagnostic', kind, message, ts: Date.now() }));
    } catch {
      /* ignore */
    }
  }, [wsRef]);

  const sendAudio = useCallback(async (buf: ArrayBuffer, speechTs: number) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[AlwaysOn] cannot send: ws state =', ws?.readyState);
      return;
    }
    try {
      console.log(`[AlwaysOn] sending always_on_audio: ${buf.byteLength} bytes, speech_ts=${speechTs}`);
      ws.send(JSON.stringify({
        type: 'always_on_audio',
        format: 'wav',
        speech_ts: speechTs,
      }));
      ws.send(buf);
      refs.current.lastAudioSendTs = Date.now();
      setStale(false);
    } catch (err) {
      console.warn('[AlwaysOn] send failed', err);
    }
  }, [wsRef]);

  const stopRawChunkRecorder = useCallback(() => {
    const r = refs.current;
    if (r.rawChunkInterval) { clearInterval(r.rawChunkInterval); r.rawChunkInterval = null; }
    if (r.currentChunkRecorder) {
      try { r.currentChunkRecorder.stop(); } catch {}
      r.currentChunkRecorder = null;
    }
    if (r.chunkStream && r.chunkStream !== r.micStream) {
      try { r.chunkStream.getTracks().forEach((t) => t.stop()); } catch {}
    }
    r.chunkStream = null;
  }, []);

  const stop = useCallback(() => {
    const r = refs.current;
    stopRawChunkRecorder();
    if (r.checkInterval) { clearInterval(r.checkInterval); r.checkInterval = null; }
    if (r.silenceTimer) { clearTimeout(r.silenceTimer); r.silenceTimer = null; }
    if (r.watchdog) { clearInterval(r.watchdog); r.watchdog = null; }
    if (r.recorder && r.recorder.state === 'recording') {
      try { r.recorder.stop(); } catch {}
    }
    r.recorder = null;
    r.chunks = [];
    r.speechStart = null;
    r.restartingAfterTinyAudio = false;
    if (r.audioCtx) { try { r.audioCtx.close(); } catch {} r.audioCtx = null; }
    if (r.rawMicStream) {
      r.rawMicStream.getTracks().forEach((t) => t.stop());
      r.rawMicStream = null;
    }
    if (r.rawChunkStream) {
      r.rawChunkStream.getTracks().forEach((t) => t.stop());
      r.rawChunkStream = null;
    }
    if (r.micStream) {
      r.micStream.getTracks().forEach((t) => t.stop());
      r.micStream = null;
    }
    setProcessing(false);
    setStale(false);
  }, [stopRawChunkRecorder]);

  const initRawChunkRecorder = useCallback(async () => {
    const r = refs.current;
    if (!r.micStream || r.rawChunkInterval) return;
    const RAW_MIME = 'audio/webm;codecs=opus';
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported(RAW_MIME)) {
      console.warn('[AlwaysOn] raw chunk recorder unsupported in this env');
      return;
    }
    const CHUNK_MS = 30000;

    const chunkStream = r.micStream;
    const streamMode: 'dedicated_no_ec_ns' | 'shared_fallback' = 'shared_fallback';
    if (!chunkStream) return;
    r.chunkStream = chunkStream;
    console.log('[AlwaysOn] raw chunk: using shared processed mic stream');
    sendDiagnostic('mic_chunk_acquired', 'raw chunk using shared processed mic stream');
    r.chunkStreamMode = streamMode;

    const startNewSession = () => {
      try {
        const rec = new MediaRecorder(chunkStream, { mimeType: RAW_MIME, audioBitsPerSecond: 32000 });
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
        rec.onstop = () => {
          if (chunks.length === 0) return;
          const blob = new Blob(chunks, { type: RAW_MIME });
          const ws = wsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          blob.arrayBuffer().then((buf) => {
            try {
              ws.send(JSON.stringify({ type: 'raw_audio_chunk', ts: Date.now(), stream_mode: refs.current.chunkStreamMode }));
              ws.send(buf);
            } catch (sendErr) {
              console.warn('[AlwaysOn] raw chunk send failed', sendErr);
            }
          }).catch(() => {});
        };
        rec.onerror = (e) => console.warn('[AlwaysOn] raw chunk recorder error', e);
        rec.start();
        r.currentChunkRecorder = rec;
      } catch (err) {
        console.warn('[AlwaysOn] raw chunk recorder start failed', err);
      }
    };

    startNewSession();
    r.rawChunkInterval = setInterval(() => {
      const cur = refs.current.currentChunkRecorder;
      if (cur && cur.state === 'recording') {
        try { cur.stop(); } catch {}
      }
      startNewSession();
    }, CHUNK_MS);
    console.log('[AlwaysOn] raw chunk recorder started (30s rotate)');
  }, [wsRef, sendDiagnostic, inputDeviceId]);

  const start = useCallback(async () => {
    console.log('[AlwaysOn] start() — requesting mic');
    setChecking(true);
    setLastError(null);
    const acquired = await acquireHealthyMicStream({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }, inputDeviceId);
    const summary = summarizeMicAcquire(acquired);
    console.log('[AlwaysOn] mic acquire result:\n' + summary);
    sendDiagnostic(acquired.stream ? 'mic_acquired' : 'mic_failed', summary);
    if (!acquired.stream) {
      console.error('[AlwaysOn] Mic acquisition failed. Disabling Always-On.');
      setLastError(acquired.permissionDenied
        ? 'マイク権限が許可されていません。権限確認が表示されたら許可してください。表示されない場合はmacOSの「プライバシーとセキュリティ > マイク」でEmber Chatを許可してください。'
        : 'マイクを取得できませんでした。入力デバイス設定を確認するか、Ember Chatを再起動してもう一度試してください。');
      setChecking(false);
      setEnabled(false);
      return;
    }
    const micStream = acquired.stream;
    refs.current.rawMicStream = micStream;
    console.log(`[AlwaysOn] mic stream acquired: '${acquired.chosen?.label}' tracks=${micStream.getTracks().length}`);
    refs.current.micStream = micStream;
    refs.current.lastAudioSendTs = Date.now();
    setChecking(false);
    setLastError(hasAudibleAttempt(acquired)
      ? null
      : 'マイク入力が無音です。動画をスピーカーから再生しているか、macOSのマイクモードが「声を分離」になっていないか確認してください。この環境ではシステム音声の直接取得はサポートされていません。');

    void initRawChunkRecorder();

    // Continuous chunked recording (5s rotate). Each session generates a
    // standalone webm with EBML header so server-side ffmpeg/whisper can decode.
    // Bypasses AudioContext/AnalyserNode entirely — those return all-zero
    // buffers in some Electron 35 + macOS configurations.
    const CHUNK_MS = 5000;
    const restartCapture = (reason: string) => {
      const r = refs.current;
      if (r.restartingAfterTinyAudio) return;
      r.restartingAfterTinyAudio = true;
      console.warn(`[AlwaysOn] restarting mic capture: ${reason}`);
      sendDiagnostic('mic_restart', reason);
      stop();
      refs.current.restartingAfterTinyAudio = true;
      setEnabled(false);
      setTimeout(() => {
        refs.current.restartingAfterTinyAudio = false;
        setEnabled(true);
      }, 500);
    };
    const startNewRecorderSession = () => {
      const r = refs.current;
      if (!r.micStream) return;
      try {
        const recorder = new MediaRecorder(r.micStream, { mimeType: 'audio/webm;codecs=opus' });
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = async () => {
          if (chunks.length === 0) return;
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const buf = await blob.arrayBuffer();
          console.log(`[AlwaysOn] chunk recorded ${buf.byteLength}b`);
          await sendAudio(buf, Date.now());
        };
        recorder.start();
        r.recorder = recorder;
      } catch (err) {
        console.warn('[AlwaysOn] recorder start failed', err);
      }
    };

    startNewRecorderSession();
    refs.current.checkInterval = setInterval(() => {
      const r = refs.current;
      if (r.recorder && r.recorder.state === 'recording') {
        try { r.recorder.stop(); } catch {}
      }
      startNewRecorderSession();
    }, CHUNK_MS);

    // Watchdog: detect silent failures
    refs.current.watchdog = setInterval(() => {
      const idle = Date.now() - refs.current.lastAudioSendTs;
      if (idle > RESTART_MS) {
        console.warn('[AlwaysOn] watchdog: no audio for too long, restarting');
        restartCapture('watchdog restart: no audio has been sent for too long');
      } else if (idle > STALE_MS) {
        setStale(true);
      }
    }, 30 * 1000);
  }, [sendAudio, stop, initRawChunkRecorder, sendDiagnostic, inputDeviceId]);

  // Effect: enable / disable lifecycle (always triggered by user gesture
  // since cold-start enabled=false, so no autoplay-policy issues)
  useEffect(() => {
    if (!enabled) return;
    const consented = typeof localStorage !== 'undefined'
      && localStorage.getItem(CONSENT_KEY) === 'true';
    if (!consented) {
      setConsentRequired(true);
      return;
    }
    void start();
    return () => stop();
  }, [enabled, start, stop]);

  const toggle = useCallback(() => {
    setLastError(null);
    setEnabled((v) => !v);
  }, []);

  const acceptConsent = useCallback(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CONSENT_KEY, 'true');
    }
    setConsentRequired(false);
    setLastError(null);
    void start();
  }, [start]);

  const declineConsent = useCallback(() => {
    setConsentRequired(false);
    setEnabled(false);
    setLastError(null);
  }, []);

  let state: AlwaysOnState = 'muted';
  if (lastError) {
    state = 'error';
  } else if (checking) {
    state = 'checking';
  } else if (enabled && !consentRequired) {
    if (processing) state = 'processing';
    else if (stale) state = 'listening-stale';
    else state = 'listening';
  }

  return { state, consentRequired, lastError, toggle, acceptConsent, declineConsent };
}
