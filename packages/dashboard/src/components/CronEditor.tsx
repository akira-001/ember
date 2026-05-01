import { parseCron, serializeCron, describeCron, toggleInArray, ALL_HOURS, ALL_DAYS, type CronFields } from './cronUtils';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

interface CronEditorProps {
  value: string;
  onChange: (cron: string) => void;
  className?: string;
}

export default function CronEditor({ value, onChange, className }: CronEditorProps) {
  const fields = parseCron(value);

  const update = (patch: Partial<CronFields>) => {
    onChange(serializeCron({ ...fields, ...patch }));
  };

  const hourSelected = (h: number) =>
    fields.hours.length === 0 || fields.hours.includes(h);

  const dowSelected = (d: number) =>
    fields.daysOfWeek.length === 0 || fields.daysOfWeek.includes(d);

  return (
    <div className={className}>
      {/* Row 1: Day of week + Minute */}
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[var(--text-dim)] mr-1 shrink-0">曜日</span>
          {DOW_LABELS.map((label, i) => (
            <button
              key={i}
              onClick={() => update({ daysOfWeek: toggleInArray(fields.daysOfWeek, i, ALL_DAYS) })}
              className={`w-8 h-8 rounded-full text-xs font-medium transition-colors ${
                dowSelected(i)
                  ? 'bg-[var(--accent)] text-[#ffffff]'
                  : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-[var(--text-dim)]">分</span>
          <input
            type="number"
            min={0}
            max={59}
            value={fields.minute}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v)) update({ minute: Math.min(59, Math.max(0, v)) });
            }}
            className="w-14 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1 text-sm text-center text-[var(--text)] font-mono tabular-nums focus:outline-none focus:border-[var(--accent)]"
          />
        </div>
      </div>

      {/* Row 2-3: Hour grid (12 x 2) */}
      <div className="text-xs text-[var(--text-dim)] mb-1.5">時間帯</div>
      <div className="grid grid-cols-12 gap-1.5 mb-3">
        {Array.from({ length: 24 }, (_, h) => (
          <button
            key={h}
            onClick={() => update({ hours: toggleInArray(fields.hours, h, ALL_HOURS) })}
            className={`h-9 rounded-full text-xs font-medium transition-colors ${
              hourSelected(h)
                ? 'bg-[var(--accent)] text-[#ffffff]'
                : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]'
            }`}
          >
            {h}
          </button>
        ))}
      </div>

      {/* Footer: cron preview + description */}
      <div className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
        <span className="font-mono">{value}</span>
        <span>—</span>
        <span>{describeCron(fields)}</span>
      </div>
    </div>
  );
}
