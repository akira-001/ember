// src/staged-delivery.ts
import type { IntentionalPauseConfig } from './event-sources/types';

export type TopicWeight = 'light' | 'medium' | 'heavy';

export interface StagedMessage {
  premise: string | null;
  waitMs: number;
  main: string;
}

export function buildStagedMessages(
  message: string,
  topicWeight: TopicWeight,
  config: IntentionalPauseConfig,
): StagedMessage {
  if (!config.enabled) {
    return { premise: null, waitMs: 0, main: message };
  }

  const premiseText = config.premiseTexts[topicWeight];
  if (!premiseText) {
    return { premise: null, waitMs: 0, main: message };
  }

  return {
    premise: premiseText,
    waitMs: config.waitSeconds[topicWeight] * 1000,
    main: message,
  };
}
