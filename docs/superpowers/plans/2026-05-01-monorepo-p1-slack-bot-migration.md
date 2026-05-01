# P1 Monorepo Migration — Slack Bot & Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `claude-code-slack-bot` の TypeScript ソース・dashboard・cron-jobs.json・scripts を `ember/packages/{slack-bot, dashboard}/` に移植し、pm2 プロセスを新パスから起動できる状態にする。

**Architecture:**
- `packages/slack-bot/` — TypeScript bot コア (`src/`)、設定ファイル、scripts/ を収容。`process.cwd()` ベースのパス解決はそのまま維持し、pm2 の `exec cwd` を新パスに変更するだけで動く。
- `packages/dashboard/` — React + Vite + Express server (`dashboard/`) を収容。dashboard server は slack-bot の `src/openai-fallback.ts` を cross-package import しているため、monorepo 内 workspace 依存 (`@ember/slack-bot`) に変更する。
- `data/` と `memory/` (cogmem) は **P1 では旧パスのまま残し、symlink + 環境変数で繋ぐ**（案B）。State 権威統一は P4 でデファー。
- pm2 切り替えは stop → cwd 変更 → start の最短停止手順で実施し、rollback は旧パスで即 start できるよう明記する。

**Tech Stack:** Node.js 24 (nodenv/ARM64)、pnpm 9、TypeScript 5.8、vitest 4、React 19 + Vite 6 + Express 5、pm2

---

## 前提確認事項（作業開始前に必読）

### data/ と memory/ の扱い方針（案B を採用）

P1 では `data/` と `memory/` を旧リポ (`claude-code-slack-bot/data/`, `claude-code-slack-bot/memory/`) に残したまま、
新パッケージからは symlink で参照する。理由:

1. `cron-history.jsonl`、`*-state.json`、implicit-memory など runtime state が大量に存在し、移動中の bot 停止時間を最小化したい
2. `cogmem.toml` が旧リポを `logs_dir = "data/memory/logs"` で参照しており、P4 の State 集約時に一括で移行する方が安全
3. symlink なら rollback が即座（symlink 削除だけ）

> **Akiraさん確認ポイント:** `data/` と `memory/` を P4 まで旧パスに置くことに同意すれば上記方針で進む。P1 で移動したい場合は Task 2 の symlink 手順を「rsync して旧パスに symlink を逆方向に貼る」に変更する。

### .env の扱い

旧 `.env` を新パスへ **ファイルコピー**（symlink 不使用）。理由: pm2 が `exec cwd` 配下の `.env` を dotenv で読むため、新 cwd に実ファイルが必要。git には commit しない（`.gitignore` で除外）。

### dashboard の cross-package import

`dashboard/server/api.ts` が `../../src/openai-fallback` を相対 import している。monorepo 移植後は以下に変更:

```typescript
// 変更前
import { queryWithFallback } from '../../src/openai-fallback';

// 変更後
import { queryWithFallback } from '@ember/slack-bot/openai-fallback';
```

これには `packages/slack-bot/package.json` に `exports` フィールドを追加し、`pnpm install` で workspace 依存を解決する必要がある。

---

## ファイル構造（移植後）

```
ember/
├── packages/
│   ├── slack-bot/                      # @ember/slack-bot
│   │   ├── package.json                # 既存を更新 (scripts/deps/exports 追加)
│   │   ├── tsconfig.json               # 旧 tsconfig.json から作成
│   │   ├── vitest.config.ts            # 旧 vitest.config.ts から作成
│   │   ├── .env                        # 旧 .env からコピー (git 除外)
│   │   ├── .env.example                # 旧 .env.example からコピー
│   │   ├── mcp-servers.json            # 旧からコピー + パス更新
│   │   ├── mcp-servers.example.json    # 旧からコピー
│   │   ├── cron-jobs.json              # 旧からコピー + 絶対パス更新
│   │   ├── CLAUDE.md                   # 旧からコピー
│   │   ├── cogmem.toml                 # 旧からコピー (data/ への相対パスなのでそのまま)
│   │   ├── src/                        # 旧 src/ を丸ごとコピー + ハードコードパス修正
│   │   │   ├── claude-handler.ts       # permission-mcp-server パス修正
│   │   │   ├── conversation-logger.ts  # COGMEM_PROJECT を env var 化
│   │   │   ├── memento-skills.ts       # COGMEM_CWD を env var 化
│   │   │   └── skill-enhanced-proactive-agent.ts  # COGMEM_CWD を env var 化
│   │   ├── tests/                      # 旧 tests/ を丸ごとコピー
│   │   ├── scripts/                    # 旧 scripts/ を丸ごとコピー + パス更新
│   │   └── data -> ../../../../claude-code-slack-bot/data  # symlink (P4 まで)
│   │   └── memory -> ../../../../claude-code-slack-bot/memory  # symlink (P4 まで)
│   │
│   └── dashboard/                      # @ember/dashboard
│       ├── package.json                # 既存を更新 (deps/scripts 追加)
│       ├── tsconfig.json               # 旧 dashboard/tsconfig.json からコピー
│       ├── vite.config.ts              # 旧からコピー
│       ├── tailwind.config.js          # 旧からコピー
│       ├── postcss.config.js           # 旧からコピー
│       ├── index.html                  # 旧からコピー
│       ├── src/                        # 旧 dashboard/src/ を丸ごとコピー
│       └── server/                     # 旧 dashboard/server/ をコピー + import 修正
│           ├── api.ts                  # cross-package import + open-claude パス修正
│           └── tsconfig.json           # 旧からコピー
```

---

## Phase 1: 事前確認 + コミット整理

### Task 1: 旧リポの未コミット差分を処理する

**Files:** なし（コミット操作のみ）

- [ ] **Step 1: 差分内容を確認する**

```bash
git -C /Users/akira/workspace/claude-code-slack-bot status --short
```

期待出力:
```
 M .claude/skills/energy-break.md
 M data/cron-history.jsonl
 M data/eve-heartbeat.json
 M data/eve-last-reflect.txt
 M data/eve-state.json
 M data/eve-voice-meta.json
 M data/eve/MEMORY.md
 M data/sessions-eve.json
 M data/shared-proactive-history.json
 M data/theme-inventory.json
```

`data/` 配下と `.claude/skills/` の runtime 変更のみ。`src/` や `dashboard/` に未コミット変更がないことを確認する。

