import { useState } from 'react';
import { updateProfileField } from '../api';
import { useI18n } from '../i18n';
import type { ProfileFieldMeta } from '../types';

interface Props {
  layer: string;
  fieldKey: string;
  field: ProfileFieldMeta;
  onSaved: () => void;
}

const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'bg-green-500/20 text-green-400 border-green-500/30',
  medium: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  low: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  hypothesis: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

function formatFieldLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export default function FieldRow({ layer, fieldKey, field, onSaved }: Props) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    value: field.value ?? '',
    confidence: field.confidence ?? 'low',
    source: field.source ?? 'manual',
    evidence: field.evidence ?? '',
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfileField(layer, fieldKey, {
        value: draft.value || null,
        confidence: draft.confidence as ProfileFieldMeta['confidence'],
        source: draft.source as ProfileFieldMeta['source'],
        evidence: draft.evidence || null,
      });
      setEditing(false);
      onSaved();
    } catch (e) {
      console.error('Failed to save field', e);
    } finally {
      setSaving(false);
    }
  };

  const hasValue = field.value !== null && field.value !== undefined && field.value !== '';

  return (
    <div className="border-b border-[var(--border)] last:border-b-0 py-3 px-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-[var(--text)]">{formatFieldLabel(fieldKey)}</span>
            {field.confidence && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${CONFIDENCE_STYLES[field.confidence] || CONFIDENCE_STYLES.hypothesis}`}>
                {t(`profile.confidence.${field.confidence}` as any)}
              </span>
            )}
          </div>
          {hasValue ? (
            <p className="text-sm text-[var(--text)] opacity-80">{String(field.value)}</p>
          ) : (
            <p className="text-sm text-[var(--text-dim)] italic">
              {t('profile.uncollected' as any)}
              {field.example && (
                <span className="ml-1 text-[var(--text-dim)] opacity-60">
                  ({t('profile.example' as any)}: {field.example})
                </span>
              )}
            </p>
          )}
          {(field.source || field.collectedAt) && (
            <p className="text-[10px] text-[var(--text-dim)] mt-0.5">
              {field.source && <span>{field.source}</span>}
              {field.collectedAt && <span className="ml-2">{new Date(field.collectedAt).toLocaleDateString('ja-JP')}</span>}
            </p>
          )}
        </div>
        <button
          onClick={() => setEditing(!editing)}
          className="text-xs px-2 py-1 rounded border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-dim)] transition-colors shrink-0"
        >
          {editing ? '✕' : '✎'}
        </button>
      </div>

      {editing && (
        <div className="mt-3 space-y-2 bg-[var(--bg)] rounded-lg p-3">
          <div>
            <label className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">Value</label>
            <textarea
              value={draft.value}
              onChange={e => setDraft({ ...draft, value: e.target.value })}
              rows={2}
              className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">Confidence</label>
              <select
                value={draft.confidence}
                onChange={e => setDraft({ ...draft, confidence: e.target.value as typeof draft.confidence })}
                className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="high">{t('profile.confidence.high' as any)}</option>
                <option value="medium">{t('profile.confidence.medium' as any)}</option>
                <option value="low">{t('profile.confidence.low' as any)}</option>
                <option value="hypothesis">{t('profile.confidence.hypothesis' as any)}</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">Source</label>
              <select
                value={draft.source}
                onChange={e => setDraft({ ...draft, source: e.target.value as typeof draft.source })}
                className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="conversation">conversation</option>
                <option value="observation">observation</option>
                <option value="manual">manual</option>
                <option value="inferred">inferred</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">Evidence</label>
            <input
              type="text"
              value={draft.evidence}
              onChange={e => setDraft({ ...draft, evidence: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 text-sm rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? '...' : t('common.save' as any)}
          </button>
        </div>
      )}
    </div>
  );
}
