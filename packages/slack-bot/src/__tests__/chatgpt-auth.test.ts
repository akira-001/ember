import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'fs';

// login() は child_process.exec で Chrome を開くので、テストでは必ずモックする
vi.mock('child_process', () => ({ exec: vi.fn() }));

describe('getAccessToken', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.resetModules(); });

  it('AUTH_FILE が存在しない場合は Error を throw する', async () => {
    // data/chatgpt-auth.json が存在しない状態を作る
    if (existsSync('data/chatgpt-auth.json')) {
      // 既存環境はスキップ
      return;
    }
    const { getAccessToken } = await import('../chatgpt-auth');
    await expect(getAccessToken()).rejects.toThrow('auth:chatgpt');
  });

  it('有効なトークンがあればそのまま返す', async () => {
    mkdirSync('data', { recursive: true });
    const futureExpiry = new Date(Date.now() + 3600 * 1000).toISOString();
    writeFileSync('data/chatgpt-auth.json', JSON.stringify({
      access_token: 'valid-token-xyz',
      refresh_token: 'refresh-token',
      expires_at: futureExpiry,
    }));

    const { getAccessToken } = await import('../chatgpt-auth');
    const token = await getAccessToken();
    expect(token).toBe('valid-token-xyz');
  });

  it('期限切れトークンはリフレッシュして返す', async () => {
    mkdirSync('data', { recursive: true });
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    writeFileSync('data/chatgpt-auth.json', JSON.stringify({
      access_token: 'old-token',
      refresh_token: 'my-refresh-token',
      expires_at: pastExpiry,
    }));

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      }),
    } as any);

    const { getAccessToken } = await import('../chatgpt-auth');
    const token = await getAccessToken();
    expect(token).toBe('new-token');
  });
});

describe('isAuthenticated', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.resetModules(); });

  it('AUTH_FILE が存在しない場合は false を返す', async () => {
    if (existsSync('data/chatgpt-auth.json')) return; // 既存環境スキップ
    const { isAuthenticated } = await import('../chatgpt-auth');
    expect(await isAuthenticated()).toBe(false);
  });

  it('有効なトークンがある場合は true を返す', async () => {
    const { writeFileSync, mkdirSync } = await import('fs');
    mkdirSync('data', { recursive: true });
    const futureExpiry = new Date(Date.now() + 3600 * 1000).toISOString();
    writeFileSync('data/chatgpt-auth.json', JSON.stringify({
      access_token: 'valid-token',
      refresh_token: 'refresh-token',
      expires_at: futureExpiry,
    }));
    const { isAuthenticated } = await import('../chatgpt-auth');
    expect(await isAuthenticated()).toBe(true);
  });

  it('リフレッシュに失敗した場合は false を返す', async () => {
    const { writeFileSync, mkdirSync } = await import('fs');
    mkdirSync('data', { recursive: true });
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    writeFileSync('data/chatgpt-auth.json', JSON.stringify({
      access_token: 'old-token',
      refresh_token: 'bad-refresh-token',
      expires_at: pastExpiry,
    }));
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));
    const { isAuthenticated } = await import('../chatgpt-auth');
    expect(await isAuthenticated()).toBe(false);
  });
});

describe('login', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.resetModules(); });

  it('device code フローで認証してトークンを保存する', async () => {
    const { mkdirSync, existsSync, unlinkSync } = await import('fs');
    mkdirSync('data', { recursive: true });
    if (existsSync('data/chatgpt-auth.json')) unlinkSync('data/chatgpt-auth.json');

    global.fetch = vi.fn()
      // 1回目: usercode 取得
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user_code: 'TEST-1234', device_auth_id: 'dev-abc', interval: 1 }),
      } as any)
      // 2回目: ポーリング → authorization_code を返す
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ authorization_code: 'auth-code-xyz', code_verifier: 'verifier-xyz' }),
      } as any)
      // 3回目: authorization_code → access_token 交換
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        }),
      } as any);

    // console.log をモック（出力を抑制）
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { login } = await import('../chatgpt-auth');
    await login();

    consoleSpy.mockRestore();

    const { existsSync: exists, readFileSync } = await import('fs');
    expect(exists('data/chatgpt-auth.json')).toBe(true);
    const saved = JSON.parse(readFileSync('data/chatgpt-auth.json', 'utf-8'));
    expect(saved.access_token).toBe('new-access-token');
  });
});
