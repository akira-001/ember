import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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

function createMockMcp() {
  return {} as any;
}

const SENTINEL = join(tmpdir(), `scheduler-disabled-test-${process.pid}.flag`);
const HISTORY = join(process.cwd(), 'data', 'cron-history.jsonl');

describe('Scheduler.executeJob disabledIfFileExists', () => {
  beforeEach(() => {
    if (existsSync(SENTINEL)) unlinkSync(SENTINEL);
  });

  afterEach(() => {
    if (existsSync(SENTINEL)) unlinkSync(SENTINEL);
  });

  it('skips job when sentinel file exists and records skipped status', async () => {
    writeFileSync(SENTINEL, '');
    expect(existsSync(SENTINEL)).toBe(true);

    const app = createMockApp() as any;
    const scheduler = new Scheduler(app, createMockMcp());

    const job = {
      name: 'test-skip-job',
      cron: '0 0 * * *',
      tz: 'Asia/Tokyo',
      message: 'should-not-run',
      command: 'echo SHOULD_NOT_RUN',
      slackTarget: 'CTEST',
      timeoutSeconds: 10,
      enabled: true,
      botId: 'mei',
      disabledIfFileExists: SENTINEL,
    };

    (scheduler as any).jobs = [job];

    const before = existsSync(HISTORY) ? readFileSync(HISTORY, 'utf-8') : '';
    await scheduler.runNow('test-skip-job');
    const after = existsSync(HISTORY) ? readFileSync(HISTORY, 'utf-8') : '';

    const newLines = after.slice(before.length).trim().split('\n').filter(Boolean);
    const skipped = newLines.find((l) => {
      try {
        const e = JSON.parse(l);
        return e.jobName === 'test-skip-job' && e.status === 'skipped';
      } catch {
        return false;
      }
    });

    expect(skipped).toBeDefined();
    expect(app.client.chat.postMessage).not.toHaveBeenCalled();
  });

  it('runs job normally when sentinel file does not exist', async () => {
    expect(existsSync(SENTINEL)).toBe(false);

    const app = createMockApp() as any;
    const scheduler = new Scheduler(app, createMockMcp());

    const job = {
      name: 'test-run-job',
      cron: '0 0 * * *',
      tz: 'Asia/Tokyo',
      message: '',
      command: 'echo RAN',
      slackTarget: 'CTEST',
      timeoutSeconds: 10,
      enabled: true,
      botId: 'mei',
      disabledIfFileExists: SENTINEL,
    };

    (scheduler as any).jobs = [job];

    const before = existsSync(HISTORY) ? readFileSync(HISTORY, 'utf-8') : '';
    await scheduler.runNow('test-run-job');
    const after = existsSync(HISTORY) ? readFileSync(HISTORY, 'utf-8') : '';

    const newLines = after.slice(before.length).trim().split('\n').filter(Boolean);
    const entry = newLines.find((l) => {
      try {
        const e = JSON.parse(l);
        return e.jobName === 'test-run-job';
      } catch {
        return false;
      }
    });

    expect(entry).toBeDefined();
    const parsed = JSON.parse(entry!);
    expect(parsed.status).not.toBe('skipped');
  });

  it('runs job when disabledIfFileExists is not set', async () => {
    const app = createMockApp() as any;
    const scheduler = new Scheduler(app, createMockMcp());

    const job = {
      name: 'test-no-sentinel',
      cron: '0 0 * * *',
      tz: 'Asia/Tokyo',
      message: '',
      command: 'echo PLAIN',
      slackTarget: 'CTEST',
      timeoutSeconds: 10,
      enabled: true,
      botId: 'mei',
    };

    (scheduler as any).jobs = [job];

    const before = existsSync(HISTORY) ? readFileSync(HISTORY, 'utf-8') : '';
    await scheduler.runNow('test-no-sentinel');
    const after = existsSync(HISTORY) ? readFileSync(HISTORY, 'utf-8') : '';

    const newLines = after.slice(before.length).trim().split('\n').filter(Boolean);
    const entry = newLines.find((l) => {
      try {
        const e = JSON.parse(l);
        return e.jobName === 'test-no-sentinel';
      } catch {
        return false;
      }
    });

    expect(entry).toBeDefined();
    const parsed = JSON.parse(entry!);
    expect(parsed.status).not.toBe('skipped');
  });
});
