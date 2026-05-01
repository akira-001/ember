# P2 Monorepo Migration: voice-chat & ember-chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `scripts/voice_chat/`（Python FastAPI）と `scripts/ember-chat/`（Electron）を、それぞれ `packages/voice-chat/` および `packages/ember-chat/` に移植し、launchd 経由で voice_chat が新パスから起動でき、ember-chat が `npm start` で起動でき、pytest が全通ることを確認する。

**Architecture:** ファイルは `cp -r` で新場所にコピー（旧 scripts/ は移植確認まで残す）→ 絶対パス参照を修正 → 新 .venv を `uv sync` で再構築 → launchd plist を新パスに更新 → ember-chat の node_modules を再インストール → 旧 scripts/ を削除コミット。ember-chat の `AUDIO_FIXTURE_INCOMING_DIR` は `packages/voice-chat/tests/fixtures/audio/incoming` を指すように相対パスを更新する。

**Tech Stack:** Python 3.14 / uv / FastAPI / faster-whisper / speechbrain / Electron 35 / launchd / pytest-asyncio

---

## ファイルマップ

### 新規作成
- `packages/voice-chat/pyproject.toml` — uv プロジェクト設定 + 全依存（`[tool.pytest.ini_options]` で pytest 設定も内包、別 pytest.ini は不要）

### コピー（scripts/ → packages/voice-chat/）
- `app.py`, `ambient_commands.py`, `ambient_listener.py`, `ambient_policy.py`
- `speaker_id.py`, `wake_detect.py`, `wake_response.py`
- `co_view_10min_check.sh`, `co_view_hourly_analysis.sh`
- `settings.json`, `yomigana_map.json`, `stt_dict_user.json`
- `ambient_examples.json`, `ambient_rules.json`
- `index.html`, `.env`
- `chunk_transcripts.jsonl`, `context_summary_feedback.jsonl`
- `speaker_profiles/` (ディレクトリごと)
- `tests/` (ディレクトリごと)
- `docs/` (ディレクトリごと)

### 修正（packages/voice-chat/ 内）
- `app.py:868-871` — `_SLACK_BOT_DATA_DIR` の fallback パス（`parents[3]` → `parents[2]`）
- `app.py:4075` — `BOT_STATE_DIR` の絶対パス → env override + `parents[2]`ベースに変更
- `co_view_10min_check.sh:6` — `WORKDIR` を `/Users/akira/workspace/ember/packages/slack-bot/data` に変更
- `co_view_hourly_analysis.sh:7` — 同上
- `pyproject.toml` の `[tool.uv.workspace]` を `/Users/akira/workspace/ember/pyproject.toml` に追加

### 修正（packages/ember-chat/ 内）
- `packages/ember-chat/main.js:8` — `AUDIO_FIXTURE_INCOMING_DIR` の相対パスを修正
- `packages/ember-chat/package.json` — scripts に `start`, `dev` を追加

### 更新（ルート）
- `pyproject.toml` — `[tool.uv.workspace]` に `members = ["packages/voice-chat"]` 追加

### 更新（外部）
- `~/Library/LaunchAgents/local.whisper.serve.plist` — WorkingDirectory + ProgramArguments を新パスに

---

## Phase 1: uv workspace 宣言 + pyproject.toml 作成

### Task 1: ルート pyproject.toml に uv workspace を追加

**Files:**
- Modify: `/Users/akira/workspace/ember/pyproject.toml`

- [ ] **Step 1: 現在の pyproject.toml を確認**

```bash
cat /Users/akira/workspace/ember/pyproject.toml
```

期待出力:
```toml
[project]
name = "ember-monorepo"
...
[tool.uv]
managed = true
```

- [ ] **Step 2: workspace members を追加**

`[tool.uv]` セクションを以下に置き換える:

```toml
[tool.uv]
managed = true

[tool.uv.workspace]
members = ["packages/voice-chat"]
```

- [ ] **Step 3: 構文確認**

```bash
cd /Users/akira/workspace/ember && uv python list 2>&1 | head -3
```

期待: エラーなし（uv が pyproject.toml を正常に読める）

- [ ] **Step 4: コミット**

```bash
git -C /Users/akira/workspace/ember add pyproject.toml
git -C /Users/akira/workspace/ember commit -m "feat(monorepo): add uv workspace member packages/voice-chat"
```

---

### Task 2: packages/voice-chat/pyproject.toml を作成

**Files:**
- Create: `/Users/akira/workspace/ember/packages/voice-chat/pyproject.toml`

- [ ] **Step 1: pyproject.toml を書く**

