import { describe, test, expect } from 'vitest';
import { resolveMessage, type ProactiveState } from '../proactive-state';

function makeMinimalState(): ProactiveState {
  return {
    categoryWeights: {
      email_reply: 1, meeting_prep: 1, deadline_risk: 1, slack_followup: 1,
      energy_break: 1, personal_event: 1, hobby_leisure: 1, flashback: 1,
    },
    cooldown: { until: null, consecutiveIgnores: 0, backoffMinutes: 30 },
    history: [],
    lastCheckAt: null,
    stats: { totalSent: 0, positiveReactions: 0, negativeReactions: 0 },
    todayMessages: [],
  };
}

describe('HEARTBEAT_OK protocol', () => {
  test('HEARTBEAT_OK at start of response triggers skip', () => {
    const result = resolveMessage('HEARTBEAT_OK\n特に報告なし', makeMinimalState(), 'mei');
    expect(result.action).toBe('skip');
    expect(result.heartbeatOk).toBe(true);
  });

  test('HEARTBEAT_OK at end of response triggers skip', () => {
    const result = resolveMessage('特に変化なし\nHEARTBEAT_OK', makeMinimalState(), 'mei');
    expect(result.action).toBe('skip');
    expect(result.heartbeatOk).toBe(true);
  });

  test('HEARTBEAT_OK in long response does not trigger (>300 chars)', () => {
    const longMsg = 'x'.repeat(301) + '\nHEARTBEAT_OK';
    const result = resolveMessage(longMsg, makeMinimalState(), 'mei');
    expect(result.heartbeatOk).toBeFalsy();
  });

  test('normal no_reply JSON still works', () => {
    const json = '{"premise":{"estimatedMode":"没頭モード","modeReason":"会議中","targetLayer":5,"layerReason":"","interventionType":"沈黙","interventionReason":"","reason":""},"decision":"no_reply","need":"","reason":"会議中","candidates":[],"message":null}';
    const result = resolveMessage(json, makeMinimalState(), 'mei');
    expect(result.action).toBe('skip');
  });
});