- [ ] **Step 2: runtime state をコミットする**

```bash
git -C /Users/akira/workspace/claude-code-slack-bot add \
  data/cron-history.jsonl \
  data/eve-heartbeat.json \
  data/eve-last-reflect.txt \
  data/eve-state.json \
  data/eve-voice-meta.json \
  "data/eve/MEMORY.md" \
  data/sessions-eve.json \
  data/shared-proactive-history.json \
  data/theme-inventory.json \
  .claude/skills/energy-break.md
git -C /Users/akira/workspace/claude-code-slack-bot commit -m "chore: sync runtime state before P1 migration"
```

期待: `[main XXXXXXX] chore: sync runtime state before P1 migration`

- [ ] **Step 3: push する**

```bash
git -C /Users/akira/workspace/claude-code-slack-bot push
```

期待: `Everything up-to-date` or `main -> main`

---

## Phase 2: data/ と memory/ の symlink 準備

### Task 2: symlink を新パスに作成する

**Files:**
- Create: `packages/slack-bot/data` (symlink)
- Create: `packages/slack-bot/memory` (symlink)

- [ ] **Step 1: slack-bot ディレクトリが存在することを確認する**

```bash
ls /Users/akira/workspace/ember/packages/slack-bot/
```

期待: `package.json  README.md`

- [ ] **Step 2: data symlink を作成する**

```bash
ln -s /Users/akira/workspace/claude-code-slack-bot/data \
  /Users/akira/workspace/ember/packages/slack-bot/data
```

期待: エラーなし

- [ ] **Step 3: memory symlink を作成する**

```bash
ln -s /Users/akira/workspace/claude-code-slack-bot/memory \
  /Users/akira/workspace/ember/packages/slack-bot/memory
```

期待: エラーなし

- [ ] **Step 4: symlink が正しく張れているか確認する**

```bash
ls -la /Users/akira/workspace/ember/packages/slack-bot/
```

期待出力に以下が含まれること:
```
data -> /Users/akira/workspace/claude-code-slack-bot/data
memory -> /Users/akira/workspace/claude-code-slack-bot/memory
```

- [ ] **Step 5: symlink 経由でファイルが読めることを確認する**

```bash
ls /Users/akira/workspace/ember/packages/slack-bot/data/bot-configs.json
```

期待: ファイルが表示される

---

## Phase 3: packages/slack-bot のファイル移植

### Task 3: 設定ファイルをコピーする

**Files:**
- Create: `packages/slack-bot/tsconfig.json`
- Create: `packages/slack-bot/vitest.config.ts`
- Create: `packages/slack-bot/.env.example`
- Create: `packages/slack-bot/.env`
- Create: `packages/slack-bot/cogmem.toml`
- Create: `packages/slack-bot/mcp-servers.example.json`
- Create: `packages/slack-bot/CLAUDE.md`

- [ ] **Step 1: tsconfig.json をコピーする**

内容を `/Users/akira/workspace/ember/packages/slack-bot/tsconfig.json` として作成する:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "sourceMap": true,
    "strict": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 2: vitest.config.ts をコピーする**

`/Users/akira/workspace/ember/packages/slack-bot/vitest.config.ts` を作成する:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['dist/**', 'node_modules/**'],
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 4,        // CPU 18コアだが4に制限（暴走防止）
      },
    },
    testTimeout: 30_000,    // 1テスト30秒でタイムアウト
    hookTimeout: 10_000,    // beforeAll/afterAll 10秒
    teardownTimeout: 5_000, // クリーンアップ5秒
  },
});
```

- [ ] **Step 3: .env.example をコピーする**

```bash
cp /Users/akira/workspace/claude-code-slack-bot/.env.example \
   /Users/akira/workspace/ember/packages/slack-bot/.env.example
```

期待: エラーなし

- [ ] **Step 4: .env を新パスへコピーする（symlink ではなく実ファイル）**

```bash
cp /Users/akira/workspace/claude-code-slack-bot/.env \
   /Users/akira/workspace/ember/packages/slack-bot/.env
```

期待: エラーなし

- [ ] **Step 5: .env に COGMEM_PROJECT 環境変数を追記する**

`/Users/akira/workspace/ember/packages/slack-bot/.env` の末尾に以下を追記する:

```
# cogmem が参照するプロジェクトパス (P4 で ember/ に変更予定)
COGMEM_PROJECT=/Users/akira/workspace/ember
```

- [ ] **Step 6: cogmem.toml をコピーする**

```bash
cp /Users/akira/workspace/claude-code-slack-bot/cogmem.toml \
   /Users/akira/workspace/ember/packages/slack-bot/cogmem.toml
```

期待: エラーなし（相対パス `data/memory/logs` で data symlink 経由なので変更不要）

- [ ] **Step 7: mcp-servers.example.json をコピーする**

```bash
cp /Users/akira/workspace/claude-code-slack-bot/mcp-servers.example.json \
   /Users/akira/workspace/ember/packages/slack-bot/mcp-servers.example.json
```

期待: エラーなし

- [ ] **Step 8: CLAUDE.md をコピーする**

```bash
cp /Users/akira/workspace/claude-code-slack-bot/CLAUDE.md \
   /Users/akira/workspace/ember/packages/slack-bot/CLAUDE.md
```

期待: エラーなし

---

### Task 4: src/ ディレクトリを丸ごとコピーする

**Files:**
- Create: `packages/slack-bot/src/` (全ファイル)

- [ ] **Step 1: src/ を rsync でコピーする**

```bash
rsync -av --exclude='__pycache__' \
  /Users/akira/workspace/claude-code-slack-bot/src/ \
  /Users/akira/workspace/ember/packages/slack-bot/src/
```

期待: 全ファイルがコピーされ、最後に `sent X bytes` が表示される

- [ ] **Step 2: ファイル数を確認する**

```bash
find /Users/akira/workspace/ember/packages/slack-bot/src -type f | wc -l
find /Users/akira/workspace/claude-code-slack-bot/src -type f | wc -l
```

期待: 両方同じ数（`src/__tests__` を含む全 `.ts` ファイル）

---

### Task 5: tests/ と scripts/ をコピーする

**Files:**
- Create: `packages/slack-bot/tests/`
- Create: `packages/slack-bot/scripts/`

- [ ] **Step 1: tests/ をコピーする**

```bash
rsync -av \
  /Users/akira/workspace/claude-code-slack-bot/tests/ \
  /Users/akira/workspace/ember/packages/slack-bot/tests/