```toml
[project]
name = "voice-chat"
version = "0.1.0"
description = "Ember voice chat server — Whisper STT + Irodori TTS + co_view + meeting digest"
requires-python = ">=3.14"
dependencies = [
    "annotated-types>=0.7.0",
    "anyio>=4.13.0",
    "audioop-lts>=0.2.2",
    "audioread>=3.1.0",
    "av>=17.0.0",
    "certifi>=2026.2.25",
    "cffi>=2.0.0",
    "charset-normalizer>=3.4.7",
    "click>=8.3.1",
    "ctranslate2>=4.7.1",
    "decorator>=5.2.1",
    "emoji>=2.15.0",
    "fastapi>=0.135.3",
    "faster-whisper>=1.2.1",
    "filelock>=3.25.2",
    "flatbuffers>=25.12.19",
    "fsspec>=2026.3.0",
    "funasr-onnx>=0.4.1",
    "h11>=0.16.0",
    "httpx>=0.28.1",
    "huggingface_hub>=1.9.0",
    "HyperPyYAML>=1.2.3",
    "jiwer>=4.0.0",
    "joblib>=1.5.3",
    "kaldi-native-fbank>=1.22.3",
    "librosa>=0.11.0",
    "llvmlite>=0.47.0",
    "markdown-it-py>=4.0.0",
    "mpmath>=1.3.0",
    "msgpack>=1.1.2",
    "networkx>=3.6.1",
    "numba>=0.65.0",
    "numpy>=1.26.4",
    "onnx>=1.19.0",
    "onnxruntime>=1.24.4",
    "packaging>=26.0",
    "platformdirs>=4.9.6",
    "pluggy>=1.6.0",
    "pooch>=1.9.0",
    "protobuf>=7.34.1",
    "pydantic>=2.12.5",
    "python-dotenv>=1.2.2",
    "python-multipart>=0.0.24",
    "PyYAML>=6.0.3",
    "RapidFuzz>=3.14.5",
    "requests>=2.33.1",
    "rich>=14.3.3",
    "ruamel.yaml>=0.18.17",
    "scikit-learn>=1.8.0",
    "scipy>=1.17.1",
    "sentencepiece>=0.2.1",
    "soundfile>=0.13.1",
    "soxr>=1.0.0",
    "speechbrain>=1.1.0",
    "starlette>=1.0.0",
    "sympy>=1.14.0",
    "threadpoolctl>=3.6.0",
    "tokenizers>=0.22.2",
    "torch>=2.11.0",
    "torchaudio>=2.11.0",
    "tqdm>=4.67.3",
    "typer>=0.24.1",
    "typing_extensions>=4.15.0",
    "urllib3>=2.6.3",
    "uvicorn>=0.42.0",
    "webrtcvad>=2.0.10",
    "websockets>=16.0",
    "pytest>=9.0.3",
    "pytest-asyncio>=1.3.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.pytest.ini_options]
testpaths = ["tests"]
```

ファイルパス: `/Users/akira/workspace/ember/packages/voice-chat/pyproject.toml`

- [ ] **Step 2: uv が読めることを確認（dry run）**

```bash
cd /Users/akira/workspace/ember/packages/voice-chat && uv pip list --system 2>&1 | head -3
```

期待: "error" が含まれない（pyproject.toml のパースエラーなし）

- [ ] **Step 3: コミット**

```bash
git -C /Users/akira/workspace/ember add packages/voice-chat/pyproject.toml
git -C /Users/akira/workspace/ember commit -m "feat(voice-chat): add pyproject.toml with full dependency list"
```

---

## Phase 2: voice_chat ファイル群を packages/voice-chat/ にコピー

### Task 3: Pythonソース・設定ファイルをコピー

**Files:**
- Create: `packages/voice-chat/` 配下の各ファイル

- [ ] **Step 1: Pythonソースをコピー**

```bash
cp /Users/akira/workspace/ember/scripts/voice_chat/app.py \
   /Users/akira/workspace/ember/packages/voice-chat/app.py

cp /Users/akira/workspace/ember/scripts/voice_chat/ambient_commands.py \
   /Users/akira/workspace/ember/packages/voice-chat/ambient_commands.py

cp /Users/akira/workspace/ember/scripts/voice_chat/ambient_listener.py \
   /Users/akira/workspace/ember/packages/voice-chat/ambient_listener.py

cp /Users/akira/workspace/ember/scripts/voice_chat/ambient_policy.py \
   /Users/akira/workspace/ember/packages/voice-chat/ambient_policy.py

cp /Users/akira/workspace/ember/scripts/voice_chat/speaker_id.py \
   /Users/akira/workspace/ember/packages/voice-chat/speaker_id.py

cp /Users/akira/workspace/ember/scripts/voice_chat/wake_detect.py \
   /Users/akira/workspace/ember/packages/voice-chat/wake_detect.py

cp /Users/akira/workspace/ember/scripts/voice_chat/wake_response.py \
   /Users/akira/workspace/ember/packages/voice-chat/wake_response.py
```

