import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer } from 'recharts';

interface Props {
  completions: Record<string, number>;
}

const LAYER_LABELS: Record<string, string> = {
  identity: 'Identity',
  vision: 'Vision',
  strategy: 'Strategy',
  execution: 'Execution',
  state: 'State',
};

export default function ProfileRadarChart({ completions }: Props) {
  const data = Object.entries(LAYER_LABELS).map(([key, label]) => ({
    layer: label,
    value: Math.round((completions[key] || 0) * 100),
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart data={data}>
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis dataKey="layer" tick={{ fill: 'var(--text)', fontSize: 12 }} />
        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: 'var(--text-dim)', fontSize: 10 }} />
        <Radar name="Completion" dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.3} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
