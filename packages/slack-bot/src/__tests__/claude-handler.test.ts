import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ClaudeHandler', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('streamQuery uses the fallback pipeline and yields SDK-compatible messages', async () => {
    vi.doMock('../openai-fallback', () => ({
      queryWithFallback: vi.fn().mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-4-6', tools: [] };
        yield { type: 'assistant', subtype: 'text', text: 'fallback hello', message: { content: [] } };
        yield { type: 'result', subtype: 'success', result: 'fallback hello', total_cost_usd: 0, duration_ms: 42 };
      }),
    }));

    const { ClaudeHandler } = await import('../claude-handler');
    const handler = new ClaudeHandler({
      getServerConfiguration: () => null,
      getDefaultAllowedTools: () => [],
    } as any);

    const messages: any[] = [];
    for await (const msg of handler.streamQuery('hello')) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ type: 'system', subtype: 'init' });
    expect(messages[1]).toMatchObject({ type: 'assistant', subtype: 'text', text: 'fallback hello' });
    expect(messages[2]).toMatchObject({ type: 'result', subtype: 'success', result: 'fallback hello' });
  });
});