- [ ] **Step 2: 設定・データファイルをコピー**

```bash
cp /Users/akira/workspace/ember/scripts/voice_chat/settings.json \
   /Users/akira/workspace/ember/packages/voice-chat/settings.json

cp /Users/akira/workspace/ember/scripts/voice_chat/yomigana_map.json \
   /Users/akira/workspace/ember/packages/voice-chat/yomigana_map.json

cp /Users/akira/workspace/ember/scripts/voice_chat/stt_dict_user.json \
   /Users/akira/workspace/ember/packages/voice-chat/stt_dict_user.json

cp /Users/akira/workspace/ember/scripts/voice_chat/ambient_examples.json \
   /Users/akira/workspace/ember/packages/voice-chat/ambient_examples.json

cp /Users/akira/workspace/ember/scripts/voice_chat/ambient_rules.json \
   /Users/akira/workspace/ember/packages/voice-chat/ambient_rules.json

cp /Users/akira/workspace/ember/scripts/voice_chat/index.html \
   /Users/akira/workspace/ember/packages/voice-chat/index.html

cp /Users/akira/workspace/ember/scripts/voice_chat/.env \
   /Users/akira/workspace/ember/packages/voice-chat/.env

cp /Users/akira/workspace/ember/scripts/voice_chat/chunk_transcripts.jsonl \
   /Users/akira/workspace/ember/packages/voice-chat/chunk_transcripts.jsonl 2>/dev/null || true

cp /Users/akira/workspace/ember/scripts/voice_chat/context_summary_feedback.jsonl \
   /Users/akira/workspace/ember/packages/voice-chat/context_summary_feedback.jsonl 2>/dev/null || true
```

- [ ] **Step 3: シェルスクリプトをコピー**

```bash
cp /Users/akira/workspace/ember/scripts/voice_chat/co_view_10min_check.sh \
   /Users/akira/workspace/ember/packages/voice-chat/co_view_10min_check.sh

cp /Users/akira/workspace/ember/scripts/voice_chat/co_view_hourly_analysis.sh \
   /Users/akira/workspace/ember/packages/voice-chat/co_view_hourly_analysis.sh

chmod +x /Users/akira/workspace/ember/packages/voice-chat/co_view_10min_check.sh
chmod +x /Users/akira/workspace/ember/packages/voice-chat/co_view_hourly_analysis.sh
```

- [ ] **Step 4: ディレクトリをコピー**

```bash
cp -r /Users/akira/workspace/ember/scripts/voice_chat/tests \
      /Users/akira/workspace/ember/packages/voice-chat/tests

cp -r /Users/akira/workspace/ember/scripts/voice_chat/speaker_profiles \
      /Users/akira/workspace/ember/packages/voice-chat/speaker_profiles

cp -r /Users/akira/workspace/ember/scripts/voice_chat/docs \
      /Users/akira/workspace/ember/packages/voice-chat/docs
```

- [ ] **Step 5: コピー確認**

```bash
ls /Users/akira/workspace/ember/packages/voice-chat/
```

期待: `app.py  ambient_commands.py  ambient_listener.py  ambient_policy.py  speaker_id.py  wake_detect.py  wake_response.py  settings.json  yomigana_map.json  stt_dict_user.json  co_view_10min_check.sh  co_view_hourly_analysis.sh  tests/  speaker_profiles/  docs/  pyproject.toml  index.html  .env` 等が表示される

- [ ] **Step 6: コミット**

```bash
git -C /Users/akira/workspace/ember add packages/voice-chat/
git -C /Users/akira/workspace/ember commit -m "feat(voice-chat): copy source files from scripts/voice_chat to packages/voice-chat"
```

---

## Phase 3: 絶対パス参照を修正

### Task 4: app.py の絶対パス参照を修正

**Files:**
- Modify: `/Users/akira/workspace/ember/packages/voice-chat/app.py:868-871,4075`

**背景:**
- 旧パス・新パス共に `parents[3]` で `workspace/` に到達する（`scripts/voice_chat` も `packages/voice-chat` もネスト深さは同じ）
- `parents[0] = packages/voice-chat/`, `parents[1] = packages/`, `parents[2] = ember/`, `parents[3] = workspace/`
- よって `_SLACK_BOT_DATA_DIR` の `parents[3]` インデックス自体は変更不要
- ただし `claude-code-slack-bot` が P1 で `ember/packages/slack-bot` に移動済みの場合は参照先ディレクトリが変わるため更新が必要

- [ ] **Step 1: 実際のパスを確認してから判断**

```bash
python3 -c "
from pathlib import Path
f = Path('/Users/akira/workspace/ember/packages/voice-chat/app.py')
for i in range(5):
    print(f'parents[{i}] = {f.resolve().parents[i]}')
"
```

