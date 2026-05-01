import { useEffect, useState } from 'react';
import { getProfile } from '../api';
import { useI18n } from '../i18n';
import type { UserProfile } from '../types';
import ProfileRadarChart from '../components/ProfileRadarChart';
import LayerCard from '../components/LayerCard';
import CollectionConfigPanel from '../components/CollectionConfigPanel';

const LAYER_ORDER = ['identity', 'vision', 'strategy', 'execution', 'state'] as const;

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-4">
      <div className="text-xs text-[var(--text-dim)] uppercase tracking-[0.05em] font-medium mb-1">{label}</div>
      <div className="text-xl font-bold text-[var(--text)]">{value}</div>
      {sub && <div className="text-xs text-[var(--text-dim)] mt-1">{sub}</div>}
    </div>
  );
}

export default function ProfilePage() {
  const { t } = useI18n();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState('');

  const fetchProfile = async () => {
    try {
      const data = await getProfile();
      setProfile(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load profile');
    }
  };

  useEffect(() => { fetchProfile(); }, []);

  if (error) {
    return (
      <div className="p-6">
        <div className="text-[var(--error)]">{t('common.error' as any)}: {error}</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-6">
        <div className="text-[var(--text-dim)]">{t('common.loading' as any)}</div>
      </div>
    );
  }

  const completions: Record<string, number> = {};
  let totalCompletion = 0;
  let lowestLayer = '';
  let lowestRate = 1;

  for (const key of LAYER_ORDER) {
    const rate = profile.layers[key]?.completionRate ?? 0;
    completions[key] = rate;
    totalCompletion += rate;
    if (rate < lowestRate) {
      lowestRate = rate;
      lowestLayer = key;
    }
  }
  const overallPct = Math.round((totalCompletion / LAYER_ORDER.length) * 100);

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-xl font-bold text-[var(--text)] mb-6">{t('profile.title' as any)}</h1>

      {/* Top: Radar + Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-4">
          <ProfileRadarChart completions={completions} />
        </div>
        <div className="grid grid-cols-2 gap-3 content-start">
          <StatCard
            label={t('profile.completionRate' as any)}
            value={`${overallPct}%`}
            sub={`${LAYER_ORDER.length} layers`}
          />
          <StatCard
            label={t('profile.priorityLayer' as any)}
            value={t(`layer.${lowestLayer}` as any)}
            sub={`${Math.round(lowestRate * 100)}%`}
          />
          <StatCard
            label="Last Updated"
            value={profile.lastUpdated ? new Date(profile.lastUpdated).toLocaleDateString('ja-JP') : '-'}
            sub={`v${profile.version}`}
          />
          <StatCard
            label={t('profile.nextQuestion' as any)}
            value={`${profile.collectionConfig.frequencyDays}d`}
            sub={`${profile.collectionConfig.choiceCount} choices`}
          />
        </div>
      </div>

      {/* Layer Cards */}
      <div className="space-y-3 mb-6">
        {LAYER_ORDER.map(key => (
          <LayerCard
            key={key}
            layerKey={key}
            layer={profile.layers[key]}
            onRefresh={fetchProfile}
          />
        ))}
      </div>

      {/* Collection Config */}
      <CollectionConfigPanel config={profile.collectionConfig} onSaved={fetchProfile} />
    </div>
  );
}