```

期待: エラーなし

- [ ] **Step 2: scripts/ をコピーする（__pycache__ 除外）**

```bash
rsync -av --exclude='__pycache__' --exclude='*.pyc' \
  /Users/akira/workspace/claude-code-slack-bot/scripts/ \
  /Users/akira/workspace/ember/packages/slack-bot/scripts/
```

期待: エラーなし

---

### Task 6: package.json を完成させる

**Files:**
- Modify: `packages/slack-bot/package.json`

- [ ] **Step 1: package.json を完成版に書き換える**

`/Users/akira/workspace/ember/packages/slack-bot/package.json` の内容を以下に差し替える:

```json
{
  "name": "@ember/slack-bot",
  "version": "1.0.0",
  "private": true,
  "description": "Slack gateway, scheduler, proactive agents",
  "main": "dist/index.js",
  "exports": {
    "./openai-fallback": {
      "import": "./src/openai-fallback.ts",
      "require": "./dist/openai-fallback.js"
    }
  },
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "prod": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "auth:chatgpt": "tsx scripts/auth-chatgpt.ts"
  },
  "devDependencies": {
    "@types/express": "^5.0.6",
    "@types/node": "^24.0.4",
    "@types/node-cron": "^3.0.11",
    "@types/supertest": "^7.2.0",
    "madge": "^8.0.0",
    "supertest": "^7.2.2",
    "tsx": "^4.21.0",
    "typescript": "^5.8.3",
    "vitest": "^4.1.0"
  },
  "dependencies": {
    "@anthropic-ai/claude-code": "^1.0.128",
    "@modelcontextprotocol/sdk": "^1.13.2",
    "@slack/bolt": "^4.4.0",
    "@types/node-fetch": "^2.6.12",
    "dotenv": "^16.6.0",
    "express": "^5.2.1",
    "googleapis": "^171.4.0",
    "node-cron": "^4.2.1",
    "node-fetch": "^3.3.2"
  }
}
```

- [ ] **Step 2: ember/.gitignore に .env と mcp-servers.json を追加する**

旧リポでは `mcp-servers.json` が gitignore 済み（secrets を含むため）だが、ember 側にはまだ未登録。誤コミット防止のため必須。

```bash
grep -E "^\.env$|^\*\*/\.env$" /Users/akira/workspace/ember/.gitignore || echo ".env" >> /Users/akira/workspace/ember/.gitignore
grep -E "mcp-servers\.json" /Users/akira/workspace/ember/.gitignore || echo "**/mcp-servers.json" >> /Users/akira/workspace/ember/.gitignore
```

期待: `.env` と `**/mcp-servers.json` の両方が ember/.gitignore 末尾にある。

検証:
```bash
tail -5 /Users/akira/workspace/ember/.gitignore
```

---

## Phase 4: ハードコードされた絶対パスを修正する

### Task 7: src/ 内のハードコードパスを修正する

**Files:**
- Modify: `packages/slack-bot/src/claude-handler.ts`
- Modify: `packages/slack-bot/src/conversation-logger.ts`
- Modify: `packages/slack-bot/src/memento-skills.ts`
- Modify: `packages/slack-bot/src/skill-enhanced-proactive-agent.ts`

- [ ] **Step 1: claude-handler.ts の permission-mcp-server パスを動的化する**

`/Users/akira/workspace/ember/packages/slack-bot/src/claude-handler.ts` の 144 行目付近:

変更前:
```typescript
args: ['tsx', '/Users/akira/workspace/claude-code-slack-bot/src/permission-mcp-server.ts'],
```

変更後（CommonJS 確定 — `tsconfig.json: module: commonjs` のため `__dirname` を使う）:
```typescript
args: ['tsx', join(__dirname, 'permission-mcp-server.ts')],
```

`claude-handler.ts` の先頭 `import` 部分に `join` が既にインポートされているかを確認し、なければ `import { join } from 'path';` を追加する。`import.meta.url` は CommonJS では使えないので採用しない。

- [ ] **Step 2: 変更後の行を確認する**

```bash
grep -n "permission-mcp-server" \
  /Users/akira/workspace/ember/packages/slack-bot/src/claude-handler.ts
```

期待: `__dirname` または `join` を使う動的パスになっている

- [ ] **Step 3: conversation-logger.ts の COGMEM_PROJECT を env var 化する**

`/Users/akira/workspace/ember/packages/slack-bot/src/conversation-logger.ts` の 7-8 行目:

変更前:
```typescript
const COGMEM_PROJECT = '/Users/akira/workspace/open-claude';
const COGMEM_LOG_DIR = join(COGMEM_PROJECT, 'memory', 'logs');
```

変更後:
```typescript
const COGMEM_PROJECT = process.env.COGMEM_PROJECT || '/Users/akira/workspace/ember';
const COGMEM_LOG_DIR = join(COGMEM_PROJECT, 'memory', 'logs');
```

- [ ] **Step 4: memento-skills.ts の COGMEM_CWD を env var 化する**

`/Users/akira/workspace/ember/packages/slack-bot/src/memento-skills.ts` の 7 行目:

変更前:
```typescript
const COGMEM_CWD = '/Users/akira/workspace/open-claude';
```

変更後:
```typescript
const COGMEM_CWD = process.env.COGMEM_PROJECT || '/Users/akira/workspace/ember';
```

- [ ] **Step 5: skill-enhanced-proactive-agent.ts の COGMEM_CWD を env var 化する**

`/Users/akira/workspace/ember/packages/slack-bot/src/skill-enhanced-proactive-agent.ts` の 1488 行目付近:

変更前:
```typescript
const COGMEM_CWD = '/Users/akira/workspace/open-claude';
```

変更後:
```typescript
const COGMEM_CWD = process.env.COGMEM_PROJECT || '/Users/akira/workspace/ember';
```

- [ ] **Step 6: 残存するハードコードパスがないことを確認する**

```bash
grep -rn "workspace/claude-code-slack-bot\|workspace/open-claude" \
  /Users/akira/workspace/ember/packages/slack-bot/src/
