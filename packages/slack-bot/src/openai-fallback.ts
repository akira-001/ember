import { createLogger } from './logger';

const logger = createLogger('openai-fallback');

export type SDKMessageCompat =
  | { type: 'system'; subtype: 'init'; session_id: string; model: string; tools: any[] }
  | { type: 'assistant'; subtype: 'text'; text: string; message: { content?: any[] } }
  | { type: 'result'; subtype: 'success' | 'error'; result?: string; total_cost_usd?: number; duration_ms?: number };

export interface QueryInput {
  prompt: string;
  options: {
    model?: string;
    appendSystemPrompt?: string;
    [key: string]: any;
  };
}

export async function* queryWithFallback(input: QueryInput): AsyncIterable<SDKMessageCompat> {
  // バッファリング方式: mid-stream エラー時でも部分テキストが呼び出し元に渡らないよう、
  // SDK の全メッセージを収集してから yield する。
  // scheduler / proactive-agent はテキスト蓄積のみ（UIストリーミングなし）なので遅延許容。
  const buffer: SDKMessageCompat[] = [];
  let sdkError: Error | null = null;

  try {
    const { query } = await import('@anthropic-ai/claude-code');
    for await (const msg of query({
      prompt: input.prompt,
      options: input.options as any,
    })) {
      buffer.push(msg as SDKMessageCompat);
    }
  } catch (err) {
    sdkError = err instanceof Error ? err : new Error(String(err));
  }

  if (sdkError === null) {
    for (const msg of buffer) yield msg;
    return;
  }

  // abort（タイムアウト等）起因のエラーはフォールバックしない
  if (input.options.abortController?.signal.aborted) {
    throw sdkError;
  }

  // SDK エラー → ChatGPT Codex フォールバック
  logger.warn('Claude Code SDK failed, falling back to ChatGPT Codex', {
    error: sdkError.message,
  });

  const { queryChatGPT } = await import('./chatgpt-codex');
  for await (const msg of queryChatGPT(input)) {
    yield msg;
  }
}
