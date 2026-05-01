import { useState } from 'react';
import { useI18n } from '../i18n';
import type { ProfileLayer } from '../types';
import FieldRow from './FieldRow';

interface Props {
  layerKey: string;
  layer: ProfileLayer;
  onRefresh: () => void;
}

const LAYER_NAMES: Record<string, { ja: string; en: string }> = {
  identity: { ja: 'アイデンティティ', en: 'Identity' },
  vision: { ja: 'ビジョン', en: 'Vision' },
  strategy: { ja: '戦略', en: 'Strategy' },
  execution: { ja: '実行', en: 'Execution' },
  state: { ja: '状態', en: 'State' },
};

export default function LayerCard({ layerKey, layer, onRefresh }: Props) {
  const { lang } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const pct = Math.round(layer.completionRate * 100);
  const label = LAYER_NAMES[layerKey]?.[lang] || layerKey;
  const fieldEntries = Object.entries(layer.fields || {});

  return (
    <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-[var(--bg)] transition-colors"
      >
        <span className="text-sm font-semibold text-[var(--text)] w-32 shrink-0">{label}</span>
        <div className="flex-1 h-2 bg-[var(--bg)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              backgroundColor: pct >= 80 ? 'var(--success)' : pct >= 40 ? 'var(--warning)' : 'var(--accent)',
            }}
          />
        </div>
        <span className="text-sm font-medium text-[var(--text-dim)] w-12 text-right">{pct}%</span>
        <span className="text-[var(--text-dim)] text-xs w-4 text-center">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)]">
          {fieldEntries.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[var(--text-dim)]">No fields defined</p>
          ) : (
            fieldEntries.map(([key, field]) => (
              <FieldRow
                key={key}
                layer={layerKey}
                fieldKey={key}
                field={field}
                onSaved={onRefresh}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