```

期待: 0 件

---

### Task 8: mcp-servers.json のパスを更新する

**Files:**
- Create: `packages/slack-bot/mcp-servers.json`

- [ ] **Step 1: mcp-servers.json を新パス用に編集して作成する**

`/Users/akira/workspace/ember/packages/slack-bot/mcp-servers.json` を作成する:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "gmail-mcp"
    },
    "google-drive": {
      "command": "mcp-google-drive",
      "env": {
        "GOOGLE_CLIENT_ID": "<REDACTED>",
        "GOOGLE_CLIENT_SECRET": "<REDACTED>",
        "GOOGLE_REFRESH_TOKEN": "<REDACTED>"
      }
    },
    "google-calendar": {
      "command": "npx",
      "args": ["tsx", "/Users/akira/workspace/ember/packages/slack-bot/src/google-calendar-mcp-server.ts"]
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/akira/workspace",
        "/Users/akira/.openclaw/workspace"
      ]
    }
  }
}
```

- [ ] **Step 2: mcp-servers.json に旧パスが残っていないことを確認する**

```bash
grep "claude-code-slack-bot\|open-claude" \
  /Users/akira/workspace/ember/packages/slack-bot/mcp-servers.json
```

期待: 0 件

---

### Task 9: cron-jobs.json のパスを更新する

**Files:**
- Create: `packages/slack-bot/cron-jobs.json`

- [ ] **Step 1: 旧 cron-jobs.json を新パスへコピーする**

```bash
cp /Users/akira/workspace/claude-code-slack-bot/cron-jobs.json \
   /Users/akira/workspace/ember/packages/slack-bot/cron-jobs.json
```

- [ ] **Step 2: claude-code-slack-bot パスの scripts 参照を更新する**

grep で確認済みの対象（`command` フィールドのみ、`message` 内テキストは埋め込みなので後述で判断）:

```bash
sed -i '' \
  's|/Users/akira/workspace/claude-code-slack-bot/scripts/|/Users/akira/workspace/ember/packages/slack-bot/scripts/|g' \
  /Users/akira/workspace/ember/packages/slack-bot/cron-jobs.json
```

- [ ] **Step 3: message フィールド内の旧パス参照を確認する**

```bash
grep "claude-code-slack-bot\|open-claude" \
  /Users/akira/workspace/ember/packages/slack-bot/cron-jobs.json
```

期待される残存:
- `message` 内テキストの `open-claude/ir_news_cron/company_list.md` — `open-claude` は ember への symlink だが、`~/workspace/open-claude` が存在しない場合は `~/workspace/ember` に手動更新する
- `message` 内テキストの `data/cron-history.jsonl` — 相対パス参照なのでそのままでよい
- `message` 内テキストの旧 scripts パスは `sed` で変換済みのはず

`open-claude` が symlink として存在するか確認する:

```bash
ls -la /Users/akira/workspace/ | grep open-claude
```

`open-claude -> ember` の symlink が確認できれば、`message` 内の `open-claude` パスは変更不要（ember 実体に解決される）。symlink がない場合は `open-claude` を `ember` に置換する:

```bash
sed -i '' \
  's|/Users/akira/workspace/open-claude/|/Users/akira/workspace/ember/|g' \
  /Users/akira/workspace/ember/packages/slack-bot/cron-jobs.json
```

- [ ] **Step 4: ai-dev 参照は変更不要であることを確認する**

```bash
grep "ai-dev" /Users/akira/workspace/ember/packages/slack-bot/cron-jobs.json | head -5
```

`ai-dev` リポは ember 管理外なので変更不要。パスはそのまま（`/Users/akira/workspace/ai-dev/web-search`）。

- [ ] **Step 5: data/cron-history.jsonl の参照は symlink 経由で解決されることを確認する**

message テキスト内の `data/cron-history.jsonl` は scheduler が `process.cwd()` を基準に解決するため、pm2 の exec cwd が新パスになれば `packages/slack-bot/data/cron-history.jsonl`（symlink 経由）で正しく解決される。grep 確認:

```bash
ls /Users/akira/workspace/ember/packages/slack-bot/data/cron-history.jsonl
```

期待: symlink 経由でファイルが見える

---

### Task 10: scripts/ 内のハードコードパスを確認・修正する

**Files:**
- Modify: `packages/slack-bot/scripts/proactive_dedup_audit.py` (必要な場合)
- Modify: `packages/slack-bot/scripts/gmail_to_drive.py` (必要な場合)

- [ ] **Step 1: scripts/ 内の旧パス参照を洗い出す**

```bash
grep -rn "claude-code-slack-bot\|workspace/open-claude" \
  /Users/akira/workspace/ember/packages/slack-bot/scripts/
```

- [ ] **Step 2: 見つかったパスを新パスに置換する**

例えば `scripts/proactive_dedup_audit.py` に旧パスがあれば:

```bash
sed -i '' \
  's|/Users/akira/workspace/claude-code-slack-bot/|/Users/akira/workspace/ember/packages/slack-bot/|g' \
  /Users/akira/workspace/ember/packages/slack-bot/scripts/proactive_dedup_audit.py
```

各ファイルについて同様に実施する。

- [ ] **Step 3: 修正後に残存パスがないことを確認する**

```bash
grep -rn "claude-code-slack-bot" \
  /Users/akira/workspace/ember/packages/slack-bot/scripts/
```

期待: 0 件

---

## Phase 5: packages/dashboard の移植

### Task 11: dashboard の設定ファイルをコピーする

**Files:**
- Create: `packages/dashboard/vite.config.ts`
- Create: `packages/dashboard/tailwind.config.js`
- Create: `packages/dashboard/postcss.config.js`
- Create: `packages/dashboard/index.html`
- Create: `packages/dashboard/tsconfig.json`

- [ ] **Step 1: 設定ファイルをまとめてコピーする**

```bash
cp /Users/akira/workspace/claude-code-slack-bot/dashboard/vite.config.ts \
   /Users/akira/workspace/ember/packages/dashboard/vite.config.ts

cp /Users/akira/workspace/claude-code-slack-bot/dashboard/tailwind.config.js \
   /Users/akira/workspace/ember/packages/dashboard/tailwind.config.js

cp /Users/akira/workspace/claude-code-slack-bot/dashboard/postcss.config.js \
   /Users/akira/workspace/ember/packages/dashboard/postcss.config.js

cp /Users/akira/workspace/claude-code-slack-bot/dashboard/index.html \
   /Users/akira/workspace/ember/packages/dashboard/index.html

cp /Users/akira/workspace/claude-code-slack-bot/dashboard/tsconfig.json \
   /Users/akira/workspace/ember/packages/dashboard/tsconfig.json
```

