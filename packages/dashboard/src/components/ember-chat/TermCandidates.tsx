import { useState, type CSSProperties } from 'react';

const API_BASE = '/whisper/api';

export interface TermCandidate {
  canonical: string;
  variants: string[];
  type?: string;
}

interface TermCandidatesProps {
  candidates: TermCandidate[];
}

type ChipState = 'idle' | 'pending' | 'added' | 'dismissed';

const containerStyle: CSSProperties = {
  background: 'rgba(249, 115, 22, 0.06)',
  border: '1px solid rgba(249, 115, 22, 0.25)',
  borderRadius: 10,
  padding: '10px 12px',
  margin: '4px 0',
  fontSize: 12,
  color: 'var(--ember-text-muted)',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 8,
  color: 'var(--ember-text)',
  fontWeight: 600,
};

const skipStyle: CSSProperties = {
  marginLeft: 'auto',
  fontSize: 11,
  background: 'transparent',
  border: 'none',
  color: 'var(--ember-text-dim)',
  cursor: 'pointer',
  padding: '4px 8px',
};

const listStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

function chipStyle(state: ChipState): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--ember-surface-alt)',
    border: '1px solid var(--ember-border)',
    borderRadius: 14,
    padding: '4px 10px',
    cursor: state === 'idle' ? 'pointer' : 'default',
    transition: 'background 0.15s, border-color 0.15s, opacity 0.2s',
  };
  if (state === 'added') {
    return {
      ...base,
      opacity: 0.5,
      background: 'rgba(34, 197, 94, 0.10)',
      borderColor: 'rgba(34, 197, 94, 0.5)',
      color: '#bbf7d0',
    };
  }
  if (state === 'dismissed') {
    return { ...base, opacity: 0.3 };
  }
  return base;
}

export default function TermCandidates({ candidates }: TermCandidatesProps) {
  const [states, setStates] = useState<Record<number, ChipState>>(() =>
    Object.fromEntries(candidates.map((_, i) => [i, 'idle' as ChipState]))
  );

  const setState = (idx: number, next: ChipState) =>
    setStates((prev) => ({ ...prev, [idx]: next }));

  const handleAdd = async (idx: number, cand: TermCandidate) => {
    if (states[idx] !== 'idle') return;
    setState(idx, 'pending');
    try {
      const resp = await fetch(`${API_BASE}/transcribe/user-dict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canonical: cand.canonical,
          variants: cand.variants,
          type: cand.type,
        }),
      });
      const r = await resp.json();
      if (r.ok) {
        setState(idx, 'added');
      } else {
        setState(idx, 'idle');
        alert(`追加失敗: ${r.error || 'unknown'}`);
      }
    } catch (err) {
      setState(idx, 'idle');
      alert(`追加失敗: ${err}`);
    }
  };

  const handleSkipAll = () => {
    setStates((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        const idx = Number(k);
        if (next[idx] === 'idle') next[idx] = 'dismissed';
      }
      return next;
    });
  };

  if (!candidates || candidates.length === 0) return null;

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <span>新語候補（{candidates.length}件） — タップで辞書追加</span>
        <button type="button" onClick={handleSkipAll} style={skipStyle}>
          全部スキップ
        </button>
      </div>
      <div style={listStyle}>
        {candidates.map((cand, idx) => {
          const state = states[idx] ?? 'idle';
          const variantsText = cand.variants.slice(0, 2).join(', ');
          const more = cand.variants.length > 2 ? '…' : '';
          return (
            <span
              key={`${cand.canonical}-${idx}`}
              style={chipStyle(state)}
              title={`${cand.type ?? ''} | variants: ${cand.variants.join(', ')}`}
              onClick={() => handleAdd(idx, cand)}
            >
              <span style={{ fontWeight: 600 }}>
                {state === 'added' ? `✓ ${cand.canonical}` : `+ ${cand.canonical}`}
              </span>
              <span style={{ fontSize: 10, opacity: 0.65 }}>
                [{variantsText}{more}]
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
