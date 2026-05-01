import type { CSSProperties } from 'react';
import TalkButton from './TalkButton';

interface ChatControlsProps {
  recording: boolean;
  processing: boolean;
  ttsEnabled: boolean;
  proactiveEnabled: boolean;
  replyMode: boolean;
  replyBot: string | null;
  lastBotId: string | null;
  debugOpen: boolean;
  onStopAudio: () => void;
  onToggleProactive: () => void;
  onToggleReply: () => void;
  onPreview: () => void;
  onToggleTalk: () => void;
  onToggleTts: () => void;
  onToggleDebug: () => void;
  onOpenRecording: () => void;
}

const containerStyle: CSSProperties = {
  padding: '12px 14px',
  display: 'flex',
  justifyContent: 'center',
  gap: 10,
  alignItems: 'center',
  background: 'var(--ember-surface)',
  flexWrap: 'wrap',
};

const baseSideBtn: CSSProperties = {
  background: 'none',
  border: '1px solid var(--ember-border)',
  color: 'var(--ember-text-muted)',
  padding: '8px 12px',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
  transition: 'all 0.15s',
};

const onStyle: CSSProperties = {
  borderColor: 'var(--ember-primary)',
  color: 'var(--ember-primary)',
};

const proactiveOnStyle: CSSProperties = {
  borderColor: 'var(--ember-success)',
  color: 'var(--ember-success)',
};

interface SideBtnProps {
  onClick: () => void;
  state?: 'on' | 'proactive-on' | 'reply-on';
  children: React.ReactNode;
  title?: string;
}

function SideBtn({ onClick, state, children, title }: SideBtnProps) {
  let style: CSSProperties = { ...baseSideBtn };
  if (state === 'on' || state === 'reply-on') style = { ...style, ...onStyle };
  if (state === 'proactive-on') style = { ...style, ...proactiveOnStyle };
  return (
    <button type="button" onClick={onClick} style={style} title={title}>
      {children}
    </button>
  );
}

export default function ChatControls({
  recording,
  processing,
  ttsEnabled,
  proactiveEnabled,
  replyMode,
  replyBot,
  lastBotId,
  debugOpen,
  onStopAudio,
  onToggleProactive,
  onToggleReply,
  onPreview,
  onToggleTalk,
  onToggleTts,
  onToggleDebug,
  onOpenRecording,
}: ChatControlsProps) {
  const replyLabel = lastBotId
    ? (replyMode ? `Reply ${lastBotId} ON` : `Reply ${lastBotId}`)
    : null;

  return (
    <div style={containerStyle}>
      <SideBtn onClick={onStopAudio}>Stop</SideBtn>
      <SideBtn
        onClick={onToggleProactive}
        state={proactiveEnabled ? 'proactive-on' : undefined}
      >
        {proactiveEnabled ? 'Proactive ON' : 'Proactive OFF'}
      </SideBtn>
      {lastBotId && replyLabel && (
        <SideBtn
          onClick={onToggleReply}
          state={replyBot === lastBotId ? 'reply-on' : undefined}
        >
          {replyLabel}
        </SideBtn>
      )}
      <SideBtn onClick={onPreview}>Preview</SideBtn>
      <TalkButton
        recording={recording}
        processing={processing}
        replyMode={replyMode}
        onClick={onToggleTalk}
      />
      <SideBtn onClick={onToggleTts} state={ttsEnabled ? 'on' : undefined}>
        Sound
      </SideBtn>
      <SideBtn onClick={onToggleDebug} state={debugOpen ? 'on' : undefined}>
        Debug
      </SideBtn>
      <SideBtn onClick={onOpenRecording}>録音</SideBtn>
    </div>
  );
}
