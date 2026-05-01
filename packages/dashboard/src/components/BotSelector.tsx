import { useBotContext } from './BotContext';

export default function BotSelector() {
  const { activeBotId, setActiveBotId, bots } = useBotContext();

  if (bots.length === 0) return null;

  const activeBot = bots.find(b => b.id === activeBotId);

  return (
    <div className="p-4 border-b border-[var(--border)]">
      <div className="text-[10px] uppercase tracking-wider text-[var(--accent)] mb-2 font-medium">Active Bot</div>
      <select
        value={activeBotId}
        onChange={(e) => setActiveBotId(e.target.value)}
        className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] appearance-none cursor-pointer"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23705848' d='M3 4.5L6 8l3-3.5H3z'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
      >
        {bots.map((bot) => (
          <option key={bot.id} value={bot.id}>
            {bot.name}
          </option>
        ))}
      </select>
      {activeBot && (
        <p className="text-[10px] text-[var(--text-dim)] mt-1.5">{activeBot.models.chat}</p>
      )}
    </div>
  );
}
