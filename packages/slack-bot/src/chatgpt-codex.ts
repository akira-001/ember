import { getAccessToken } from './chatgpt-auth';
import type { SDKMessageCompat, QueryInput } from './openai-fallback';

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const DEFAULT_MODEL = 'gpt-5.4';

async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split('\n\n');
    // 最後の要素は不完全な可能性があるので残す
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      if (!block.trim()) continue;

      // event 行を確認
      const eventLine = block.split('\n').find(l => l.startsWith('event:'));
      const dataLine = block.split('\n').find(l => l.startsWith('data:'));

      if (!dataLine) continue;

      const jsonStr = dataLine.slice('data:'.length).trim();
      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        continue;
      }

      // response.completed は無視
      if (eventLine && eventLine.includes('response.completed')) continue;

      if (typeof parsed.delta === 'string') {
        yield parsed.delta;
      }
    }
  }
}

export async function* queryChatGPT(input: QueryInput): AsyncIterable<SDKMessageCompat> {
  const accessToken = await getAccessToken();
  const model = process.env.CHATGPT_FALLBACK_MODEL ?? DEFAULT_MODEL;
  const sessionId = `codex-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const requestBody = {
    model,
    instructions: input.options.appendSystemPrompt ?? '',
    input: [{ role: 'user', content: input.prompt }],
    store: false,
    stream: true,
  };

  const res = await fetch(CODEX_RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ChatGPT Codex API error (${res.status}): ${text}`);
  }

  yield {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    model,
    tools: [],
  };

  const startMs = Date.now();
  let fullText = '';

  if (!res.body) {
    throw new Error('ChatGPT Codex API: response body is null');
  }
  for await (const delta of parseSseStream(res.body)) {
    fullText += delta;
    yield {
      type: 'assistant',
      subtype: 'text',
      text: delta,
      message: { content: [] },
    };
  }

  yield {
    type: 'result',
    subtype: 'success',
    result: fullText,
    total_cost_usd: 0,
    duration_ms: Date.now() - startMs,
  };
}