期待: エラーなし

---

### Task 12: dashboard の src/ と server/ をコピーする

**Files:**
- Create: `packages/dashboard/src/` (全ファイル)
- Create: `packages/dashboard/server/api.ts`
- Create: `packages/dashboard/server/tsconfig.json`

- [ ] **Step 1: dashboard/src/ をコピーする**

```bash
rsync -av \
  /Users/akira/workspace/claude-code-slack-bot/dashboard/src/ \
  /Users/akira/workspace/ember/packages/dashboard/src/
```

期待: エラーなし

- [ ] **Step 2: dashboard/server/ をコピーする**

```bash
rsync -av \
  /Users/akira/workspace/claude-code-slack-bot/dashboard/server/ \
  /Users/akira/workspace/ember/packages/dashboard/server/
```

期待: エラーなし

- [ ] **Step 3: ファイル数を確認する**

```bash
find /Users/akira/workspace/ember/packages/dashboard/src -type f | wc -l
find /Users/akira/workspace/claude-code-slack-bot/dashboard/src -type f | wc -l
```

期待: 同じ数

---

### Task 13: dashboard/server/api.ts の cross-package import を修正する

**Files:**
- Modify: `packages/dashboard/server/api.ts`

この修正は dashboard が slack-bot の `openai-fallback.ts` に依存しているため必須。

- [ ] **Step 1: dashboard/package.json を完成版に書き換える**

`/Users/akira/workspace/ember/packages/dashboard/package.json` の内容を差し替える:

```json
{
  "name": "@ember/dashboard",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "React dashboard + Express API server",
  "scripts": {
    "dev": "concurrently \"vite\" \"tsx server/api.ts\"",
    "build": "vite build",
    "preview": "vite preview",
    "server": "tsx server/api.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ember/slack-bot": "workspace:*",
    "express": "^4.21.0",
    "http-proxy-middleware": "^3.0.5",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.1.0",
    "recharts": "^2.15.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.20",
    "concurrently": "^9.1.0",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "tsx": "^4.21.0",
    "typescript": "^5.8.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: api.ts の cross-package import を修正する**

`/Users/akira/workspace/ember/packages/dashboard/server/api.ts` の 7 行目:

変更前:
```typescript
import { queryWithFallback } from '../../src/openai-fallback';
```

変更後:
```typescript
import { queryWithFallback } from '@ember/slack-bot/openai-fallback';
```

- [ ] **Step 3: api.ts の open-claude パス参照を修正する**

`/Users/akira/workspace/ember/packages/dashboard/server/api.ts` の 22 行目:

変更前:
```typescript
const AUDIO_FIXTURE_INCOMING_DIR = path.resolve(ROOT, '../open-claude/scripts/voice_chat/tests/fixtures/audio/incoming');
```

変更後（ROOT は `path.resolve(__dirname, '../..')` = `packages/dashboard`、ember root から見て `../../scripts/voice_chat/...`）:
```typescript
const AUDIO_FIXTURE_INCOMING_DIR = path.resolve(ROOT, '../../scripts/voice_chat/tests/fixtures/audio/incoming');
```

注: P2 で voice_chat が `packages/voice-chat/` に移動した時点でこのパスは破綻する。**P2 plan で `packages/voice-chat/tests/fixtures/audio/incoming` への再更新が必須**（NOT in scope セクションに記載）。

さらに `VOICE_CHAT_DIR` の 2098 行目付近:

変更前:
```typescript
const VOICE_CHAT_DIR = path.join(HOME, 'workspace/open-claude/scripts/voice_chat');
```

変更後（open-claude は ember への symlink だが明示化する）:
```typescript
const VOICE_CHAT_DIR = path.join(HOME, 'workspace/ember/scripts/voice_chat');
```

注: 同様に **P2 で `path.join(HOME, 'workspace/ember/packages/voice-chat')` に再更新必須**。

- [ ] **Step 4: 修正箇所を確認する + ESM/CommonJS 混在チェック**

旧パス参照が消えたか:
```bash
grep -n "open-claude\|claude-code-slack-bot\|../../src" \
  /Users/akira/workspace/ember/packages/dashboard/server/api.ts
```

期待: 0 件

dashboard `package.json` は `"type": "module"` (Task 13 Step 1) だが `server/api.ts` には CommonJS 流の `__dirname` / `require()` / `module.exports` が残っている可能性がある。純粋 ESM 環境では `__dirname` は undefined、`require()` は ReferenceError になり tsx 実行時に破綻する。確認:

```bash
grep -nE "(^|[^a-zA-Z_])(__dirname|__filename|require\(|module\.exports)" \
  /Users/akira/workspace/ember/packages/dashboard/server/api.ts
