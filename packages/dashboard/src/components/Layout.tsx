import { Outlet } from 'react-router-dom';
import { BotContextProvider, useBotContext } from './BotContext';
import { I18nProvider } from '../i18n';
import Sidebar from './Sidebar';

function LayoutInner() {
  const { activeBotId } = useBotContext();
  return (
    <div className="flex min-h-screen bg-[var(--bg)]" data-bot={activeBotId}>
      <Sidebar />
      <main className="md:ml-60 flex-1 p-4 pt-16 md:p-8 md:pt-8">
        <Outlet />
      </main>
    </div>
  );
}

export default function Layout() {
  return (
    <I18nProvider>
      <BotContextProvider>
        <LayoutInner />
      </BotContextProvider>
    </I18nProvider>
  );
}
