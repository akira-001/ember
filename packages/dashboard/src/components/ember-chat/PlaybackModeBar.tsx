import type { CSSProperties } from 'react';

const containerStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--ember-text-dim)',
  textAlign: 'center',
  padding: 3,
  background: 'var(--ember-surface-alt)',
  borderBottom: '1px solid var(--ember-border)',
};

export default function PlaybackModeBar() {
  return (
    <div style={containerStyle}>
      Audio: <span style={{ color: 'var(--ember-success)' }}>WebAudio (browser)</span>
    </div>
  );
}
