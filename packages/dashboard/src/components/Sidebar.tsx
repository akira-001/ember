import { useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import BotSelector from './BotSelector';
import { useI18n } from '../i18n';
import type { Lang } from '../i18n';
import { globalConfigEvents } from '../globalConfigEvents';

interface NavItem {
  to: string;
  labelKey: string;
}

interface NavSection {
  titleKey: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    titleKey: 'sidebar.dashboard',
    items: [
      { to: '/', labelKey: 'sidebar.overview' },
      { to: '/activity', labelKey: 'sidebar.activity' },
    ],
  },
  {
    titleKey: 'sidebar.botSettings',
    items: [
      { to: '/bot/personality', labelKey: 'sidebar.personality' },
      { to: '/bot/models', labelKey: 'sidebar.models' },
      { to: '/bot/proactive', labelKey: 'sidebar.proactive' },
      { to: '/bot/support-log', labelKey: 'sidebar.supportLog' },
      { to: '/bot/cron-jobs', labelKey: 'sidebar.cronJobs' },
      { to: '/bot/mcp-servers', labelKey: 'sidebar.mcpServers' },
    ],
  },
  {
    titleKey: 'sidebar.knowledge',
    items: [
      { to: '/insights', labelKey: 'sidebar.insights' },
      { to: '/weights', labelKey: 'sidebar.weights' },
      { to: '/constants', labelKey: 'sidebar.constants' },
      { to: '/profile', labelKey: 'sidebar.profile' },
      { to: '/thought-trace', labelKey: 'sidebar.thoughtTrace' },
    ],
  },
  {
    titleKey: 'sidebar.tools',
    items: [
      { to: '/ember-chat', labelKey: 'sidebar.emberChat' },
      { to: '/voice-enroll', labelKey: 'sidebar.voiceEnroll' },
    ],
  },
  {
    titleKey: 'sidebar.system',
    items: [
      { to: '/system/bots', labelKey: 'sidebar.botManagement' },
      { to: '/system/stamps', labelKey: 'sidebar.stamps' },
      { to: '/system/local-models', labelKey: 'sidebar.localModels' },
      { to: '/system/global', labelKey: 'sidebar.globalConfig' },
    ],
  },
];

export default function Sidebar() {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [hiddenRoutes, setHiddenRoutes] = useState<Set<string>>(new Set());
  const location = useLocation();

  const fetchHiddenRoutes = useCallback(() => {
    fetch('/api/global')
      .then((r) => r.json())
      .then((data) => {
        const hidden = new Set<string>();
        if (data.emberChatStandalone) hidden.add('/ember-chat');
        setHiddenRoutes(hidden);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchHiddenRoutes(); }, [fetchHiddenRoutes]);
  useEffect(() => { globalConfigEvents.subscribe(fetchHiddenRoutes); }, [fetchHiddenRoutes]);

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed top-3 left-3 z-50 md:hidden w-10 h-10 flex items-center justify-center rounded-lg bg-[var(--sidebar-bg)] text-[var(--sidebar-text-active)] border border-[var(--sidebar-border)]"
        aria-label="Toggle menu"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? (
            <><line x1="4" y1="4" x2="16" y2="16"/><line x1="16" y1="4" x2="4" y2="16"/></>
          ) : (
            <><line x1="3" y1="5" x2="17" y2="5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="15" x2="17" y2="15"/></>
          )}
        </svg>
      </button>
      {/* Overlay */}
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpen(false)} />}
    <aside className={`fixed left-0 top-0 h-screen w-60 bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)] flex flex-col z-40 transition-transform md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
      <div className="px-5 py-4 border-b border-[var(--sidebar-border)] flex items-center gap-3">
        <img src="/logo.svg" alt="Ember" className="w-8 h-8" />
        <span className="text-sm font-semibold text-[var(--sidebar-text-active)]">Multi-Agent <span className="text-[var(--accent-light)]">Ember</span></span>
      </div>
      <BotSelector />
      <nav className="flex-1 py-2 overflow-y-auto">
        {sections.map((section) => {
          const visibleItems = section.items.filter((item) => !hiddenRoutes.has(item.to));
          if (visibleItems.length === 0) return null;
          return (
          <div key={section.titleKey} className="mb-1">
            <div className="px-5 py-2 text-[10px] uppercase tracking-wider text-[var(--text-dim)] font-medium">
              {t(section.titleKey as any)}
            </div>
            {visibleItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `block px-5 py-2.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-[var(--sidebar-active-bg)] text-[var(--sidebar-text-active)] border-l-2 border-[var(--sidebar-active-border)]'
                      : 'text-[var(--sidebar-text)] hover:text-[var(--sidebar-text-active)] hover:bg-[var(--sidebar-surface)] border-l-2 border-transparent'
                  }`
                }
              >
                {t(item.labelKey as any)}
              </NavLink>
            ))}
          </div>
          );
        })}
      </nav>
      <div className="p-4 border-t border-[var(--sidebar-border)] flex items-center justify-between">
        <span className="text-[10px] text-[var(--text-dim)]">{t('sidebar.footer')}</span>
        <button
          onClick={() => setLang(lang === 'ja' ? 'en' : 'ja')}
          className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--sidebar-border)] text-[var(--sidebar-text)] hover:text-[var(--sidebar-text-active)] hover:border-[var(--sidebar-text)] transition-colors"
        >
          {lang === 'ja' ? 'EN' : 'JA'}
        </button>
      </div>
    </aside>
    </>
  );
}