期待出力:
```
parents[0] = /Users/akira/workspace/ember/packages/voice-chat
parents[1] = /Users/akira/workspace/ember/packages
parents[2] = /Users/akira/workspace/ember
parents[3] = /Users/akira/workspace
parents[4] = /Users/akira
```

- [ ] **Step 2: claude-code-slack-bot/data ディレクトリの実在確認**

```bash
ls /Users/akira/workspace/claude-code-slack-bot/data 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"
```

- `EXISTS` の場合: `parents[3]` 参照はそのままで問題なし
- `NOT FOUND` の場合（P1 で ember/packages/slack-bot/data に移動済み）: 以下の変更を適用

  変更前: `str(Path(__file__).resolve().parents[3] / "claude-code-slack-bot" / "data")`  
  変更後: `str(Path(__file__).resolve().parents[2] / "packages" / "slack-bot" / "data")`

- [ ] **Step 3: BOT_STATE_DIR を修正（絶対パスをなくす）**

`/Users/akira/workspace/ember/packages/voice-chat/app.py` の 4075 行目:

変更前:
```python
BOT_STATE_DIR = Path("/Users/akira/workspace/claude-code-slack-bot/data")
```

変更後:
```python
BOT_STATE_DIR = Path(
    os.getenv("BOT_STATE_DIR",
              str(Path(__file__).resolve().parents[3] / "claude-code-slack-bot" / "data"))
)
```

注: `os` は app.py 冒頭で `import os` が既にある前提。なければ import 文を追加すること。

- [ ] **Step 4: 変更確認**

```bash
grep -n "BOT_STATE_DIR\|SLACK_BOT_DATA_DIR" /Users/akira/workspace/ember/packages/voice-chat/app.py | head -10
```

期待: ハードコードされた `/Users/akira/workspace/claude-code-slack-bot/data` が消えている

- [ ] **Step 5: コミット**

```bash
git -C /Users/akira/workspace/ember add packages/voice-chat/app.py
git -C /Users/akira/workspace/ember commit -m "fix(voice-chat): remove hardcoded absolute paths in app.py (BOT_STATE_DIR, SLACK_BOT_DATA_DIR)"
```

---

### Task 5: シェルスクリプトの WORKDIR を修正

**Files:**
- Modify: `/Users/akira/workspace/ember/packages/voice-chat/co_view_10min_check.sh:6`
- Modify: `/Users/akira/workspace/ember/packages/voice-chat/co_view_hourly_analysis.sh:7`

**背景:** 両スクリプトの `WORKDIR` が `claude-code-slack-bot` を指している。slack-bot が `ember/packages/slack-bot` に移動済みの場合は更新が必要。

- [ ] **Step 1: 現在の WORKDIR 確認と実在チェック**

```bash
grep "WORKDIR" /Users/akira/workspace/ember/packages/voice-chat/co_view_10min_check.sh
ls /Users/akira/workspace/claude-code-slack-bot 2>/dev/null && echo "EXISTS" || echo "MOVED"
```

- [ ] **Step 2: co_view_10min_check.sh の WORKDIR を修正**

`WORKDIR` の値を実在パスに合わせて変更する:

```bash
# claude-code-slack-bot が存在する場合はそのまま。移動済みの場合:
sed -i '' 's|WORKDIR="/Users/akira/workspace/claude-code-slack-bot"|WORKDIR="/Users/akira/workspace/ember/packages/slack-bot"|' \
  /Users/akira/workspace/ember/packages/voice-chat/co_view_10min_check.sh
```

- [ ] **Step 3: co_view_hourly_analysis.sh の WORKDIR を修正**

```bash
sed -i '' 's|WORKDIR="/Users/akira/workspace/claude-code-slack-bot"|WORKDIR="/Users/akira/workspace/ember/packages/slack-bot"|' \
  /Users/akira/workspace/ember/packages/voice-chat/co_view_hourly_analysis.sh
```

- [ ] **Step 4: crontab のパス参照も更新が必要か確認**

```bash
crontab -l | grep -i "voice_chat\|open-claude"
```

期待: `*/10 * * * * /Users/akira/workspace/open-claude/scripts/voice_chat/co_view_10min_check.sh` などが出る場合、crontab を更新する:

```bash
crontab -l > /tmp/crontab_backup.txt
cat /tmp/crontab_backup.txt | \
  sed 's|/Users/akira/workspace/open-claude/scripts/voice_chat/co_view_10min_check.sh|/Users/akira/workspace/ember/packages/voice-chat/co_view_10min_check.sh|g' | \
  sed 's|/Users/akira/workspace/open-claude/scripts/voice_chat/co_view_hourly_analysis.sh|/Users/akira/workspace/ember/packages/voice-chat/co_view_hourly_analysis.sh|g' \
  | crontab -
```

