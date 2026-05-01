#!/usr/bin/env tsx
/**
 * ChatGPT Codex フォールバック動作確認スクリプト
 * Usage: tsx scripts/test-chatgpt.ts <message>
 */
import { queryChatGPT } from '../src/chatgpt-codex';

async function main() {
  const message = process.argv.slice(2).join(' ');
  if (!message) {
    console.error('Usage: tsx scripts/test-chatgpt.ts <message>');
    process.exit(1);
  }

  console.log(`[ChatGPT Codex] → "${message}"\n`);

  let fullText = '';

  try {
    for await (const msg of queryChatGPT({ prompt: message, options: {} })) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        console.log(`model: ${msg.model}  session: ${msg.session_id}`);
        process.stdout.write('\n');
      } else if (msg.type === 'assistant' && msg.subtype === 'text') {
        process.stdout.write(msg.text);
        fullText += msg.text;
      } else if (msg.type === 'result' && msg.subtype === 'success') {
        process.stdout.write('\n\n');
        console.log(`duration: ${msg.duration_ms}ms`);
      }
    }
  } catch (err) {
    console.error('\nError:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
