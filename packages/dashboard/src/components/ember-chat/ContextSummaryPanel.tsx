import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ContextSummary } from './types';

const API_BASE = '/whisper/api';

interface ContextSummaryPanelProps {
  open: boolean;
  externalSummary?: ContextSummary | null;
}

const containerStyle: CSSProperties = {
  padding: '6px 10px',
  background: '#16181f',
  borderTop: '1px solid #2a2f3a',
  color: '#cfd6e4',
  fontSize: 11,
};

const headerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 4,
};

const labelStyle: CSSProperties = { color: '#888' };

const buttonStyle: CSSProperties = {
  borderRadius: 4,
  padding: '3px 10px',
  cursor: 'pointer',
  fontSize: 11,
  border: '1px solid',
};

const yesStyle: CSSProperties = {
  ...buttonStyle,
  background: '#1f5d3a',
  color: '#dff5e3',
  borderColor: '#2c8a55',
};

const noStyle: CSSProperties = {
  ...buttonStyle,
  background: '#5d1f1f',
  color: '#f5dada',
  borderColor: '#8a2c2c',
};

const inputStyle: CSSProperties = {
  background: '#222',
  color: '#ccc',
  border: '1px solid #444',
  borderRadius: 3,
  padding: '2px 4px',
  fontSize: 11,
};

const STALE_THRESHOLD_SEC = 180;

function ageInfo(updatedAt?: number): { text: string; isStale: boolean } {
  if (!updatedAt) return { text: '', isStale: false };
  const ageSec = Math.max(0, Math.floor(Date.now() / 1000 - updatedAt));
  const isStale = ageSec >= STALE_THRESHOLD_SEC;
  let text: string;
  if (ageSec < 60) text = `${ageSec}秒前更新`;
  else if (ageSec < 3600) text = `${Math.floor(ageSec / 60)}分前更新`;
  else text = `${Math.floor(ageSec / 3600)}時間前更新`;
  return { text, isStale };
}