- [ ] **Step 5: コミット**

```bash
git -C /Users/akira/workspace/ember add \
  packages/voice-chat/co_view_10min_check.sh \
  packages/voice-chat/co_view_hourly_analysis.sh
git -C /Users/akira/workspace/ember commit -m "fix(voice-chat): update WORKDIR in cron shell scripts to new package path"
```

---

## Phase 4: 新 .venv を構築し tests を確認

### Task 6: packages/voice-chat で uv sync して .venv を構築

**Files:**
- Create: `/Users/akira/workspace/ember/packages/voice-chat/.venv/` (uv が生成)

**注意:** `uv sync` は重量パッケージ（torch 2.11GB 相当）を含むため 5〜20 分かかる可能性がある。Wi-Fi 接続を確認してから実行すること。

- [ ] **Step 1: ロールバック用に旧 .venv のパスをメモ**

```bash
echo "旧 .venv: /Users/akira/workspace/ember/scripts/voice_chat/.venv"
echo "roollback: launchd plist の ProgramArguments を旧 .venv に戻せば即回復"
```

- [ ] **Step 2: uv sync を実行**

```bash
cd /Users/akira/workspace/ember/packages/voice-chat && uv sync
```

期待終了メッセージ例:
```
Resolved N packages in Xs
Installed N packages in Xs
```

エラーが出た場合は以下で個別インストールを試みる:
```bash
cd /Users/akira/workspace/ember/packages/voice-chat && uv pip install fastapi uvicorn faster-whisper speechbrain
```

- [ ] **Step 3: .venv が生成されたことを確認**

```bash
ls /Users/akira/workspace/ember/packages/voice-chat/.venv/bin/python
```

期待: `/Users/akira/workspace/ember/packages/voice-chat/.venv/bin/python` が存在

- [ ] **Step 4: Python バージョン確認**

```bash
/Users/akira/workspace/ember/packages/voice-chat/.venv/bin/python --version
```

期待: `Python 3.14.x`

---

### Task 7: tests を実行して動作確認

**Files:**
- Test: `/Users/akira/workspace/ember/packages/voice-chat/tests/`

- [ ] **Step 1: 軽量テストを先に実行（app.py の import が通るか）**

```bash
cd /Users/akira/workspace/ember/packages/voice-chat && \
  uv run pytest tests/test_yomigana_dictionary.py -v
```

期待: `PASSED` で終了

- [ ] **Step 2: 主要テストスイートを実行**

```bash
cd /Users/akira/workspace/ember/packages/voice-chat && \
  uv run pytest tests/test_wake_detect.py tests/test_wake_response.py tests/test_ambient_commands.py -v
```

期待: 全テスト PASSED または SKIPPED（ハードウェア依存は SKIP 可）

- [ ] **Step 3: 全テスト実行**

```bash
cd /Users/akira/workspace/ember/packages/voice-chat && uv run pytest -v --timeout=60 2>&1 | tail -30
```

期待: FAILED が 0 件（import エラーや絶対パスエラーが無いこと）

- [ ] **Step 4: 失敗があった場合のデバッグ方針**

```bash
# インポートエラーの場合:
cd /Users/akira/workspace/ember/packages/voice-chat && \
  uv run python -c "import app" 2>&1 | head -20

# パス参照エラーの場合: app.py の該当行を修正してから再実行
```

---

## Phase 5: launchd plist 更新（停止時間最小化）

### Task 8: plist バックアップ → 更新 → reload

**Files:**
- Modify: `/Users/akira/Library/LaunchAgents/local.whisper.serve.plist`

**ロールバック手順（最重要 — 実行前に必ず読む）:**

```bash
# ロールバック手順:
# 1. バックアップを元に戻す
cp /tmp/local.whisper.serve.plist.bak \
   /Users/akira/Library/LaunchAgents/local.whisper.serve.plist

# 2. 旧パスで再起動
launchctl unload /Users/akira/Library/LaunchAgents/local.whisper.serve.plist
launchctl load -w /Users/akira/Library/LaunchAgents/local.whisper.serve.plist

# 3. 復旧確認
curl -s http://localhost:8767/health && echo "OK"
```

- [ ] **Step 1: plist をバックアップ**

```bash
cp /Users/akira/Library/LaunchAgents/local.whisper.serve.plist \
   /tmp/local.whisper.serve.plist.bak
cat /tmp/local.whisper.serve.plist.bak
```

バックアップ内容が表示されることを確認。

- [ ] **Step 2: 現在の voice_chat が稼働中であることを確認**

```bash
curl -s http://localhost:8767/health | head -5
```

期待: JSON レスポンスが返る（`{"status":"ok"}` など）

- [ ] **Step 3: launchd をアンロード（ここから停止時間開始）**

