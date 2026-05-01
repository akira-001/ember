// Simple event emitter for global config changes
type Listener = () => void;
const listeners = new Set<Listener>();

export const globalConfigEvents = {
  emit: () => listeners.forEach((fn) => fn()),
  subscribe: (fn: Listener) => { listeners.add(fn); return () => listeners.delete(fn); },
};