export default function ContextSummaryPanel({ open, externalSummary }: ContextSummaryPanelProps) {
  const [summary, setSummary] = useState<ContextSummary | null>(null);
  const [showCorrection, setShowCorrection] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [, forceTick] = useState(0);
  const ageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Form state
  const [fixActivity, setFixActivity] = useState('');
  const [fixTopic, setFixTopic] = useState('');
  const [fixMeeting, setFixMeeting] = useState('');
  const [fixKeywords, setFixKeywords] = useState('');
  const [fixEntities, setFixEntities] = useState('');
  const [fixNote, setFixNote] = useState('');

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/context-summary`);
      const d = await r.json();
      if (d.ok) setSummary(d.summary);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (externalSummary) setSummary(externalSummary);
  }, [externalSummary]);

  useEffect(() => {
    if (!open) return;
    ageTimerRef.current = setInterval(() => forceTick((n) => n + 1), 10_000);
    return () => {
      if (ageTimerRef.current) clearInterval(ageTimerRef.current);
    };
  }, [open]);

  const flashStatus = useCallback((text: string, error = false) => {
    setFeedbackStatus({ text, error });
    setTimeout(() => setFeedbackStatus(null), 4000);
  }, []);

  const openCorrectionForm = useCallback(() => {
    setShowCorrection(true);
    if (summary) {
      setFixActivity(summary.activity ?? '');
      setFixTopic(summary.topic ?? '');
      setFixMeeting(summary.is_meeting === true ? 'true' : summary.is_meeting === false ? 'false' : '');
      setFixKeywords((summary.keywords ?? []).join(', '));
      setFixEntities((summary.named_entities ?? []).join(', '));
      setFixNote('');
    }
  }, [summary]);

  const handleYes = useCallback(async () => {
    if (!summary?.updated_at) {
      flashStatus('まだコンテキストが取得されてないよ', true);
      return;
    }
    try {
      const r = await fetch(`${API_BASE}/context-summary/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'yes', summary }),
      });
      const d = await r.json();
      if (d.ok) flashStatus('保存したよ ✓');
      else flashStatus(`失敗: ${d.error}`, true);
    } catch (err) {
      flashStatus(`失敗: ${(err as Error).message}`, true);
    }
  }, [summary, flashStatus]);

  const handleNo = useCallback(() => {
    if (showCorrection) setShowCorrection(false);
    else openCorrectionForm();
  }, [showCorrection, openCorrectionForm]);

  const submitCorrection = useCallback(async () => {
    if (!summary?.updated_at) {
      flashStatus('まだコンテキストが取得されてないよ', true);
      return;
    }
    const correction: Record<string, unknown> = {};
    if (fixActivity.trim()) correction.activity = fixActivity.trim();
    if (fixTopic.trim()) correction.topic = fixTopic.trim();
    if (fixMeeting === 'true') correction.is_meeting = true;
    else if (fixMeeting === 'false') correction.is_meeting = false;
    if (fixKeywords.trim()) correction.keywords = fixKeywords.split(',').map((s) => s.trim()).filter(Boolean);
    if (fixEntities.trim()) correction.named_entities = fixEntities.split(',').map((s) => s.trim()).filter(Boolean);
    if (fixNote.trim()) correction.note = fixNote.trim();
    if (Object.keys(correction).length === 0) {
      flashStatus('正しい答えを1つ以上入力してね', true);
      return;
    }
    try {
      const r = await fetch(`${API_BASE}/context-summary/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'no', correction, summary }),
      });
      const d = await r.json();
      if (d.ok) {
        flashStatus('修正を保存したよ ✓');
        setShowCorrection(false);
      } else {
        flashStatus(`失敗: ${d.error}`, true);
      }
    } catch (err) {
      flashStatus(`失敗: ${(err as Error).message}`, true);
    }
  }, [summary, fixActivity, fixTopic, fixMeeting, fixKeywords, fixEntities, fixNote, flashStatus]);

  if (!open) return null;

  const conf = summary?.confidence ?? 0;
  const confColor = conf >= 0.7 ? '#7dffaa' : conf >= 0.4 ? '#ffd17d' : '#888';
  const { text: ageLabel, isStale } = ageInfo(summary?.updated_at);

  return (
    <div style={containerStyle}>
      <div style={headerRowStyle}>
        <span style={{ color: '#7da6ff', fontWeight: 600 }}>推測コンテキスト</span>
        <span style={{ color: confColor }}>
          {summary?.updated_at ? `信頼度 ${conf.toFixed(2)}` : '未取得'}
        </span>
        {isStale && (
          <span
            style={{
              background: '#7a1a1a',
              color: '#ff8080',
              border: '1px solid #c0392b',
              borderRadius: 3,
              padding: '1px 6px',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.05em',
            }}
          >
            STALE
          </span>
        )}
        <span style={{ color: '#666', marginLeft: 'auto' }}>{ageLabel}</span>
        <button
          type="button"
          onClick={refresh}
          style={{
            background: '#1e3050',
            color: '#7da6ff',
            border: '1px solid #2a4a8a',
            borderRadius: 4,
            padding: '2px 8px',
            cursor: 'pointer',
            fontSize: 10,
          }}
        >
          更新
        </button>
      </div>
      <div style={{ lineHeight: 1.5 }}>
        <div>
          <span style={labelStyle}>活動:</span> <span style={{ color: '#fff' }}>{summary?.activity || '—'}</span>
          {summary?.is_meeting && <span style={{ color: '#ffb347', marginLeft: 6 }}>【会議】</span>}
        </div>
        <div>
          <span style={labelStyle}>トピック:</span> <span style={{ color: '#fff' }}>{summary?.topic || '—'}</span>
        </div>
        <div>
          <span style={labelStyle}>固有名詞:</span>{' '}
          <span style={{ color: '#9fd8ff' }}>{(summary?.named_entities ?? []).join(', ') || '—'}</span>
        </div>
        <div>
          <span style={labelStyle}>キーワード:</span>{' '}
          <span style={{ color: '#9fd8ff' }}>{(summary?.keywords ?? []).join(', ') || '—'}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <button type="button" onClick={handleYes} style={yesStyle}>
          Yes ✓ 正しい
        </button>
        <button type="button" onClick={handleNo} style={noStyle}>
          No ✗ 違う
        </button>
        {feedbackStatus && (
          <span style={{ color: feedbackStatus.error ? '#ff6e6e' : '#7dffaa', fontSize: 10 }}>
            {feedbackStatus.text}
          </span>
        )}
      </div>
      {showCorrection && (
        <div
          style={{
            marginTop: 8,
            padding: 6,
            background: '#0f1116',
            border: '1px solid #2a2f3a',
            borderRadius: 4,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '80px 1fr',
              gap: '4px 6px',
              alignItems: 'center',
            }}
          >
            <label style={labelStyle}>活動</label>
            <select value={fixActivity} onChange={(e) => setFixActivity(e.target.value)} style={inputStyle}>
              <option value="">(未指定)</option>
              <option value="working">working</option>
              <option value="video_watching">video_watching</option>
              <option value="reading">reading</option>
              <option value="meeting">meeting</option>
              <option value="chatting">chatting</option>
              <option value="idle">idle</option>
            </select>
            <label style={labelStyle}>トピック</label>
            <input
              type="text"
              value={fixTopic}
              onChange={(e) => setFixTopic(e.target.value)}
              placeholder="例: ピアノ練習動画"
              style={inputStyle}
            />
            <label style={labelStyle}>会議?</label>
            <select value={fixMeeting} onChange={(e) => setFixMeeting(e.target.value)} style={inputStyle}>
              <option value="">(未指定)</option>
              <option value="true">はい</option>
              <option value="false">いいえ</option>
            </select>
            <label style={labelStyle}>キーワード</label>
            <input
              type="text"
              value={fixKeywords}
              onChange={(e) => setFixKeywords(e.target.value)}
              placeholder="カンマ区切り: PPO, Atari"
              style={inputStyle}
            />
            <label style={labelStyle}>固有名詞</label>
            <input
              type="text"
              value={fixEntities}
              onChange={(e) => setFixEntities(e.target.value)}
              placeholder="カンマ区切り: DeepMind"
              style={inputStyle}
            />
            <label style={labelStyle}>メモ</label>
            <input
              type="text"
              value={fixNote}
              onChange={(e) => setFixNote(e.target.value)}
              placeholder="補足（任意）"
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button
              type="button"
              onClick={submitCorrection}
              style={{
                background: '#2a4a8a',
                color: '#dde6ff',
                border: '1px solid #3d6dc7',
                borderRadius: 4,
                padding: '3px 10px',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => setShowCorrection(false)}
              style={{
                background: '#333',
                color: '#ccc',
                border: '1px solid #555',
                borderRadius: 4,
                padding: '3px 10px',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
