/**
 * EventBus — central hub for the event-driven proactive messaging system.
 *
 * All EventSources emit ProactiveEvent objects through this bus.
 * ProactiveAgent (and others) subscribe to handle them.
 */

import { Logger } from './logger';
import type { EventSource, EventSourceStatus, ProactiveEvent } from './event-sources/types';

export type EventHandler = (event: ProactiveEvent) => void;

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export class EventBus {
  private sources = new Map<string, EventSource>();
  private listeners = new Map<string, Set<EventHandler>>();
  /** dedupKey -> timestamp (epoch ms) of last accepted event */
  private dedupCache = new Map<string, number>();
  private logger = new Logger('EventBus');

  // ---------- Source management ----------

  registerSource(source: EventSource): void {
    if (this.sources.has(source.name)) {
      throw new Error(`EventSource "${source.name}" is already registered`);
    }
    this.sources.set(source.name, source);
    this.logger.info(`Registered source: ${source.name}`);
  }

  removeSource(name: string): void {
    this.sources.delete(name);
    this.logger.info(`Removed source: ${name}`);
  }

  getSource(name: string): EventSource | undefined {
    return this.sources.get(name);
  }

  getSourceStatuses(): Record<string, EventSourceStatus> {
    const result: Record<string, EventSourceStatus> = {};
    for (const [name, source] of this.sources) {
      result[name] = source.getStatus();
    }
    return result;
  }

  // ---------- Pub/Sub ----------

  /**
   * Subscribe to events of a given type. Use "*" for all events.
   * Returns an unsubscribe function.
   */
  on(type: string, handler: EventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);

    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  /**
   * Emit a ProactiveEvent. Applies deduplication using dedupKey.
   */
  emit(event: ProactiveEvent): boolean {
    // Dedup check (dedupKey is always present)
    const now = Date.now();
    const lastSeen = this.dedupCache.get(event.dedupKey);
    if (lastSeen !== undefined && now - lastSeen < DEDUP_WINDOW_MS) {
      this.logger.debug(`Dedup suppressed: ${event.dedupKey}`);
      return false;
    }
    this.dedupCache.set(event.dedupKey, now);
    this.pruneDedup(now);

    // Deliver to type-specific listeners
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      for (const handler of typeListeners) {
        try {
          handler(event);
        } catch (err) {
          this.logger.error(`Handler error for event type "${event.type}"`, err);
        }
      }
    }

    // Deliver to wildcard listeners
    const wildcardListeners = this.listeners.get('*');
    if (wildcardListeners) {
      for (const handler of wildcardListeners) {
        try {
          handler(event);
        } catch (err) {
          this.logger.error(`Wildcard handler error`, err);
        }
      }
    }

    return true;
  }

  // ---------- Lifecycle ----------

  async startAll(): Promise<void> {
    const promises = Array.from(this.sources.values())
      .filter((source) => source.enabled)
      .map(async (source) => {
        try {
          await source.start();
          this.logger.info(`Started source: ${source.name}`);
        } catch (err) {
          this.logger.error(`Failed to start source: ${source.name}`, err);
        }
      });
    await Promise.all(promises);
  }

  async stopAll(): Promise<void> {
    const promises = Array.from(this.sources.values()).map(async (source) => {
      try {
        await source.stop();
        this.logger.info(`Stopped source: ${source.name}`);
      } catch (err) {
        this.logger.error(`Failed to stop source: ${source.name}`, err);
      }
    });
    await Promise.all(promises);
  }

  // ---------- Internal ----------

  private pruneDedup(now: number): void {
    for (const [key, ts] of this.dedupCache) {
      if (now - ts >= DEDUP_WINDOW_MS) {
        this.dedupCache.delete(key);
      }
    }
  }
}
