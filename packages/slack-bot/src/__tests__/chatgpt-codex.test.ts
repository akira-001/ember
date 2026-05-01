import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('queryChatGPT', () => {
  beforeEach(() => { vi.resetModules(); });

  it('system/init → assistant/text(delta) → result の順に yield する', async () => {
    const sseBody = [
      'event: response.output_text.delta\ndata: {"delta": "Hello"}\n\n',
      'event: response.output_text.delta\ndata: {"delta": ", world"}\n\n',
      'event: response.completed\ndata: {"response": {}}\n\n',
    ].join('');

    vi.doMock('../chatgpt-auth', () => ({
      getAccessToken: vi.fn().mockResolvedValue('test-token'),
    }));

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseBody));
          controller.close();
        },
      }),
    } as any);

    const { queryChatGPT } = await import('../chatgpt-codex');
    const messages: any[] = [];
    for await (const msg of queryChatGPT({ prompt: 'Hello', options: { appendSystemPrompt: 'You are helpful.' } })) {
      messages.push(msg);
    }

    expect(messages[0].type).toBe('system');
    expect(messages[0].subtype).toBe('init');

    const textMsgs = messages.filter((m: any) => m.type === 'assistant');
    expect(textMsgs).toHaveLength(2);
    expect(textMsgs[0].text).toBe('Hello');
    expect(textMsgs[1].text).toBe(', world');

    const result = messages[messages.length - 1];
    expect(result.type).toBe('result');
    expect(result.subtype).toBe('success');
    expect(result.result).toBe('Hello, world');
  });

  it('fetch が 401 を返した場合は Error を throw する', async () => {
    vi.doMock('../chatgpt-auth', () => ({
      getAccessToken: vi.fn().mockResolvedValue('test-token'),
    }));

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as any);

    const { queryChatGPT } = await import('../chatgpt-codex');
    await expect(async () => {
      for await (const _ of queryChatGPT({ prompt: 'Hello', options: {} })) {}
    }).rejects.toThrow('401');
  });

  it('リクエスト body に instructions・input・store・stream が正しく含まれる', async () => {
    vi.doMock('../chatgpt-auth', () => ({
      getAccessToken: vi.fn().mockResolvedValue('test-token'),
    }));

    let capturedBody: any;
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        body: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('event: response.completed\ndata: {"response": {}}\n\n'));
            c.close();
          },
        }),
      };
    });

    const { queryChatGPT } = await import('../chatgpt-codex');
    for await (const _ of queryChatGPT({ prompt: 'test prompt', options: { appendSystemPrompt: 'Be helpful.' } })) {}

    expect(capturedBody.instructions).toBe('Be helpful.');
    expect(capturedBody.input).toEqual([{ role: 'user', content: 'test prompt' }]);
    expect(capturedBody.store).toBe(false);
    expect(capturedBody.stream).toBe(true);
  });
});
