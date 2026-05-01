import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Scheduler } from '../scheduler';

function createMockApp() {
  return {
    client: {
      chat: {
        postMessage: vi.fn(async () => ({ ok: true, ts: 'mock' })),
      },
    },
  };
}

const HISTORY = join(process.cwd(), 'data', 'cron-history.jsonl');

describe('Scheduler.executeJob disabledIfApiSays', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('skips job when API returns matching expectedValue', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ enabled: false }),
    } as any));

    const app = createMockApp() as any;
    const scheduler = new Scheduler(app, {} as any);

    const job = {
      name: 'test-api-skip',
      cron: '0 0 * * *',
      tz: 'Asia/Tokyo',
      message: '',
      command: 'echo SHOULD_NOT_RUN',
      slackTarget: 'CTEST',
      timeoutSeconds: 10,
      enabled: true,
      botId: 'mei',
      disabledIfApiSays: {
        url: 'http://localhost:8767/api/improve_loop/state',
        expectedKey: 'enabled',
        expectedValue: false,
      },
    };
    (scheduler as any).jobs = [job];

    const before = existsSync(HISTORY) ? readFileSync(HISTORY, 'utf-8') : '';
    await scheduler.runNow('test-api-skip');
    const after = existsSync(HISTORY) ? readFileSync(HISTORY, 'utf-8') : '';

    const newLines = after.slice(before.length).trim().split('\n').filter(Boolean);
    const skipped = newLines.find((l) => {
      try { return JSON.parse(l).status === 'skipped' && JSON.parse(l).jobName === 'test-api-skip'; }
      catch { return false; }
    });

    expect(skipped).toBeDefined();
  });

  it('runs job when API returns non-matching value', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ enabled: true }),
    } as any));

    const app = createMockApp() as any;
    const scheduler = new Scheduler(app, {} as any);

    const job = {
      name: 'test-api-run',
      cron: '0 0 * * *',
      tz: 'Asia/Tokyo',
      message: '',
      command: 'echo PLAIN',
      slackTarget: 'CTEST',
      timeoutSeconds: 10,
      enabled: true,
      botId: 'mei',
      disabledIfApiSays: {
        url: 'http://localhost:8767/api/improve_loop/state',
        expectedKey: 'enabled',
        expectedValue: false,
      },
    };
    (scheduler as any).jobs = [job];

    const before = existsSync(HISTORY) ? readFileSync(HISTORY, 'utf-8') : '';
    await scheduler.runNow('test-api-run');
    const after = existsSync(HISTORY) ? readFileSync(HISTORY, 'utf-8') : '';

    const newLines = after.slice(before.length).trim().split('\n').filter(Boolean);
    const entry = newLines.find((l) => {
      try { return JSON.parse(l).jobName === 'test-api-run'; }
      catch { return false; }
    });
    expect(entry).toBeDefined();
    const parsed = JSON.parse(entry!);
    expect(parsed.status).not.toBe('skipped');
  });

  it('runs job (fail-open) when API is unreachable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('connection refused');
    });

    const app = createMockApp() as any;
    const scheduler = new Scheduler(app, {} as any);

    const job = {
      name: 'test-api-fail-open',
      cron: '0 0 * * *',
      tz: 'Asia/Tokyo',
      message: '',
      command: 'echo PLAIN',
      slackTarget: 'CTEST',
      timeoutSeconds: 10,
      enabled: true,
      botId: 'mei',
      disabledIfApiSays: {
        url: 'http://localhost:8767/api/improve_loop/state',
        expectedKey: 'enabled',
        expectedValue: false,
      },
    };
    (scheduler as any).jobs = [job];

    const before = existsSync(HISTORY) ? readFileSync(HISTORY, 'utf-8') : '';
    await scheduler.runNow('test-api-fail-open');
    const after = existsSync(HISTORY) ? readFileSync(HISTORY, 'utf-8') : '';

    const newLines = after.slice(before.length).trim().split('\n').filter(Boolean);
    const entry = newLines.find((l) => {
      try { return JSON.parse(l).jobName === 'test-api-fail-open'; }
      catch { return false; }
    });
    expect(entry).toBeDefined();
    const parsed = JSON.parse(entry!);
    expect(parsed.status).not.toBe('skipped');
  });
});
