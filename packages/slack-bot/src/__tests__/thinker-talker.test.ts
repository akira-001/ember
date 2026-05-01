import { describe, it, expect } from 'vitest';
import { resolveMessage } from '../proactive-state';
import type { ProactiveState } from '../proactive-state';

function makeState(): ProactiveState {
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
  } as any;
}

describe('Thinker/Talker pre-check', () => {
  it('thinker no_reply skips talker call', () => {
    const noReplyJson = '{"premise":{"estimatedMode":"没頭モード","modeReason":"会議中","targetLayer":5,"layerReason":"","interventionType":"沈黙","interventionReason":"","reason":""},"decision":"no_reply","need":"","reason":"会議中","candidates":[],"message":null}';
    const result = resolveMessage(noReplyJson, makeState(), 'mei');
    expect(result.action).toBe('skip');
  });

  it('thinker send decision triggers talker', () => {
    const sendJson = '{"premise":{"estimatedMode":"探索モード・高エネルギー","modeReason":"休日","targetLayer":4,"layerReason":"趣味の話題","interventionType":"情報提供","interventionReason":"ドジャースの情報","reason":"休日で時間がある"},"decision":"send","need":"充実","reason":"ドジャースの試合","candidates":[{"topic":"ドジャース","source":"interest","score":0.8}],"message":"ねえねえ。\\n\\nドジャース勝ったよ！"}';
    const result = resolveMessage(sendJson, makeState(), 'mei');
    expect(result.action).toBe('send');
    expect(result.message).toContain('ドジャース');
  });

  it('HEARTBEAT_OK from thinker is recognized as skip', () => {
    const result = resolveMessage('HEARTBEAT_OK', makeState(), 'mei');
    expect(result.action).toBe('skip');
    expect(result.heartbeatOk).toBe(true);
  });

  it('expanded emotion mode is preserved in decision log', () => {
    const sendJson = '{"premise":{"estimatedMode":"探索モード・高エネルギー","modeReason":"休日で活動的","targetLayer":4,"layerReason":"趣味","interventionType":"情報提供","interventionReason":"新情報あり","reason":"休日"},"decision":"send","need":"充実","reason":"試合結果","candidates":[{"topic":"test","source":"rss","score":0.9}],"message":"テストメッセージ"}';
    const result = resolveMessage(sendJson, makeState(), 'mei');
    expect(result.decisionLog?.premise?.estimatedMode).toBe('探索モード・高エネルギー');
  });
});
