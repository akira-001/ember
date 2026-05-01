import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const ISSUER = 'https://auth.openai.com';
const USERCODE_URL = `${ISSUER}/api/accounts/deviceauth/usercode`;
const POLL_URL = `${ISSUER}/api/accounts/deviceauth/token`;
const TOKEN_URL = `${ISSUER}/oauth/token`;
const VERIFICATION_URL = `${ISSUER}/codex/device`;
const REDIRECT_URI = `${ISSUER}/deviceauth/callback`;
export const AUTH_FILE = join(process.cwd(), 'data/chatgpt-auth.json');
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5分前にリフレッシュ

interface ChatGPTAuthData {
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO 8601
}

function readAuthData(): ChatGPTAuthData {
  const raw = readFileSync(AUTH_FILE, 'utf-8');
  return JSON.parse(raw) as ChatGPTAuthData;
}

function saveAuthData(data: ChatGPTAuthData): void {
  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function isExpiringSoon(expiresAt: string): boolean {
  const expiryMs = new Date(expiresAt).getTime();
  return expiryMs - Date.now() <= REFRESH_MARGIN_MS;
}

async function refreshTokens(refreshToken: string): Promise<ChatGPTAuthData> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OAUTH_CLIENT_ID,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Token refresh failed: ${JSON.stringify(err)}`);
  }

  const json = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const newData: ChatGPTAuthData = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };

  saveAuthData(newData);
  return newData;
}

export async function getAccessToken(): Promise<string> {
  if (!existsSync(AUTH_FILE)) {
    throw new Error('ChatGPT auth required. Run: npm run auth:chatgpt');
  }

  const data = readAuthData();

  if (isExpiringSoon(data.expires_at)) {
    const refreshed = await refreshTokens(data.refresh_token);
    return refreshed.access_token;
  }

  return data.access_token;
}

export async function isAuthenticated(): Promise<boolean> {
  if (!existsSync(AUTH_FILE)) {
    return false;
  }

  try {
    const data = readAuthData();
    if (!isExpiringSoon(data.expires_at)) {
      return true;
    }
    await refreshTokens(data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

export async function login(): Promise<void> {
  // Step 1: デバイスコードを取得
  const usercodeRes = await fetch(USERCODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: OAUTH_CLIENT_ID }),
  });

  if (!usercodeRes.ok) {
    throw new Error(`Failed to get device code: ${usercodeRes.status}`);
  }

  const { user_code, device_auth_id, interval } = await usercodeRes.json() as {
    user_code: string;
    device_auth_id: string;
    interval: number;
  };

  // Chrome でブラウザを自動起動
  const { exec } = await import('child_process');
  exec(`open -a "Google Chrome" "${VERIFICATION_URL}"`);

  console.log(`
ChatGPT ログイン認証
ブラウザ（Chrome）で ${VERIFICATION_URL} を開きました。
以下のコードを入力してください: ${user_code}
認証待機中...
`);

  // Step 2: ポーリング（認証完了まで繰り返す）
  // POST /api/accounts/deviceauth/token に JSON { device_auth_id, user_code } を送る
  // 200 → authorization_code + code_verifier を受け取る
  // 403/404 → まだ未完了、継続
  let pollInterval = Math.max(Number(interval) || 5, 3);
  const deadline = Date.now() + 15 * 60 * 1000; // 15分

  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, pollInterval * 1000));

    const pollRes = await fetch(POLL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_auth_id, user_code }),
    });

    if (pollRes.status === 403 || pollRes.status === 404) {
      // まだユーザーが認証していない
      continue;
    }

    if (!pollRes.ok) {
      const err = await pollRes.json().catch(() => ({}));
      throw new Error(`Auth poll failed (${pollRes.status}): ${JSON.stringify(err)}`);
    }

    // Step 3: authorization_code → アクセストークン交換
    const { authorization_code, code_verifier } = await pollRes.json() as {
      authorization_code: string;
      code_verifier: string;
    };

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorization_code,
      redirect_uri: REDIRECT_URI,
      client_id: OAUTH_CLIENT_ID,
      code_verifier,
    });

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      throw new Error(`Token exchange failed: ${JSON.stringify(err)}`);
    }

    const json = await tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    saveAuthData({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
    });

    console.log('認証完了！トークンを保存しました。');
    return;
  }

  throw new Error('Login timeout: 15分以内に認証が完了しませんでした');
}
