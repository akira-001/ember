/**
 * 回帰テスト: プロアクティブの内部 decision-log JSON が丸ごと Slack に投稿される不具合の防止。
 *
 * 症状(修正前): Slack に premise/inner_thought/plan/generate_score/decision を含む生JSONが投稿される。
 *   投稿テキストは "json\n{...}" で始まる（```json フェンスや "json" プレフィックスの痕跡）。
 *
 * 根本原因:
 *  1) parseDecisionLog が失敗して decisionLog=null（message 内の \n エスケープ忘れ等で JSON が壊れる）
 *  2) extractMessage の P4 ガードが trimmed.startsWith('{') のみ判定 → "json" 始まりがすり抜け
 *  3) P3 が response 全体を message として返し、生JSONが Slack 投稿されていた
 *
 * 修正:
 *  - extractMessage: 内部キー（decision/generate_score 等）を含む応答は parse 失敗時も投稿しない
 *  - parseDecisionLog: 先頭フェンス/"json" プレフィックスを剥がして {...} に正規化
 */
import { describe, it, expect } from 'vitest';
import { resolveMessage, extractMessage, parseDecisionLog, createDefaultState, type ProactiveState } from '../proactive-state';

function makeState(overrides: Partial<ProactiveState> = {}): ProactiveState {
  return { ...createDefaultState(), ...overrides };
}

// message 文字列内に「生の改行」を入れて JSON を壊す（LLM が \n のエスケープを忘れる典型ミス）
const MALFORMED_INNER = `{
  "premise": { "estimatedMode": "達成モード", "targetLayer": 4 },
  "inner_thought": "朝の余白に記事を渡したい",
  "plan": ["記事を渡す", "沈黙して待ち"],
  "generate_score": [0.78, 0.62],
  "evaluate_score": 0.75,
  "decision": "send",
  "message": "そういえばさ、Akiraさん。
Gizmodoに記事が出てたよ"
}`;

describe('内部 decision-log JSON の Slack 漏洩を防止', () => {
  it('A. "json" プレフィックス + 壊れたJSON → 投稿しない（skip / message=null）', () => {
    const response = 'json\n' + MALFORMED_INNER;
    const result = resolveMessage(response, makeState({ allowNoReply: true }), 'eve');
    expect(result.action).toBe('skip');
    expect(result.message).toBeNull();
  });

  it('B. "{" 始まりの壊れたJSON → 従来どおり投稿しない', () => {
    const result = resolveMessage(MALFORMED_INNER, makeState({ allowNoReply: true }), 'eve');
    expect(result.message).toBeNull();
  });

  it('C. well-formed なら "json" プレフィックス付きでも message だけ抽出する', () => {
    const wellFormed = 'json\n' + JSON.stringify({
      decision: 'send', need: '', reason: '', candidates: [],
      message: 'これは本文だけ',
    });
    const result = resolveMessage(wellFormed, makeState({ allowNoReply: true }), 'eve');
    expect(result.action).toBe('send');
    expect(result.message).toBe('これは本文だけ');
  });

  it('D. extractMessage 単体: decisionLog=null + 内部キーを含む生テキスト → null', () => {
    const raw = 'json\n{"decision":"send","generate_score":[0.78]}';
    expect(extractMessage(raw, null)).toBeNull();
  });

  it('E. ```json フェンス付きの完全な decision-log → 本文だけ抽出（内部キーは出さない）', () => {
    const fenced = '```json\n' + JSON.stringify({
      premise: { estimatedMode: '達成モード' },
      inner_thought: '渡したい',
      generate_score: [0.78],
      evaluate_score: 0.75,
      decision: 'send', need: '', reason: '', candidates: [],
      message: '本文のみが出る',
    }) + '\n```';
    const result = resolveMessage(fenced, makeState({ allowNoReply: true }), 'eve');
    expect(result.action).toBe('send');
    expect(result.message).toBe('本文のみが出る');
    expect(result.message).not.toContain('generate_score');
    expect(result.message).not.toContain('inner_thought');
  });

  it('F. parseDecisionLog: "json" プレフィックス付き well-formed を正しくパースできる', () => {
    const log = parseDecisionLog('json\n' + JSON.stringify({
      decision: 'send', need: '', reason: '', candidates: [], message: 'ok',
    }));
    expect(log).not.toBeNull();
    expect(log?.decision).toBe('send');
    expect(log?.message).toBe('ok');
  });

  it('G. 通常のプレーンテキスト（内部キーなし）は従来どおり送信できる', () => {
    const result = resolveMessage('普通の挨拶メッセージだよ', makeState({ allowNoReply: true }), 'eve');
    expect(result.action).toBe('send');
    expect(result.message).toBe('普通の挨拶メッセージだよ');
  });
});
