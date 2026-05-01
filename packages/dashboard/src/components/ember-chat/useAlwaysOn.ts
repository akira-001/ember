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

const RMS_THRESHOLD = 0.05;
const MIN_SPEECH_MS = 500;
const SILENCE_TIMEOUT_MS = 800;
const STALE_MS = 2 * 60 * 1000;
const RESTART_MS = 10 * 60 * 1000;

export interface UseAlwaysOnOptions {
  wsRef: React.MutableRefObject<WebSocket | null>;
}

export interface UseAlwaysOnReturn {
  state: AlwaysOnState;
  consentRequired: boolean;
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
}

export function useAlwaysOn({ wsRef }: UseAlwaysOnOptions): UseAlwaysOnReturn {
  const [enabled, setEnabled] = useState(false);
  const [consentRequired, setConsentRequired] = useState(false);
  const [stale, setStale] = useState(false);
  const [processing, setProcessing] = useState(false);

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
  });

  const sendAudio = useCallback(async (buf: ArrayBuffer, speechTs: number) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
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

  const stop = useCallback(() => {
    const r = refs.current;
    if (r.checkInterval) { clearInterval(r.checkInterval); r.checkInterval = null; }
    if (r.silenceTimer) { clearTimeout(r.silenceTimer); r.silenceTimer = null; }
    if (r.watchdog) { clearInterval(r.watchdog); r.watchdog = null; }
    if (r.recorder && r.recorder.state === 'recording') {
      try { r.recorder.stop(); } catch {}
    }
    r.recorder = null;
    r.chunks = [];
    r.speechStart = null;
    if (r.audioCtx) { try { r.audioCtx.close(); } catch {} r.audioCtx = null; }
    if (r.micStream) {
      r.micStream.getTracks().forEach((t) => t.stop());
      r.micStream = null;
    }
    setProcessing(false);
    setStale(false);
  }, []);

  const start = useCallback(async () => {
    let micStream: MediaStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      console.error('[AlwaysOn] Mic access denied:', err);
      setEnabled(false);
      return;
    }
    refs.current.micStream = micStream;

    const audioCtx = new AudioContext();
    refs.current.audioCtx = audioCtx;
    const source = audioCtx.createMediaStreamSource(micStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const dataArray = new Float32Array(analyser.fftSize);

    refs.current.lastAudioSendTs = Date.now();

    refs.current.checkInterval = setInterval(() => {
      const r = refs.current;
      if (!r.audioCtx) return;
      analyser.getFloatTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
      const rms = Math.sqrt(sum / dataArray.length);

      if (rms > RMS_THRESHOLD) {
        if (!r.speechStart) {
          r.speechStart = Date.now();
          r.chunks = [];
          try {
            const recorder = new MediaRecorder(micStream, { mimeType: 'audio/webm;codecs=opus' });
            recorder.ondataavailable = (e) => { if (e.data.size > 0) r.chunks.push(e.data); };
            recorder.onstop = async () => {
              if (r.chunks.length === 0) return;
              const blob = new Blob(r.chunks, { type: 'audio/webm' });
              const buf = await blob.arrayBuffer();
              const speechTs = r.speechStart ?? Date.now();
              r.speechStart = null;
              r.chunks = [];
              await sendAudio(buf, speechTs);
            };
            recorder.start();
            r.recorder = recorder;
          } catch (err) {
            console.warn('[AlwaysOn] recorder start failed', err);
            r.speechStart = null;
          }
        }
        if (r.silenceTimer) { clearTimeout(r.silenceTimer); r.silenceTimer = null; }
      } else if (r.speechStart) {
        if (!r.silenceTimer) {
          r.silenceTimer = setTimeout(() => {
            const cur = refs.current;
            const elapsed = cur.speechStart ? Date.now() - cur.speechStart : 0;
            if (cur.recorder && cur.recorder.state === 'recording') {
              if (elapsed >= MIN_SPEECH_MS) {
                try { cur.recorder.stop(); } catch {}
              } else {
                try { cur.recorder.stop(); } catch {}
                cur.chunks = [];
                cur.speechStart = null;
              }
            }
            cur.silenceTimer = null;
          }, SILENCE_TIMEOUT_MS);
        }
      }
    }, 50);

    // Watchdog: detect silent failures
    refs.current.watchdog = setInterval(() => {
      const idle = Date.now() - refs.current.lastAudioSendTs;
      if (idle > RESTART_MS) {
        console.warn('[AlwaysOn] watchdog: no audio for too long, restarting');
        // Restart by toggling
        stop();
        // re-enable on next tick so useEffect picks it up
        setTimeout(() => { setEnabled(true); }, 300);
      } else if (idle > STALE_MS) {
        setStale(true);
      }
    }, 30 * 1000);
  }, [sendAudio, stop]);

  // Effect: enable / disable lifecycle
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
    setEnabled((v) => !v);
  }, []);

  const acceptConsent = useCallback(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CONSENT_KEY, 'true');
    }
    setConsentRequired(false);
    void start();
  }, [start]);

  const declineConsent = useCallback(() => {
    setConsentRequired(false);
    setEnabled(false);
  }, []);

  let state: AlwaysOnState = 'muted';
  if (enabled && !consentRequired) {
    if (processing) state = 'processing';
    else if (stale) state = 'listening-stale';
    else state = 'listening';
  }

  return { state, consentRequired, toggle, acceptConsent, declineConsent };
}