```

期待: 0 件が理想。残っていれば ESM 互換に書き換える:
- `__dirname` → `path.dirname(fileURLToPath(import.meta.url))` (`import { fileURLToPath } from 'url'` を追加)
- `require('foo')` → top-level `import { foo } from 'foo'`
- `module.exports = X` → `export default X`

この修正漏れは Task 14b の smoke test で起動失敗として顕現する。事前に潰しておけば再走り回避。

---

## Phase 6: pnpm install とビルド検証

### Task 14: monorepo の依存関係をインストールしてビルドを通す

**Files:** なし（コマンドのみ）

- [ ] **Step 1: pnpm install を実行する（ember root で）**

```bash
cd /Users/akira/workspace/ember && pnpm install
```

期待: `node_modules` が各 package に作成される。workspace リンクで `@ember/slack-bot` が `packages/dashboard/node_modules` に symlink される。

- [ ] **Step 1.5: pnpm-lock.yaml の更新を確認する（再現性のため必須）**

`workspace:*` 追加 + 新規依存解決で `pnpm-lock.yaml` が更新される。これを Phase 10 Task 19 でコミットしないと clean clone で同じ依存グラフが再現できない:

```bash
/usr/bin/git -C /Users/akira/workspace/ember diff --stat pnpm-lock.yaml | head -3
```

期待: lock file の行数差分が出る。差分なしなら pnpm install が effective 動作してない可能性 → 調査。

- [ ] **Step 2: slack-bot の TypeScript 型チェックを実行する**

```bash
cd /Users/akira/workspace/ember/packages/slack-bot && pnpm typecheck
```

期待: エラー 0 件。エラーが出た場合は修正する（`__dirname` vs `import.meta.url` の混在など）。

- [ ] **Step 3: slack-bot のテストを実行する**

```bash
cd /Users/akira/workspace/ember/packages/slack-bot && pnpm test
```

期待: 全テスト PASS（旧リポと同じ結果）。失敗するテストがあれば原因を調査して修正する。

注: `src/__tests__/` と `tests/` の両方が実行対象になる。`vitest.config.ts` の `exclude` に `dist/**` と `node_modules/**` のみ指定しているため両ディレクトリが拾われる。

- [ ] **Step 4: dashboard の TypeScript 型チェックを実行する**

```bash
cd /Users/akira/workspace/ember/packages/dashboard && npx tsc --noEmit -p server/tsconfig.json
```

期待: エラー 0 件。`@ember/slack-bot/openai-fallback` が解決されることを確認する。

- [ ] **Step 5: monorepo 全体の型チェックをする**

```bash
cd /Users/akira/workspace/ember && pnpm typecheck
```

期待: エラー 0 件

- [ ] **Step 6: slack-bot の dev 起動テスト（3秒で kill）**

macOS 標準環境に `timeout` コマンドは存在しない（GNU coreutils の `gtimeout` か手動 kill が必要）。可搬性のため command 検出 + フォールバック:

```bash
cd /Users/akira/workspace/ember/packages/slack-bot
if command -v timeout >/dev/null 2>&1; then
  timeout 3 pnpm dev || echo "(timeout expected — bot tried to connect to Slack)"
elif command -v gtimeout >/dev/null 2>&1; then
  gtimeout 3 pnpm dev || echo "(timeout expected)"
else
  pnpm dev > /tmp/p1-slack-bot-smoke.log 2>&1 &
  SBOT_PID=$!
  sleep 3
  kill "$SBOT_PID" 2>/dev/null
  pkill -P "$SBOT_PID" 2>/dev/null
  wait "$SBOT_PID" 2>/dev/null
  cat /tmp/p1-slack-bot-smoke.log | tail -20
  rm -f /tmp/p1-slack-bot-smoke.log
fi
```

期待: Slack 接続失敗のログが出るが `Missing required environment variables` 系のエラーは出ない（.env が読み込まれている）。Bot process が起動するところまで確認できれば OK。

---

### Task 14b: dashboard cross-package import 解決の smoke test

**Files:** なし（起動検証のみ）

`@ember/slack-bot/openai-fallback` の workspace 解決が dev 経路で実際に動くことを起動検証で確認する。型チェックだけでは module resolution failure を検出できない（tsx は実行時に解決する）。

- [ ] **Step 1: dashboard server を background 起動（PID 保持）**

```bash
cd /Users/akira/workspace/ember/packages/dashboard && pnpm server > /tmp/p1-dashboard-smoke.log 2>&1 &
DASHBOARD_PID=$!
echo "$DASHBOARD_PID" > /tmp/p1-dashboard-smoke.pid
sleep 4
```

注: `kill %1` (job control) は非対話シェルや別 job がある状況で脆弱。PID 保持して明示 kill する。

期待: `Express API server running on http://0.0.0.0:3456` がログに出る。`Cannot find module '@ember/slack-bot/openai-fallback'` 等のエラーが**出ていない**こと。

- [ ] **Step 2: 起動状況を確認**

```bash
grep -E "(Express API|Cannot find|Error)" /tmp/p1-dashboard-smoke.log | head -10
lsof -i :3456 | head -3
```

期待: Express 起動行あり、エラー行なし、port 3456 を bind したプロセスあり。

- [ ] **Step 3: openai-fallback を経由する endpoint があれば叩いて確認**

`api.ts` で `queryWithFallback` を使っている route を確認:

```bash
grep -n "queryWithFallback" /Users/akira/workspace/ember/packages/dashboard/server/api.ts | head -5
```

該当 route があれば curl で叩いて 500 にならないか確認（input 不要 GET があれば優先、無ければ 400 バリデーションエラーが返ればモジュール解決は OK と見なす）。

- [ ] **Step 4: dashboard server を停止（PID 経由で確実に）**

```bash
PID=$(cat /tmp/p1-dashboard-smoke.pid)
kill "$PID" 2>/dev/null
sleep 1
# 子 process (tsx → node) が残っていれば手動 kill
pkill -P "$PID" 2>/dev/null
sleep 1
lsof -i :3456 | head -1 || echo "(port 3456 freed)"
rm -f /tmp/p1-dashboard-smoke.pid
```

期待: port 3456 解放。

- [ ] **Step 5: ログ確認とクリーンアップ**

```bash
cat /tmp/p1-dashboard-smoke.log | tail -20
rm /tmp/p1-dashboard-smoke.log
```

問題なければ Phase 7 へ。`Cannot find module` 系エラーが出てたら Task 13 Step 1 (`exports` フィールド) と Task 6 Step 1 (`@ember/slack-bot` workspace 依存) を見直す — BLOCKED として報告。

---

## Phase 7: pm2 切り替え

### Task 15: pm2 プロセスを新パスで再起動する

**Files:** なし（pm2 操作のみ）

**事前ロールバック手順の確認:** 下記 Task 16 を先に読んでから本タスクを実行する。

- [ ] **Step 1: 現在の pm2 状態を記録する**

```bash
pm2 show claude-slack-bot
```

記録すべき情報:
- `exec cwd`: `/Users/akira/workspace/claude-code-slack-bot`
- `script args`: `run prod`
- `script path`: `/Users/akira/.anyenv/envs/nodenv/versions/24.14.0/bin/npm`

- [ ] **Step 2: 新パスで prod ビルドを作成する**

```bash
cd /Users/akira/workspace/ember/packages/slack-bot && pnpm build
```

期待: `dist/index.js` が生成される

```bash
ls /Users/akira/workspace/ember/packages/slack-bot/dist/index.js
```

- [ ] **Step 3: pm2 を停止する（停止時間開始）**

```bash
pm2 stop claude-slack-bot
```

期待:
```
[PM2] Stopping claude-slack-bot...
[PM2] [claude-slack-bot](0) ✓
```

- [ ] **Step 3.5: scheduler.lock を確認・必要なら削除する**

scheduler.ts は起動時に `data/.scheduler.lock` をチェックし、書かれた PID が生きていれば「別 instance 稼働中」と判断して起動を skip する (line 137-167)。pm2 stop 直後に lock が残ったまま新 instance が走ると競合する可能性があるため確認:

```bash
LOCK=/Users/akira/workspace/claude-code-slack-bot/data/.scheduler.lock
if [ -f "$LOCK" ]; then
  LOCK_PID=$(cat "$LOCK")
  echo "lock PID: $LOCK_PID"
  if ps -p "$LOCK_PID" > /dev/null 2>&1; then
    echo "(process $LOCK_PID still alive — wait or investigate)"
  else
    echo "(stale lock — clearing)"
    rm -f "$LOCK"
  fi
else
  echo "(no lock — clean state)"
fi
```

期待: `(stale lock — clearing)` または `(no lock — clean state)`。生きてる process が残っていたら BLOCKED で報告し、`pm2 logs` と `ps` で原因調査。

注: 旧パスと新パスの data/ は P1 では symlink で同一実体を指すため、削除はどちらか片方で OK。

- [ ] **Step 4: pm2 の設定を新パスで更新して起動する**

```bash
pm2 delete claude-slack-bot
pm2 start npm \
  --name "claude-slack-bot" \
  --cwd /Users/akira/workspace/ember/packages/slack-bot \
  -- run prod
```

期待: `[PM2] [claude-slack-bot](0) ✓` + status が `online`

- [ ] **Step 5: pm2 状態を確認する**

```bash
pm2 show claude-slack-bot
```

確認ポイント:
- `exec cwd` が `/Users/akira/workspace/ember/packages/slack-bot` になっている
- `status` が `online`
- `restarts` が 0（すぐにクラッシュしていない）

- [ ] **Step 6: ログを確認する**

```bash
pm2 logs claude-slack-bot --lines 50 --nostream
```

期待: エラーなく bot が起動している（`All bots are running!` または `Internal API listening` が出ている）

- [ ] **Step 7: Internal API が応答することを確認する（停止時間終了）**

```bash
curl -s http://127.0.0.1:3457/internal/health -m 5
```

期待: `{"ok":true}` または `{"status":"ok"}` 系のレスポンス

- [ ] **Step 8: pm2 の設定を保存する**

```bash
pm2 save
```

期待: `[PM2] Saving current process list... [PM2] Successfully saved in /Users/akira/.pm2/dump.pm2`

---

### Task 16: rollback 手順（緊急時）

このタスクは **実行しない**。緊急時のみ参照する。

**pm2 を旧パスに戻す手順:**

```bash
# 1. 新パスの pm2 プロセスを停止・削除
pm2 stop claude-slack-bot
pm2 delete claude-slack-bot

# 2. 旧パスで再起動
pm2 start npm \
  --name "claude-slack-bot" \
  --cwd /Users/akira/workspace/claude-code-slack-bot \
  -- run prod

# 3. 確認
pm2 show claude-slack-bot
pm2 logs claude-slack-bot --lines 30 --nostream

# 4. 保存
pm2 save
```

ロールバック所要時間: 約 30 秒

---

## Phase 8: scheduler 発火検証

### Task 17: cron-jobs.json が新パスから読まれていることを確認する

**Files:** なし（確認のみ）

- [ ] **Step 1: scheduler が cron-jobs.json を読んでいることをログで確認する**

```bash
pm2 logs claude-slack-bot --lines 100 --nostream | grep -i "scheduler\|cron\|jobs loaded"
```

期待: `Scheduler: loaded N jobs` のようなログが出ている

- [ ] **Step 2: cron-history.jsonl に新規エントリが記録されていることを確認する（30分待機後）**

```bash
tail -3 /Users/akira/workspace/ember/packages/slack-bot/data/cron-history.jsonl
```

期待: 直近のジョブ実行記録が出ている（symlink 経由で旧 data/ に書かれる）

注: このステップは pm2 再起動後に有効なジョブが発火するまで待つ必要がある。`proactive-checkin` は毎時 0 分に発火するので最大 1 時間待てば確認できる。急ぐ場合は dashboard の `Run Now` ボタンで手動実行する。

- [ ] **Step 3: dashboard 経由でジョブを手動実行して確認する**

dashboard サーバーを起動する（PID 保持）:

```bash
cd /Users/akira/workspace/ember/packages/dashboard && pnpm server > /tmp/p1-cron-verify.log 2>&1 &
DASH_PID=$!
sleep 4
```

期待: `/tmp/p1-cron-verify.log` に `Express API server running on http://0.0.0.0:3456` が出る

```bash
curl -s -X POST http://localhost:3456/api/cron-jobs/scheduler-watchdog/run | python3 -m json.tool
```

期待: `{"ok": true}` または watchdog の実行結果

起動したバックグラウンドプロセスを終了する:

```bash
kill "$DASH_PID" 2>/dev/null
sleep 1
pkill -P "$DASH_PID" 2>/dev/null
rm -f /tmp/p1-cron-verify.log
```

---

## Phase 9: 旧リポへの deprecation notice

### Task 18: 旧リポの README に移植済み通知を追加する

**Files:**
- Modify: `/Users/akira/workspace/claude-code-slack-bot/README.md`

- [ ] **Step 1: README.md の先頭に notice を追加する**

`/Users/akira/workspace/claude-code-slack-bot/README.md` の先頭（1行目の前）に挿入する:

```markdown
> **[2026-05-01] このリポジトリは `ember` monorepo に移植されました。**
> 実装は `~/workspace/ember/packages/slack-bot/` にあります。
> このリポジトリは参考用として残しており、P3 完了後に archive 予定です。
> 新規変更は ember monorepo で行ってください。

---

```

- [ ] **Step 2: commit して push する**

```bash
git -C /Users/akira/workspace/claude-code-slack-bot add README.md
git -C /Users/akira/workspace/claude-code-slack-bot commit -m "chore: add migration notice — moved to ember monorepo (P1)"
git -C /Users/akira/workspace/claude-code-slack-bot push
```

期待: `main -> main`

---

## Phase 10: ember monorepo の最終コミット

### Task 19: ember 側の移植内容をコミットする

**Files:** 全移植ファイル（slack-bot + dashboard）

- [ ] **Step 1: ember の状態を確認する**

```bash
/usr/bin/git -C /Users/akira/workspace/ember status --short
```

期待: `packages/slack-bot/` と `packages/dashboard/` 配下に多数の `?? `（新規ファイル）が表示される。symlink は `?? packages/slack-bot/data` `?? packages/slack-bot/memory` として表示される。

- [ ] **Step 2: 【最重要】symlink を .gitignore に追加してから add する（順序重要）**

`packages/slack-bot/{data,memory}` は絶対パスを指す symlink。git に commit すると他の checkout で dangling reference になり壊れる。**必ず .gitignore 更新 → add packages の順**で進める:

```bash
# 既存 .gitignore に symlink exclude を追加（重複防止）
grep -E "^packages/slack-bot/data$" /Users/akira/workspace/ember/.gitignore || \
  echo "packages/slack-bot/data" >> /Users/akira/workspace/ember/.gitignore
grep -E "^packages/slack-bot/memory$" /Users/akira/workspace/ember/.gitignore || \
  echo "packages/slack-bot/memory" >> /Users/akira/workspace/ember/.gitignore

# .gitignore を先に commit（symlink を tracked にしないため）
/usr/bin/git -C /Users/akira/workspace/ember add .gitignore
/usr/bin/git -C /Users/akira/workspace/ember commit -m "chore: ignore slack-bot symlinks (data, memory) — local-only refs"
```

期待: .gitignore コミット完了後、`git status --short` で symlink 行 (`?? packages/slack-bot/data`) が消えている。

- [ ] **Step 3: pnpm-lock.yaml をステージング（再現性のため必須）**

Task 14 Step 1.5 で diff 確認済みの lock file を含める:

```bash
/usr/bin/git -C /Users/akira/workspace/ember add pnpm-lock.yaml
```

- [ ] **Step 4: slack-bot の移植ファイルをステージングする**

```bash
/usr/bin/git -C /Users/akira/workspace/ember add packages/slack-bot/
```

確認: symlink が誤って tracked になっていないこと:

```bash
/usr/bin/git -C /Users/akira/workspace/ember diff --cached --name-only packages/slack-bot/ | grep -E "^packages/slack-bot/(data|memory)$" && echo "ERROR: symlinks tracked, abort" || echo "OK: symlinks excluded"
```

期待: `OK: symlinks excluded`。`ERROR` が出たら `.gitignore` の glob 設定を見直して `git rm --cached`。

- [ ] **Step 5: dashboard の移植ファイルをステージングする**

```bash
/usr/bin/git -C /Users/akira/workspace/ember add packages/dashboard/
```

- [ ] **Step 6: コミットする**

```bash
/usr/bin/git -C /Users/akira/workspace/ember commit -m "feat(p1): migrate slack-bot + dashboard from claude-code-slack-bot

- packages/slack-bot/: TypeScript bot core (src/, tests/, scripts/)
- packages/dashboard/: React + Vite + Express server
- symlinks (gitignored): slack-bot/{data,memory} -> claude-code-slack-bot/{data,memory} (P4 でデファー)
- cross-package: dashboard が @ember/slack-bot/openai-fallback を workspace 依存で参照
- hardcoded paths: permission-mcp-server, COGMEM_PROJECT, VOICE_CHAT_DIR を修正済み
- pm2: exec cwd を packages/slack-bot/ に更新済み
- pnpm-lock.yaml: workspace 依存解決後の lock を含める"
```

- [ ] **Step 7: push する**

```bash
/usr/bin/git -C /Users/akira/workspace/ember push
```

期待: `main -> main`

---

## 完了条件 (DoD)

以下が全て満たされた時点で P1 完了:

1. `pnpm test` が `packages/slack-bot/` から全テスト PASS する
2. `pnpm typecheck` が `packages/slack-bot/` と `packages/dashboard/` 両方でエラー 0 件
3. `pm2 show claude-slack-bot` の `exec cwd` が `/Users/akira/workspace/ember/packages/slack-bot` になっている
4. `pm2 logs claude-slack-bot` に bot 起動完了ログが出ている（`All bots are running!`）
5. `curl http://127.0.0.1:3457/internal/health` が応答する
6. `data/cron-history.jsonl` に pm2 再起動後の新規エントリが記録されている（symlink 経由）
7. `packages/slack-bot/` 内に `claude-code-slack-bot` や `open-claude` のハードコードパスが残っていない
8. 旧リポの `README.md` に migration notice が追加されている
9. ember の commit に移植内容が含まれている

---

## スコープ外（後続フェーズ）

- P2: `packages/voice-chat/` への voice_chat 移植
- P2: `packages/ember-chat/` への ember-chat 移植
- **P2: `dashboard/server/api.ts` の `VOICE_CHAT_DIR` と `AUDIO_FIXTURE_INCOMING_DIR` を `packages/voice-chat/` 配下に再更新する**（P1 では `~/workspace/ember/scripts/voice_chat` を一時的に指す。voice_chat が `packages/voice-chat/` に移った時点でパスが破綻するので、P2 plan の Phase 末尾に必ず含めること）
- P3: 旧 `claude-code-slack-bot` リポの archive
- P3: `mcp-servers.json` の secrets を `.env` 化（cso 監査対象。mcp-manager.ts に env var 展開ロジック追加が必要なため別 PR）
- P4: `data/` `memory/` を ember monorepo に集約（symlink 解消）
- P4: `cogmem.toml` のパス更新
- P4: cron-jobs.json の `message` テキスト内パス（LLM が読む埋め込みテキスト）の更新

---

## ロールバック手順（全体）

pm2 ロールバックは Task 16 を参照。コード変更のロールバックが必要な場合:

```bash
# ember 側の移植コミットを revert する（ファイルは残る）
git -C /Users/akira/workspace/ember revert HEAD --no-edit

# または強制的に戻す（移植ファイルを全削除）
git -C /Users/akira/workspace/ember reset --hard HEAD~1
rm -rf /Users/akira/workspace/ember/packages/slack-bot/src \
       /Users/akira/workspace/ember/packages/slack-bot/tests \
       /Users/akira/workspace/ember/packages/slack-bot/scripts \
       /Users/akira/workspace/ember/packages/dashboard/src \
       /Users/akira/workspace/ember/packages/dashboard/server

# pm2 を旧パスに戻す（Task 16 の手順）
pm2 stop claude-slack-bot && pm2 delete claude-slack-bot
pm2 start npm --name "claude-slack-bot" \
  --cwd /Users/akira/workspace/claude-code-slack-bot \
  -- run prod
pm2 save
```