```bash
launchctl unload /Users/akira/Library/LaunchAgents/local.whisper.serve.plist
```

- [ ] **Step 4: plist を新パスに更新**

`/Users/akira/Library/LaunchAgents/local.whisper.serve.plist` の内容を以下に完全置換する:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>local.whisper.serve</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/akira/workspace/ember/packages/voice-chat/.venv/bin/python</string>
        <string>app.py</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/akira/workspace/ember/packages/voice-chat</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/whisper-serve.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/whisper-serve.log</string>
</dict>
</plist>
```

- [ ] **Step 5: launchd をロード（停止時間終了）**

```bash
launchctl load -w /Users/akira/Library/LaunchAgents/local.whisper.serve.plist
```

- [ ] **Step 6: 起動確認（最大 30 秒待つ）**

```bash
# 起動ログを確認（モデル読み込み中のため 20〜30 秒かかることがある）
sleep 5 && tail -30 /tmp/whisper-serve.log
```

期待ログ: `Uvicorn running on http://0.0.0.0:8767` のような行が出る

- [ ] **Step 7: ヘルスチェック**

```bash
sleep 20 && curl -s http://localhost:8767/health
```

期待: `{"status":"ok"}` または同等の JSON レスポンス

**失敗した場合は直ちにロールバック手順（Task 8 冒頭）を実行する。**

- [ ] **Step 8: plist の変更を git に記録（ファイルは git 管理外だがコミットコメントで記録）**

```bash
git -C /Users/akira/workspace/ember commit --allow-empty \
  -m "ops: update launchd plist local.whisper.serve to packages/voice-chat (not in git)"
```

---

## Phase 6: ember-chat を packages/ember-chat/ に移植

### Task 9: ember-chat ファイル群をコピー

**Files:**
- Create: `/Users/akira/workspace/ember/packages/ember-chat/` 配下の各ファイル

- [ ] **Step 1: JS/HTML ファイルをコピー**

```bash
cp /Users/akira/workspace/ember/scripts/ember-chat/main.js \
   /Users/akira/workspace/ember/packages/ember-chat/main.js

cp /Users/akira/workspace/ember/scripts/ember-chat/preload.js \
   /Users/akira/workspace/ember/packages/ember-chat/preload.js

mkdir -p /Users/akira/workspace/ember/packages/ember-chat/renderer
cp /Users/akira/workspace/ember/scripts/ember-chat/renderer/index.html \
   /Users/akira/workspace/ember/packages/ember-chat/renderer/index.html
cp /Users/akira/workspace/ember/scripts/ember-chat/renderer/recorder.js \
   /Users/akira/workspace/ember/packages/ember-chat/renderer/recorder.js
cp /Users/akira/workspace/ember/scripts/ember-chat/renderer/always-on.js \
   /Users/akira/workspace/ember/packages/ember-chat/renderer/always-on.js
```

- [ ] **Step 2: アイコン・アセットをコピー**

```bash
cp /Users/akira/workspace/ember/scripts/ember-chat/AppIcon.icns \
   /Users/akira/workspace/ember/packages/ember-chat/AppIcon.icns

cp -r /Users/akira/workspace/ember/scripts/ember-chat/AppIcon.iconset \
      /Users/akira/workspace/ember/packages/ember-chat/AppIcon.iconset

cp /Users/akira/workspace/ember/scripts/ember-chat/ember-flame.svg \
   /Users/akira/workspace/ember/packages/ember-chat/ember-flame.svg

cp /Users/akira/workspace/ember/scripts/ember-chat/icon.png \
   /Users/akira/workspace/ember/packages/ember-chat/icon.png

cp /Users/akira/workspace/ember/scripts/ember-chat/icon-1024.png \
   /Users/akira/workspace/ember/packages/ember-chat/icon-1024.png

cp /Users/akira/workspace/ember/scripts/ember-chat/squircle-mask.png \
   /Users/akira/workspace/ember/packages/ember-chat/squircle-mask.png

mkdir -p /Users/akira/workspace/ember/packages/ember-chat/tray-icons
cp /Users/akira/workspace/ember/scripts/ember-chat/tray-icons/listening.png \
   /Users/akira/workspace/ember/packages/ember-chat/tray-icons/listening.png
cp /Users/akira/workspace/ember/scripts/ember-chat/tray-icons/muted.png \
   /Users/akira/workspace/ember/packages/ember-chat/tray-icons/muted.png
```

- [ ] **Step 3: recordings ディレクトリを作成（ファイルはコピーしない — 録音データは新場所でリセット）**

```bash
mkdir -p /Users/akira/workspace/ember/packages/ember-chat/recordings
touch /Users/akira/workspace/ember/packages/ember-chat/recordings/.gitkeep
```

- [ ] **Step 4: コピー確認**

