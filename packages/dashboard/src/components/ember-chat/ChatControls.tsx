import type { CSSProperties } from 'react';
import TalkButton from './TalkButton';
import { TRANSLATION_LANGUAGE_OPTIONS, TRANSLATION_MODEL_OPTIONS, TRANSLATION_TONE_OPTIONS, TRANSLATION_VOICE_OPTIONS } from './types';

interface ChatControlsProps {
  recording: boolean;
  translationActive: boolean;
  translationConnecting: boolean;
  translationModel: string;
  translationTargetLanguage: string;
  translationVoice: string;
  translationTone: string;
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
  onToggleTranslate: () => void;
  onTranslationModelChange: (value: string) => void;
  onTranslationLanguageChange: (value: string) => void;
  onTranslationVoiceChange: (value: string) => void;
  onTranslationToneChange: (value: string) => void;
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
  onMouseDown?: () => void;
  state?: 'on' | 'proactive-on' | 'reply-on';
  children: React.ReactNode;
  title?: string;
}

function SideBtn({ onClick, onMouseDown, state, children, title }: SideBtnProps) {
  let style: CSSProperties = { ...baseSideBtn };
  if (state === 'on' || state === 'reply-on') style = { ...style, ...onStyle };
  if (state === 'proactive-on') style = { ...style, ...proactiveOnStyle };
  return (
    <button type="button" onClick={onClick} onMouseDown={onMouseDown} style={style} title={title}>
      {children}
    </button>
  );
}

export default function ChatControls({
  recording,
  translationActive,
  translationConnecting,
  translationModel,
  translationTargetLanguage,
  translationVoice,
  translationTone,
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
  onToggleTranslate,
  onTranslationModelChange,
  onTranslationLanguageChange,
  onTranslationVoiceChange,
  onTranslationToneChange,
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
      <SideBtn
        onClick={onToggleTranslate}
        onMouseDown={() => console.info('[EmberChat] Translate button pressed')}
        state={translationActive ? 'on' : undefined}
        title="OpenAI Realtime Translate"
      >
        {translationConnecting ? 'Translate...' : translationActive ? 'Translate ON' : 'Translate'}
      </SideBtn>
      <select
        value={translationModel}
        onChange={(e) => onTranslationModelChange(e.target.value)}
        disabled={translationActive || translationConnecting}
        style={{
          ...baseSideBtn,
          padding: '8px 10px',
          cursor: translationActive || translationConnecting ? 'not-allowed' : 'pointer',
          opacity: translationActive || translationConnecting ? 0.55 : 1,
        }}
        title="Translation model"
      >
        {TRANSLATION_MODEL_OPTIONS.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <select
        value={translationTargetLanguage}
        onChange={(e) => onTranslationLanguageChange(e.target.value)}
        disabled={translationActive || translationConnecting}
        style={{
          ...baseSideBtn,
          padding: '8px 10px',
          cursor: translationActive || translationConnecting ? 'not-allowed' : 'pointer',
          opacity: translationActive || translationConnecting ? 0.55 : 1,
        }}
        title="Translation target language"
      >
        {TRANSLATION_LANGUAGE_OPTIONS.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <select
        value={translationVoice}
        onChange={(e) => onTranslationVoiceChange(e.target.value)}
        disabled={translationActive || translationConnecting || translationModel !== 'gpt-realtime-2'}
        style={{
          ...baseSideBtn,
          padding: '8px 10px',
          cursor: translationActive || translationConnecting || translationModel !== 'gpt-realtime-2' ? 'not-allowed' : 'pointer',
          opacity: translationActive || translationConnecting || translationModel !== 'gpt-realtime-2' ? 0.55 : 1,
        }}
        title={translationModel === 'gpt-realtime-2' ? 'Translation voice' : 'Voice selection is supported on Realtime 2 only (OpenAI translations API does not accept a voice)'}
      >
        {TRANSLATION_VOICE_OPTIONS.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <select
        value={translationTone}
        onChange={(e) => onTranslationToneChange(e.target.value)}
        disabled={translationActive || translationConnecting || translationModel !== 'gpt-realtime-2'}
        style={{
          ...baseSideBtn,
          padding: '8px 10px',
          cursor: translationActive || translationConnecting || translationModel !== 'gpt-realtime-2' ? 'not-allowed' : 'pointer',
          opacity: translationActive || translationConnecting || translationModel !== 'gpt-realtime-2' ? 0.55 : 1,
        }}
        title={translationModel === 'gpt-realtime-2' ? 'Translation tone' : 'Tone control is supported on Realtime 2 only'}
      >
        {TRANSLATION_TONE_OPTIONS.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
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
