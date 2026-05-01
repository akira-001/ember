import { describe, it, expect } from 'vitest';
import { sanitizeAssistantText, isDuplicateFinalMessage } from '../message-sanitizer';

describe('sanitizeAssistantText', () => {
  it('DM では API キー系エラーを自然な謝罪に置き換える', () => {
    expect(sanitizeAssistantText('Invalid API key · Fix external API key', true)).toBe(
      'ごめんね、うまく処理できなかったみたい。もう一度試してもらえるかな？',
    );
  });

  it('チャンネルでは API キー系エラーを簡潔な注意文に置き換える', () => {
    expect(sanitizeAssistantText('Invalid API key · Fix external API key', false)).toBe(
      '⚠️ うまく処理できなかったみたい。もう一度試してね。',
    );
  });

  it('通常の本文はそのまま返す', () => {
    expect(sanitizeAssistantText('映画のURLはこちらだよ', true)).toBe('映画のURLはこちらだよ');
  });

  it('改行や余分な空白があっても同じ本文なら重複扱いにする', () => {
    expect(
      isDuplicateFinalMessage(
        'ね、Akiraさん。\n\n記事が出てたよ。',
        'ね、Akiraさん。 記事が出てたよ。',
      ),
    ).toBe(true);
  });
});
