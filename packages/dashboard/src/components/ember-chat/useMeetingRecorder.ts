// dashboard/src/components/ember-chat/useMeetingRecorder.ts
//
// Browser-only meeting recorder (webm/Opus). Replaces the legacy
// recorder.js + window.emberBridge fs path. Records a continuous audio
// stream and POSTs to /whisper/api/transcribe/upload-recording on stop.

import { useCallback, useEffect, useRef, useState } from 'react';

const API_BASE = '/whisper/api';

export interface UseMeetingRecorderReturn {
  recording: boolean;
  busy: boolean;
  queueCount: number;
  available: boolean;
  toggle: () => Promise<void>;
}

export function useMeetingRecorder(): UseMeetingRecorderReturn {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [queueCount] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const available = typeof window !== 'undefined'
    && typeof window.MediaRecorder !== 'undefined'
    && MediaRecorder.isTypeSupported('audio/webm;codecs=opus');

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    }
  }, []);

  const start = useCallback(async () => {
    if (!available) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        setRecording(false);
        setBusy(true);
        try {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const fd = new FormData();
          fd.append('audio', blob, `meeting-${Date.now()}.webm`);
          await fetch(`${API_BASE}/transcribe/upload-recording`, {
            method: 'POST',
            body: fd,
          });
        } catch (err) {
          console.error('[meeting-recorder] upload failed', err);
        } finally {
          setBusy(false);
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
          }
        }
      };

      recorder.start();
      setRecording(true);
    } catch (err) {
      console.error('[meeting-recorder] start failed', err);
    }
  }, [available]);

  const toggle = useCallback(async () => {
    if (recording) stop();
    else await start();
  }, [recording, start, stop]);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  return { recording, busy, queueCount, available, toggle };
}