```bash
ls /Users/akira/workspace/ember/packages/ember-chat/
```

期待: `main.js  preload.js  renderer/  AppIcon.icns  AppIcon.iconset/  icon.png  icon-1024.png  tray-icons/  recordings/  package.json` が存在

---

### Task 10: packages/ember-chat/package.json を更新

**Files:**
- Modify: `/Users/akira/workspace/ember/packages/ember-chat/package.json`

- [ ] **Step 1: package.json を本番用に更新**

`/Users/akira/workspace/ember/packages/ember-chat/package.json` を以下に置換する:

```json
{
  "name": "@ember/chat",
  "version": "1.0.0",
  "description": "Ember Chat — Voice & Text chat with AI assistants (P6 で React shell 化予定)",
  "main": "main.js",
  "private": true,
  "scripts": {
    "start": "electron .",
    "dev": "NODE_ENV=development electron .",
    "build": "electron-builder --mac"
  },
  "author": "Akira",
  "license": "MIT",
  "devDependencies": {
    "electron": "^35.0.0",
    "electron-builder": "^26.0.0"
  },
  "build": {
    "appId": "com.ember.chat",
    "productName": "Ember Chat",
    "mac": {
      "category": "public.app-category.productivity",
      "target": "dir",
      "icon": "AppIcon.icns"
    },
    "files": [
      "main.js",
      "preload.js",
      "renderer/**/*",
      "tray-icons/**/*",
      "*.png",
      "*.svg",
      "*.icns"
    ]
  },
  "dependencies": {
    "@ricky0123/vad-web": "^0.0.30"
  }
}
```

---

### Task 11: main.js の AUDIO_FIXTURE_INCOMING_DIR パスを修正

**Files:**
- Modify: `/Users/akira/workspace/ember/packages/ember-chat/main.js:8`

**背景:** `scripts/ember-chat/main.js:8` は `'../voice_chat/tests/fixtures/audio/incoming'` を参照している。新配置では `packages/ember-chat/` と `packages/voice-chat/` が兄弟ディレクトリなので参照は `'../voice-chat/tests/fixtures/audio/incoming'` に変更する。

- [ ] **Step 1: 現在の参照を確認**

```bash
grep -n "AUDIO_FIXTURE" /Users/akira/workspace/ember/packages/ember-chat/main.js
```

期待:
```
8:const AUDIO_FIXTURE_INCOMING_DIR = path.resolve(__dirname, '../voice_chat/tests/fixtures/audio/incoming');
```

- [ ] **Step 2: パスを修正**

変更前:
```javascript
const AUDIO_FIXTURE_INCOMING_DIR = path.resolve(__dirname, '../voice_chat/tests/fixtures/audio/incoming');
```

変更後:
```javascript
const AUDIO_FIXTURE_INCOMING_DIR = path.resolve(__dirname, '../voice-chat/tests/fixtures/audio/incoming');
```

- [ ] **Step 3: 変更確認**

```bash
grep -n "AUDIO_FIXTURE" /Users/akira/workspace/ember/packages/ember-chat/main.js
```

期待: `'../voice-chat/tests/fixtures/audio/incoming'`（ハイフン）になっている

---

### Task 12: npm install と動作確認

**Files:**
- Create: `/Users/akira/workspace/ember/packages/ember-chat/node_modules/` (npm が生成)

- [ ] **Step 1: npm install を実行**

```bash
cd /Users/akira/workspace/ember/packages/ember-chat && npm install
```

期待: `added N packages` で終了、エラーなし

- [ ] **Step 2: Electron バージョン確認**

```bash
cd /Users/akira/workspace/ember/packages/ember-chat && \
  ./node_modules/.bin/electron --version
```

期待: `v35.x.x`

- [ ] **Step 3: ember-chat が起動できることを確認**

```bash
cd /Users/akira/workspace/ember/packages/ember-chat && npm start &
sleep 5 && echo "Electron started. Check Dock/tray for Ember Chat window."
```

GUI ウィンドウが起動し、クラッシュしないことを目視確認する。  
確認後、Dock から Ember Chat を終了するか `kill %1` で停止する。

- [ ] **Step 4: コミット**

```bash
git -C /Users/akira/workspace/ember add \
  packages/ember-chat/main.js \
  packages/ember-chat/preload.js \
  packages/ember-chat/renderer/ \
  packages/ember-chat/package.json \
  packages/ember-chat/AppIcon.icns \
  packages/ember-chat/AppIcon.iconset/ \
  packages/ember-chat/ember-flame.svg \
  packages/ember-chat/icon.png \
  packages/ember-chat/icon-1024.png \
  packages/ember-chat/squircle-mask.png \
  packages/ember-chat/tray-icons/ \
  packages/ember-chat/recordings/.gitkeep
git -C /Users/akira/workspace/ember commit -m "feat(ember-chat): migrate from scripts/ember-chat to packages/ember-chat"
```

