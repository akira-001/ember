import type { App } from '@slack/bolt';
import type { ProactiveEvent } from './event-sources/types';

/**
 * Common interface for both ProactiveAgent and SkillEnhancedProactiveAgent
 */
export interface IProactiveAgent {
  getStatePath(): string;
  getInsightsPath(): string;
  getSystemPrompt(): string;
  run(): Promise<void>;
  handleEvent?(event: ProactiveEvent): Promise<void>;
  handleReaction(emoji: string, messageTs: string, channel: string): Promise<void>;
  isProactiveMessage(messageTs: string): boolean;
  recordReply?(preview: string): void;
}