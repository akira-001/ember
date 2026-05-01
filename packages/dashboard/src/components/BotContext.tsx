import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface BotSummary {
  id: string;
  name: string;
  enabled: boolean;
  models: { chat: string; cron: string };
  personality: { type: string; motif: string };
}

interface BotContextType {
  activeBotId: string;
  setActiveBotId: (id: string) => void;
  bots: BotSummary[];
  loading: boolean;
  refreshBots: () => Promise<void>;
}

const BotContext = createContext<BotContextType | null>(null);

export function useBotContext() {
  const ctx = useContext(BotContext);
  if (!ctx) throw new Error('useBotContext must be used within BotContextProvider');
  return ctx;
}

export function BotContextProvider({ children }: { children: ReactNode }) {
  const [activeBotId, setActiveBotId] = useState(() => localStorage.getItem('activeBotId') || '');
  const [bots, setBots] = useState<BotSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshBots = async () => {
    try {
      const res = await fetch('/api/bots');
      const data = await res.json();
      setBots(data);
      // Auto-select first bot if no active bot
      if (!activeBotId && data.length > 0) {
        setActiveBotId(data[0].id);
      }
    } catch (e) {
      console.error('Failed to load bots:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshBots();
  }, []);

  useEffect(() => {
    if (activeBotId) {
      localStorage.setItem('activeBotId', activeBotId);
    }
  }, [activeBotId]);

  return (
    <BotContext.Provider value={{ activeBotId, setActiveBotId, bots, loading, refreshBots }}>
      {children}
    </BotContext.Provider>
  );
}
