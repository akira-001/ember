// dashboard/src/components/ember-chat/TalkButton.tsx
//
// Round 64x64 TALK button restored from the legacy standalone Ember Chat
// renderer (packages/ember-chat/renderer/index.html lines 417-447).
// Visual states: idle / recording (pulse) / reply-mode / disabled / processing.

import type { CSSProperties } from 'react';

interface TalkButtonProps {
  recording: boolean;
  processing: boolean;
  replyMode: boolean;
  onClick: () => void;
}

const KEYFRAMES_ID = 'ember-talk-btn-pulse-keyframes';

function ensurePulseKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = `
@keyframes ember-talk-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}
`;
  document.head.appendChild(style);
}

export default function TalkButton({
  recording,
  processing,
  replyMode,
  onClick,
}: TalkButtonProps) {
  ensurePulseKeyframes();

  const accent = replyMode ? 'var(--ember-warm)' : 'var(--ember-primary)';
  const accentGlow = replyMode
    ? 'var(--ember-warm-glow)'
    : 'var(--ember-primary-glow)';

  const baseStyle: CSSProperties = {
    width: 64,
    height: 64,
    borderRadius: '50%',
    border: `3px solid ${accent}`,
    background: recording ? accent : 'transparent',
    color: recording ? '#fff' : accent,
    fontSize: 12,
    fontWeight: 700,
    cursor: processing ? 'not-allowed' : 'pointer',
    transition: 'all 0.2s',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    letterSpacing: '0.02em',
    opacity: processing ? 0.4 : 1,
    animation: recording ? 'ember-talk-pulse 1s infinite' : undefined,
  };

  const handleHoverEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (processing || recording) return;
    e.currentTarget.style.background = accentGlow;
  };

  const handleHoverLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (processing || recording) return;
    e.currentTarget.style.background = 'transparent';
  };

  const label = processing
    ? '...'
    : replyMode
      ? 'REPLY'
      : 'TALK';

  return (
    <button
      type="button"
      onClick={processing ? undefined : onClick}
      disabled={processing}
      style={baseStyle}
      onMouseEnter={handleHoverEnter}
      onMouseLeave={handleHoverLeave}
      aria-pressed={recording}
      aria-label={recording ? 'Stop recording' : label}
    >
      {label}
    </button>
  );
}