---

## Phase 7: .gitignore 更新

### Task 13: .gitignore に新パスを追加

**Files:**
- Modify: `/Users/akira/workspace/ember/.gitignore`

- [ ] **Step 1: 現在の .gitignore を確認**

```bash
cat /Users/akira/workspace/ember/.gitignore | grep -i "venv\|jsonl\|recordings\|node_modules"
```

- [ ] **Step 2: 不足エントリを追加**

以下が .gitignore に含まれているか確認し、無ければ追加する:

```gitignore
# voice-chat
packages/voice-chat/.venv/
packages/voice-chat/chunk_transcripts.jsonl
packages/voice-chat/context_summary_feedback.jsonl
packages/voice-chat/speaker_profiles/
packages/voice-chat/__pycache__/
packages/voice-chat/**/__pycache__/
packages/voice-chat/.pytest_cache/

# ember-chat
packages/ember-chat/node_modules/
packages/ember-chat/recordings/*.webm
packages/ember-chat/recordings/*.txt
```

- [ ] **Step 3: コミット**

```bash
git -C /Users/akira/workspace/ember add .gitignore
git -C /Users/akira/workspace/ember commit -m "chore: update .gitignore for packages/voice-chat and packages/ember-chat"
```

---

## Phase 8: 旧 scripts/ の削除（別コミット）

### Task 14: scripts/voice_chat と scripts/ember-chat を削除

**前提:** Phase 1〜7 が全て完了し、以下が確認済みであること:
- `curl http://localhost:8767/health` が OK を返す（新パスからの launchd 起動）
- `cd packages/voice-chat && uv run pytest` が通る
- `cd packages/ember-chat && npm start` で Electron が起動する

- [ ] **Step 1: 最終確認チェック**

```bash
echo "=== voice_chat health ===" && curl -s http://localhost:8767/health
echo ""
echo "=== tests ===" && cd /Users/akira/workspace/ember/packages/voice-chat && uv run pytest -q 2>&1 | tail -5
```

- [ ] **Step 2: 旧 voice_chat を削除**

```bash
rm -rf /Users/akira/workspace/ember/scripts/voice_chat
```

- [ ] **Step 3: 旧 ember-chat を削除（node_modules ごと）**

```bash
rm -rf /Users/akira/workspace/ember/scripts/ember-chat
```

- [ ] **Step 4: scripts/ ディレクトリが空になったことを確認**

```bash
ls /Users/akira/workspace/ember/scripts/
```

期待: 空（他に scripts 配下にディレクトリがあれば残る — 削除しない）

- [ ] **Step 5: コミット**

```bash
git -C /Users/akira/workspace/ember add -A
git -C /Users/akira/workspace/ember commit -m "chore(cleanup): remove scripts/voice_chat and scripts/ember-chat after successful migration to packages/"
```

---

## 完了条件 (DoD)

以下が全て満たされた時点で P2 完了:

1. `curl -s http://localhost:8767/health` が JSON を返す（新 `.venv` + 新 `WorkingDirectory` で launchd 稼働中）
2. `launchctl list | grep whisper` が PID 付きで表示される（クラッシュなし）
3. `cd /Users/akira/workspace/ember/packages/voice-chat && uv run pytest -q` が FAILED 0 件で終了
4. `cd /Users/akira/workspace/ember/packages/ember-chat && npm start` で Ember Chat ウィンドウが起動する
5. `scripts/voice_chat/` および `scripts/ember-chat/` が削除済み（git 履歴には残る）
6. `crontab -l` に `open-claude` や `scripts/voice_chat` の古いパスが残っていない

---

## ロールバック一覧（緊急時参照）

| 問題 | ロールバック手順 |
|------|-----------------|
| launchd reload 後に voice_chat が起動しない | `cp /tmp/local.whisper.serve.plist.bak ~/Library/LaunchAgents/local.whisper.serve.plist && launchctl unload ~/Library/LaunchAgents/local.whisper.serve.plist && launchctl load -w ~/Library/LaunchAgents/local.whisper.serve.plist` |
| uv sync が失敗して .venv が壊れた | `rm -rf packages/voice-chat/.venv && cd packages/voice-chat && uv sync --no-build-isolation` |
| ember-chat の npm install が失敗 | `rm -rf packages/ember-chat/node_modules && cd packages/ember-chat && npm install --legacy-peer-deps` |
| 旧 scripts/ を先に削除してしまった | `git -C /Users/akira/workspace/ember checkout HEAD~1 -- scripts/voice_chat scripts/ember-chat` |
| crontab を更新したが動かない | `crontab /tmp/crontab_backup.txt`（Task 5 Step 4 で保存済み） |
