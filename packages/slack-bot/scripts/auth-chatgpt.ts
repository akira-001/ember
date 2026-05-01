#!/usr/bin/env tsx
import { login, isAuthenticated } from '../src/chatgpt-auth';

async function main() {
  const alreadyAuth = await isAuthenticated();
  if (alreadyAuth) {
    console.log('既に認証済みです。トークンは有効です。');
    console.log('再認証する場合は data/chatgpt-auth.json を削除してください。');
    process.exit(0);
  }

  try {
    await login();
    console.log('\n✓ 認証完了。ChatGPT フォールバック推論が利用可能になりました。');
  } catch (err) {
    console.error('認証失敗:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
