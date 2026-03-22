# 引き継ぎ: ARM64移行作業

## 現在の状況

Node.js と Claude Code がすべて x86_64（Intel版）でインストールされていた問題を修正中。
Node.js 24.14.0 は ARM64 に再インストール済み。Claude Code はまだ x86_64 のまま。

## 完了済み

- [x] Node.js 24.14.0 を ARM64 で再インストール (`nodenv install 24.14.0 --force`)
- [x] グローバルnpmパッケージは保持されている（pm2, openclaw等）
- [x] Slack Bot のスケジューラ移行完了（26ジョブ、テスト済み）
- [x] `~/.zshrc` に `alias claude="/Users/akira/.local/bin/claude"` 追加済み

## 残りの作業

### Step 1: VSCode の Rosetta 設定を解除
1. VSCode を完全に閉じる（Cmd+Q）
2. Finder で `/Applications/Visual Studio Code.app` を右クリック → 「情報を見る」
3. 「Rosettaを使用して開く」にチェックが入っていたら**外す**
4. VSCode を再起動

### Step 2: アーキテクチャ確認
ターミナルで以下を実行:
```bash
uname -m
# → arm64 になっていればOK
# → x86_64 のままなら anyenv/nodenv の初期化が原因の可能性あり
```

### Step 3: Claude Code を ARM64 で再インストール
```bash
curl -fsSL https://claude.ai/install.sh | sh
```

### Step 4: 確認
```bash
file ~/.local/share/claude/versions/*
# → arm64 になっていればOK

claude --version
# → AVX警告が出なければ成功
```

### Step 5: Slack Bot を再起動
```bash
pm2 start npx --name "claude-slack-bot" -- tsx src/index.ts
pm2 save
```
※ 作業ディレクトリ: `/Users/akira/workspace/claude-code-slack-bot`

### Step 6: pm2 startup 再設定（必要な場合）
Node.js を再インストールしたので、startup 設定のパスが変わっている可能性あり:
```bash
pm2 unstartup
pm2 startup
# 表示されたコマンドを実行
pm2 save
```

## トラブルシューティング

### uname -m がまだ x86_64 の場合
VSCode の Rosetta 設定以外に原因がある。以下を確認:
```bash
# anyenv/nodenv がx86を強制していないか
file $(which node)
# → arm64 であるべき

# シェル初期化スクリプトに arch -x86_64 等がないか
grep -r "arch.*x86\|rosetta" ~/.zshrc ~/.zprofile ~/.zshenv 2>/dev/null
```

### Slack Bot が起動しない場合
SDK バージョンの確認:
```bash
cd /Users/akira/workspace/claude-code-slack-bot
npm ls @anthropic-ai/claude-code
# → 1.0.128 であるべき
```

---

# 引き継ぎ: Slack Bot 残作業

## 完了済み

- [x] claude-code-slack-bot クローン・セットアップ
- [x] Slack App 作成・トークン設定（`.env`）
- [x] SDK v1.0.128 にダウングレード（v2.xはモジュール構造が非互換）
- [x] permission-mcp-server のパス修正（`src/claude-handler.ts:65`）
- [x] node-cron インストール・スケジューラモジュール作成（`src/scheduler.ts`）
- [x] OpenClaw の 26 ジョブを `cron-jobs.json` に変換
- [x] index.ts にスケジューラ統合
- [x] テストジョブで Slack DM 送信成功を確認（8秒で完了）
- [x] pm2 での常時起動・Mac再起動時の自動起動設定

## 残作業

### 1. MCP サーバー設定（優先度：高）
以下のジョブが MCP ツールに依存している:
- `tech-news-digest` → RSS MCP が必要（RSSフィード取得）
- `gmail-to-drive` → Gmail/Google Drive MCP が必要
- IR系ジョブ → Web検索（Brave Search MCP）が必要
- `campingcar-search-weekly` → Web検索が必要

**対応方法:**
```bash
cd /Users/akira/workspace/claude-code-slack-bot
cp mcp-servers.example.json mcp-servers.json
```
OpenClaw の MCP 設定を参考に設定:
- 参照: `/Users/akira/.openclaw/workspace/config/mcporter.json`

必要な MCP サーバー:
| MCP サーバー | 用途 | パッケージ |
|-------------|------|-----------|
| RSS | ニュース取得 | `rss-reader-mcp` |
| Brave Search | Web検索 | `@brave/brave-search-mcp-server` |
| Gmail | メール取得 | `@gongrzhe/server-gmail-autoauth-mcp` |
| Google Drive | ファイル保存 | `mcp-google-drive` |
| Google Calendar | 予定確認 | `@cocal/google-calendar-mcp` |

### 2. Python スクリプトのパス調整（優先度：中）
一部ジョブが OpenClaw 内のスクリプトを参照:
- `anthropic-daily-cost` → `~/.openclaw/workspace/scripts/anthropic_daily_cost.py`
- `gmail-to-drive` → `~/.openclaw/workspace/scripts/gmail_to_drive.py`
- `campingcar-search-weekly` → `~/.openclaw/workspace/campingcar/search_*.py`

選択肢:
- A) スクリプトをそのまま参照（OpenClawディレクトリに依存）
- B) スクリプトを claude-code-slack-bot にコピー
- C) cron-jobs.json の message を書き換えてスクリプトなしで実行

### 3. 一部ジョブの message 修正（優先度：低）
- `haru-nightly-reflection` → USER.md のパスが OpenClaw 前提
- `haru-morning-api-check` → api-usage.json のパスが OpenClaw 前提
- `haru-monthly-openclaw-check` → OpenClaw 自体のチェックなので不要かも

### 4. 動作確認（明朝以降）
最初に実行されるジョブ:
- 05:00 `anthropic-daily-cost` / `tech-news-digest`
- 07:00 `haru-morning-api-check`
- 23:00 `haru-nightly-reflection`

エラーが出たら `pm2 logs claude-slack-bot` で確認。

## Slack Bot 起動方法

```bash
cd /Users/akira/workspace/claude-code-slack-bot

# 開発モード（デバッグログ付き）
npm run dev

# pm2 で本番起動
pm2 start npx --name "claude-slack-bot" -- tsx src/index.ts
pm2 save

# ログ確認
pm2 logs claude-slack-bot

# 再起動
pm2 restart claude-slack-bot
```

## 参考: ファイル一覧

| ファイル | 内容 |
|---------|------|
| `/Users/akira/workspace/claude-code-slack-bot/.env` | Slack Bot の認証情報 |
| `/Users/akira/workspace/claude-code-slack-bot/cron-jobs.json` | 移行済み定期タスク26件 |
| `/Users/akira/workspace/claude-code-slack-bot/src/scheduler.ts` | スケジューラモジュール |
| `/Users/akira/workspace/claude-code-slack-bot/src/index.ts` | エントリポイント（スケジューラ統合済み） |
| `/Users/akira/workspace/claude-code-slack-bot/src/claude-handler.ts` | permission-mcp-serverパス修正済み |
| `/Users/akira/.openclaw/cron/jobs.json` | 元のOpenClaw定期タスク定義（参照用） |
| `/Users/akira/.openclaw/workspace/config/mcporter.json` | OpenClaw MCP設定（移行参考用） |
