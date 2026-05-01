import type { CSSProperties } from 'react';

export type AlwaysOnState = 'muted' | 'listening' | 'listening-stale' | 'processing';

interface ServerStatusBarProps {
  whisperOnline: boolean;
  voicevoxOnline: boolean;
  ollamaOnline: boolean;
  wsConnected: boolean;
  alwaysOnState: AlwaysOnState;
  onToggleAlwaysOn: () => void;
}

const containerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '6px 16px',
  background: 'var(--ember-surface-alt)',
  borderBottom: '1px solid var(--ember-border)',
  flexShrink: 0,
  fontSize: 11,
};

const itemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  color: 'var(--ember-text-dim)',
};

function dotStyle(online: boolean): CSSProperties {
  return {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: online ? 'var(--ember-success)' : 'var(--ember-danger)',
    transition: 'background 0.3s',
  };
}

function alwaysOnDotStyle(state: AlwaysOnState): CSSProperties {
  switch (state) {
    case 'listening':
      return {
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: 'var(--ember-success)',
        animation: 'ember-pulse-green 2s ease-in-out infinite',
      };
    case 'listening-stale':
      return {
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: 'rgba(34, 197, 94, 0.3)',
      };
    case 'processing':
      return {
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: 'var(--ember-warm)',
        animation: 'ember-pulse-warm 1s ease-in-out infinite',
      };
    case 'muted':
    default:
      return {
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: 'var(--ember-danger)',
      };
  }
}

function alwaysOnLabel(state: AlwaysOnState): string {
  if (state === 'listening' || state === 'listening-stale') return 'Listening';
  if (state === 'processing') return 'Processing';
  return 'Muted';
}

const KEYFRAMES = `
@keyframes ember-pulse-green {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
  50% { box-shadow: 0 0 0 4px rgba(34, 197, 94, 0); }
}
@keyframes ember-pulse-warm {
  0%, 100% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.4); }
  50% { box-shadow: 0 0 0 4px rgba(251, 191, 36, 0); }
}
`;

export default function ServerStatusBar({
  whisperOnline,
  voicevoxOnline,
  ollamaOnline,
  wsConnected,
  alwaysOnState,
  onToggleAlwaysOn,
}: ServerStatusBarProps) {
  return (
    <div style={containerStyle}>
      <style>{KEYFRAMES}</style>
      <span style={itemStyle}>
        <span style={dotStyle(whisperOnline)} />
        <span>Whisper</span>
      </span>
      <span style={itemStyle}>
        <span style={dotStyle(voicevoxOnline)} />
        <span>VOICEVOX</span>
      </span>
      <span style={itemStyle}>
        <span style={dotStyle(ollamaOnline)} />
        <span>Ollama</span>
      </span>
      <span
        style={{ ...itemStyle, marginLeft: 'auto', cursor: 'pointer' }}
        onClick={onToggleAlwaysOn}
        title="Toggle Always-On Listening"
      >
        <span style={alwaysOnDotStyle(alwaysOnState)} />
        <span>{alwaysOnLabel(alwaysOnState)}</span>
      </span>
      <span style={itemStyle}>
        <span style={dotStyle(wsConnected)} />
        <span>WS</span>
      </span>
    </div>
  );
}
