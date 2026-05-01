import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPersonalityTemplates, generatePrompt, createBot, restartBot, resolveIdentity } from '../api';
import { useBotContext } from '../components/BotContext';
import { useI18n } from '../i18n';
import type { PersonalityTemplate, BackgroundMotifTemplate } from '../types';

interface WizardData {
  id: string;
  name: string;
  slack: { botToken: string; appToken: string; signingSecret: string };
  personality: { type: string; motif: string; customPrompt: string | null; generatedPrompt: string | null };
  models: { chat: string; cron: string };
  proactive: { enabled: boolean; schedule: string; slackTarget: string; calendarExclusions: string[] };
}

const INITIAL_DATA: WizardData = {
  id: '',
  name: '',
  slack: { botToken: '', appToken: '', signingSecret: '' },
  personality: { type: '', motif: '', customPrompt: null, generatedPrompt: null },
  models: { chat: 'claude-sonnet-4-6', cron: 'claude-haiku-4-5' },
  proactive: { enabled: false, schedule: '0 9,11,14,17,20 * * 1-5', slackTarget: '', calendarExclusions: [] },
};

const STEP_KEYS = ['wizard.step.slackApp', 'wizard.step.credentials', 'wizard.step.personality', 'wizard.step.confirm'] as const;

const MODEL_OPTIONS = ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6'];

const REQUIRED_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'channels:read',
  'chat:write',
  'files:read',
  'files:write',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'reactions:read',
  'reactions:write',
  'users:read',
];

