import { useState, useCallback, type KeyboardEvent } from 'react';

interface Props {
  onSendText: (text: string) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  recording: boolean;
  processing: boolean;
  replyBot: string | null;
  lastBotId: string | null;
  onToggleReply: (botId: string | null) => void;
  onPlayBot: (botId: string) => void;
  ttsEnabled: boolean;
  onToggleTts: () => void;
  onToggleSettings: () => void;
  settingsExpanded: boolean;
  onOpenRecording: () => void;
}

export default function ChatInput({
  onSendText, onStartRecording, onStopRecording,
  recording, processing, replyBot, lastBotId,
  onToggleReply, onPlayBot, ttsEnabled, onToggleTts,
  onToggleSettings, settingsExpanded, onOpenRecording,
}: Props) {
  const [text, setText] = useState('');

  const handleSend = useCallback(() => {
    if (!text.trim() || processing) return;
    onSendText(text);
    setText('');
  }, [text, processing, onSendText]);

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleMic = useCallback(() => {
    if (processing) return;
    if (recording) {
      onStopRecording();
    } else {
      onStartRecording();
    }
  }, [recording, processing, onStartRecording, onStopRecording]);

  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      {/* Top row: Reply selector + Sound + Settings toggle */}
      <div className="flex items-center gap-2 mb-2 text-xs">
        <select
          value={replyBot || ''}
          onChange={(e) => onToggleReply(e.target.value || null)}
          className={`px-3 py-1 rounded-full border text-xs font-medium transition-colors cursor-pointer ${
            replyBot
              ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
              : 'border-[var(--border)] text-[var(--text-dim)] bg-transparent hover:border-[var(--text-dim)]'
          }`}
        >
          <option value="">Direct</option>
          <option value="mei">{replyBot === 'mei' ? 'Mei' : 'Reply: Mei'}</option>
          <option value="eve">{replyBot === 'eve' ? 'Eve' : 'Reply: Eve'}</option>
        </select>
        <button
          onClick={() => lastBotId && onPlayBot(lastBotId)}
          disabled={!lastBotId}
          className="px-3 py-1 rounded-full border border-[var(--border)] text-xs font-medium text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
        >
          Last Msg
        </button>
        <button
          onClick={onOpenRecording}
          className="px-3 py-1 rounded-full border border-[var(--accent)] text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
        >
          録音
        </button>
        <div className="flex-1" />
        <button
          onClick={onToggleTts}
          className={`px-3 py-1 rounded-full border text-xs font-medium transition-colors ${
            ttsEnabled
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-[var(--border)] text-[var(--text-dim)]'
          }`}
        >
          {ttsEnabled ? 'Sound ON' : 'Sound OFF'}
        </button>
        <button
          onClick={onToggleSettings}
          className={`px-3 py-1 rounded-full border text-xs font-medium transition-colors ${
            settingsExpanded
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--text-dim)]'
          }`}
        >
          Settings
        </button>
      </div>

      {/* Input row */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder={processing ? '処理中...' : replyBot ? `${replyBot} に返信...` : 'メッセージを入力...'}
          disabled={processing}
          className="flex-1 px-4 py-2.5 rounded-full bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50 transition-colors"
        />
        <button
          onClick={handleMic}
          disabled={processing}
          className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
            recording
              ? 'border-[var(--error)] bg-[var(--error)] text-white animate-pulse'
              : 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
          } disabled:opacity-40`}
          title={recording ? 'Stop recording' : 'Start recording'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/>
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
        </button>
        <button
          onClick={handleSend}
          disabled={processing || !text.trim()}
          className="w-10 h-10 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white flex items-center justify-center transition-colors disabled:opacity-40"
          title="Send"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
