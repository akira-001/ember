import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('queryWithFallback', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.resetModules(); });

  it('SDK が正常なら SDK のメッセージをそのまま yield する', async () => {
    const fakeSDKMessages = [
      { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-4-6', tools: [] },
      { type: 'assistant', subtype: 'text', text: 'from claude', message: {} },
      { type: 'result', subtype: 'success', result: 'from claude', total_cost_usd: 0.001, duration_ms: 500 },
    ];

    vi.doMock('@anthropic-ai/claude-code', () => ({
      query: vi.fn().mockImplementation(async function* () {
        for (const m of fakeSDKMessages) yield m;
      }),
    }));
    vi.doMock('../chatgpt-codex', () => ({
      queryChatGPT: vi.fn(),
    }));

    const { queryWithFallback } = await import('../openai-fallback');
    const messages: any[] = [];
    for await (const msg of queryWithFallback({ prompt: 'hi', options: {} })) {
      messages.push(msg);
    }
    expect(messages).toEqual(fakeSDKMessages);
  });

  it('SDK がエラーを throw したら ChatGPT Codex にフォールバックする', async () => {
    vi.doMock('@anthropic-ai/claude-code', () => ({
      query: vi.fn().mockImplementation(async function* () {
        throw new Error('API quota exceeded');
        yield; // unreachable
      }),
    }));

    vi.doMock('../chatgpt-codex', () => ({
      queryChatGPT: vi.fn().mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'cgpt-1', model: 'gpt-5.4-mini', tools: [] };
        yield { type: 'assistant', subtype: 'text', text: 'fallback text', message: { content: [] } };
        yield { type: 'result', subtype: 'success', result: 'fallback text', total_cost_usd: 0, duration_ms: 100 };
      }),
    }));

    const { queryWithFallback } = await import('../openai-fallback');
    const messages: any[] = [];
    for await (const msg of queryWithFallback({ prompt: 'hi', options: {} })) {
      messages.push(msg);
    }

    const result = messages[messages.length - 1];
    expect(result.type).toBe('result');
    expect(result.result).toBe('fallback text');
  });

  it('abort 済みの場合はフォールバックせずに throw する', async () => {
    const abortController = new AbortController();
    abortController.abort();

    vi.doMock('@anthropic-ai/claude-code', () => ({
      query: vi.fn().mockImplementation(async function* () {
        throw new Error('aborted');
        yield;
      }),
    }));
    vi.doMock('../chatgpt-codex', () => ({
      queryChatGPT: vi.fn(), // 呼ばれないはず
    }));

    const { queryWithFallback } = await import('../openai-fallback');
    await expect(async () => {
      for await (const _ of queryWithFallback({ prompt: 'hi', options: { abortController } })) {}
    }).rejects.toThrow('aborted');
  });
});