export default function BotWizard() {
  const navigate = useNavigate();
  const { refreshBots } = useBotContext();
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [types, setTypes] = useState<PersonalityTemplate[]>([]);
  const [motifs, setMotifs] = useState<BackgroundMotifTemplate[]>([]);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<{ botId: string; displayName: string } | null>(null);

  // Load personality templates
  useEffect(() => {
    getPersonalityTemplates().then((t) => {
      setTypes(t.types);
      setMotifs(t.motifs);
    }).catch(() => {});
  }, []);

  // Generate prompt preview when type + motif are selected
  const handleGeneratePrompt = useCallback(async (type: string, motif: string) => {
    if (!type || !motif || !data.name) return;
    setGeneratingPrompt(true);
    try {
      const result = await generatePrompt(data.name, type, motif);
      setData((prev) => ({
        ...prev,
        personality: { ...prev.personality, generatedPrompt: result.prompt },
      }));
    } catch {
      // ignore
    } finally {
      setGeneratingPrompt(false);
    }
  }, [data.name]);

  const updateData = (patch: Partial<WizardData>) => {
    setData((prev) => ({ ...prev, ...patch }));
  };

  // Auto-resolve identity when botToken is entered
  const handleBotTokenChange = async (token: string) => {
    updateData({ slack: { ...data.slack, botToken: token } });
    setResolved(null);
    setError('');

    if (token.startsWith('xoxb-') && token.length > 20) {
      setResolving(true);
      try {
        const result = await resolveIdentity(token);
        setResolved({ botId: result.botId, displayName: result.displayName });
        updateData({
          id: result.botId,
          name: result.displayName,
          slack: { ...data.slack, botToken: token },
        });
      } catch (e: any) {
        setResolved(null);
        setError(t('wizard.cred.tokenError'));
      } finally {
        setResolving(false);
      }
    }
  };

  const canNext = (): boolean => {
    if (step === 1) {
      return !!data.slack.botToken && !!resolved;
    }
    if (step === 2) {
      return !!data.personality.type && !!data.personality.motif;
    }
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await createBot({
        id: data.id,
        name: data.name,
        enabled: true,
        slack: data.slack,
        personality: data.personality,
        models: data.models,
        proactive: data.proactive,
      } as any);
      await restartBot();
      await refreshBots();
      navigate('/system/bots');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">{t('wizard.title')}</h2>

      {/* Step Indicator */}
      <div className="flex items-center mb-8">
        {STEP_KEYS.map((key, i) => (
          <div key={key} className="flex items-center flex-1">
            <div className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  i <= step
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--border)] text-[var(--text-dim)]'
                }`}
              >
                {i + 1}
              </div>
              <span
                className={`text-sm hidden sm:inline ${
                  i <= step ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'
                }`}
              >
                {t(key as any)}
              </span>
            </div>
            {i < STEP_KEYS.length - 1 && (
              <div
                className={`flex-1 h-px mx-3 ${
                  i < step ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-[var(--error)]/10 border border-[var(--error)] rounded-lg text-[var(--error)] text-sm">
          {error}
        </div>
      )}

      {/* Step 0: Slack App Guide */}
      {step === 0 && (
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-6">
          <h3 className="text-lg font-semibold text-[var(--text)] mb-4">{t('wizard.slack.title')}</h3>
          <ol className="list-decimal list-inside space-y-3 text-sm text-[var(--text)]">
            <li>
              <a
                href="https://api.slack.com/apps"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] hover:text-[var(--accent-light)] underline"
              >
                api.slack.com/apps
              </a>{' '}
              {t('wizard.slack.step1')}
            </li>
            <li>{t('wizard.slack.step2')}</li>
            <li>{t('wizard.slack.step3')}<code className="text-[var(--accent)]">connections:write</code>)</li>
            <li>{t('wizard.slack.step4')}
              <code className="block mt-1 text-[var(--accent)] text-xs">app_mention, message.channels, message.groups, message.im, message.mpim</code>
            </li>
            <li>{t('wizard.slack.step5')}</li>
          </ol>

          <pre className="mt-3 p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)] text-xs text-[var(--accent)] overflow-x-auto">
{REQUIRED_SCOPES.join('\n')}
          </pre>

          <ol className="list-decimal list-inside space-y-3 text-sm text-[var(--text)] mt-3" start={6}>
            <li>{t('wizard.slack.step6')}</li>
            <li>{t('wizard.slack.step7')} (<code className="text-[var(--accent)]">xoxb-...</code>, <code className="text-[var(--accent)]">xapp-...</code>)</li>
          </ol>
        </div>
      )}

      {/* Step 1: Credentials */}
      {step === 1 && (
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-6 space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text)] mb-2">{t('wizard.cred.title')}</h3>

          <div>
            <label className="block text-sm text-[var(--text-dim)] mb-1">{t('wizard.cred.botToken')}</label>
            <input
              type="password"
              value={data.slack.botToken}
              onChange={(e) => handleBotTokenChange(e.target.value)}
              placeholder="xoxb-..."
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
            {resolving && (
              <p className="text-xs text-[var(--accent)] mt-1">Resolving bot identity...</p>
            )}
            {resolved && (
              <p className="text-xs text-green-500 mt-1">
                Bot detected: {resolved.displayName} ({resolved.botId})
              </p>
            )}
          </div>

          {/* Auto-resolved fields (readonly) */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[var(--text-dim)] mb-1">Bot ID</label>
              <input
                type="text"
                value={data.id}
                readOnly
                placeholder={resolving ? 'Resolving...' : 'Auto-resolved from token'}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text-dim)] text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-[var(--text-dim)] mb-1">{t('wizard.cred.displayName')}</label>
              <input
                type="text"
                value={data.name}
                readOnly
                placeholder={resolving ? 'Resolving...' : 'Auto-resolved from token'}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text-dim)] text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-[var(--text-dim)] mb-1">{t('wizard.cred.appToken')}</label>
            <input
              type="password"
              value={data.slack.appToken}
              onChange={(e) =>
                updateData({ slack: { ...data.slack, appToken: e.target.value } })
              }
              placeholder="xapp-..."
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--text-dim)] mb-1">{t('wizard.cred.signingSecret')}</label>
            <input
              type="password"
              value={data.slack.signingSecret}
              onChange={(e) =>
                updateData({ slack: { ...data.slack, signingSecret: e.target.value } })
              }
              placeholder="..."
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>
      )}

      {/* Step 2: Personality */}
      {step === 2 && (
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-6 space-y-6">
          <h3 className="text-lg font-semibold text-[var(--text)] mb-2">{t('wizard.personality.title')}</h3>

          {/* Personality Types */}
          <div>
            <label className="block text-sm text-[var(--text-dim)] mb-2">{t('wizard.personality.type')}</label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {types.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    const newType = t.id;
                    setData((prev) => ({
                      ...prev,
                      personality: { ...prev.personality, type: newType },
                    }));
                    handleGeneratePrompt(newType, data.personality.motif);
                  }}
                  className={`p-2 rounded-lg border text-xs text-center transition-colors ${
                    data.personality.type === t.id
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text-dim)] hover:border-[var(--text-dim)]'
                  }`}
                >
                  <div className="font-medium">{t.label}</div>
                  <div className="text-[var(--text-dim)] mt-0.5">{t.labelEn}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Background Motifs */}
          <div>
            <label className="block text-sm text-[var(--text-dim)] mb-2">{t('wizard.personality.motif')}</label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {motifs.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    const newMotif = m.id;
                    setData((prev) => ({
                      ...prev,
                      personality: { ...prev.personality, motif: newMotif },
                    }));
                    handleGeneratePrompt(data.personality.type, newMotif);
                  }}
                  className={`p-2 rounded-lg border text-xs text-center transition-colors ${
                    data.personality.motif === m.id
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text-dim)] hover:border-[var(--text-dim)]'
                  }`}
                >
                  <div className="font-medium">{m.label}</div>
                  <div className="text-[var(--text-dim)] mt-0.5">{m.tag}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Model Selector */}
          <div>
            <label className="block text-sm text-[var(--text-dim)] mb-1">{t('wizard.personality.chatModel')}</label>
            <select
              value={data.models.chat}
              onChange={(e) => updateData({ models: { ...data.models, chat: e.target.value } })}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] text-sm focus:outline-none focus:border-[var(--accent)]"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Proactive Agent Toggle */}
          <div className="flex items-center gap-3">
            <button
              onClick={() =>
                updateData({ proactive: { ...data.proactive, enabled: !data.proactive.enabled } })
              }
              className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
              style={{
                backgroundColor: data.proactive.enabled ? 'var(--accent)' : 'var(--border)',
              }}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  data.proactive.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-sm text-[var(--text)]">{t('wizard.personality.proactive')}</span>
          </div>

          {/* Prompt Preview */}
          {(data.personality.type && data.personality.motif) && (
            <div>
              <label className="block text-sm text-[var(--text-dim)] mb-1">
                {t('wizard.personality.promptPreview')}
                {generatingPrompt && <span className="ml-2 text-xs text-[var(--accent)]">{t('wizard.personality.generating')}</span>}
              </label>
              <textarea
                readOnly
                value={data.personality.generatedPrompt || ''}
                rows={8}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] text-xs font-mono focus:outline-none resize-none"
              />
            </div>
          )}
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === 3 && (
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-6 space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text)] mb-2">{t('wizard.confirm.title')}</h3>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-[var(--text-dim)] mb-0.5">Bot ID</p>
              <p className="text-[var(--text)] font-mono">{data.id}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-dim)] mb-0.5">Display Name</p>
              <p className="text-[var(--text)]">{data.name}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-dim)] mb-0.5">Bot Token</p>
              <p className="text-[var(--text)] font-mono">{data.slack.botToken ? '********' : '(empty)'}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-dim)] mb-0.5">App Token</p>
              <p className="text-[var(--text)] font-mono">{data.slack.appToken ? '********' : '(empty)'}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-dim)] mb-0.5">Personality</p>
              <p className="text-[var(--text)]">{data.personality.type} / {data.personality.motif}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-dim)] mb-0.5">Chat Model</p>
              <p className="text-[var(--text)] font-mono">{data.models.chat}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-dim)] mb-0.5">Proactive Agent</p>
              <p className={data.proactive.enabled ? 'text-[var(--success)]' : 'text-[var(--text-dim)]'}>
                {data.proactive.enabled ? 'Enabled' : 'Disabled'}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-dim)] mb-0.5">Signing Secret</p>
              <p className="text-[var(--text)] font-mono">{data.slack.signingSecret ? '********' : '(empty)'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between mt-6">
        <div>
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="px-4 py-2 bg-[var(--border)] hover:bg-[var(--text-dim)] text-[var(--text)] text-sm font-medium rounded-lg transition-colors"
            >
              {t('wizard.nav.back')}
            </button>
          )}
        </div>
        <div>
          {step < STEP_KEYS.length - 1 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext()}
              className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--border)] disabled:text-[var(--text-dim)] text-white text-sm font-medium rounded-lg transition-colors"
            >
              {t('wizard.nav.next')}
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-5 py-2 bg-[var(--success)] hover:bg-[var(--success-hover)] disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {submitting ? t('wizard.nav.creating') : t('wizard.nav.create')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
