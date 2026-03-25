# セッション振り返りスキル群 + Wrap 行動パターンレビュー 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** セッション中に繰り返されるワークフローをスキル化し、Wrap 時にエージェント自身が未スキル化パターンを検知・提案する仕組みを追加する

**Architecture:** 3つの独立タスク。(1) cogmem-release スキル新規作成、(2) agents.md の Wrap に行動パターンレビュー Step 追加、(3) tdd-dashboard-dev スキルの改善。全てスキルファイル（.claude/skills/）と agents.md の編集のみ。コードベースのテストは不要。

**Tech Stack:** Markdown (YAML frontmatter)

---

## ファイル構成

| ファイル | 役割 |
|---------|------|
| `~/.claude/skills/cogmem-release/SKILL.md` (新規) | PyPI リリースワークフローのスキル |
| `/Users/akira/workspace/open-claude/identity/agents.md` (修正) | Wrap に行動パターンレビュー Step 追加 |
| `~/.claude/skills/tdd-dashboard-dev/SKILL.md` (修正) | ダッシュボード TDD スキルの改善 |

---

### Task 1: cogmem-release スキル作成

**Files:**
- Create: `~/.claude/skills/cogmem-release/SKILL.md`

- [ ] **Step 1: スキルファイルを作成**

```markdown
---
name: cogmem-release
description: cogmem-agent の PyPI リリースワークフロー。バージョンバンプ、テスト、ビルド、アップロード、ローカル更新、動作確認を一貫して実行する。「リリースして」「PyPIに公開」「バージョンアップ」等で起動。
---

# cogmem-agent PyPI リリース

## 前提条件
- PyPI トークン: `open-claude/.env` の `pypi=` に保存
- ビルドツール: `python3 -m build`, `twine`
- 作業ディレクトリ: `/Users/akira/workspace/ai-dev/cognitive-memory-lib`

## 手順

### Step 1: バージョン決定
ユーザーにバージョンを確認する。ガイドライン:
- パッチ (0.x.Y): バグ修正、小さな改善
- マイナー (0.X.0): 新機能追加（コマンド追加、テンプレート変更等）
- メジャー (X.0.0): 破壊的変更

現在のバージョンを確認:
```bash
cat /Users/akira/workspace/ai-dev/cognitive-memory-lib/src/cognitive_memory/_version.py
```

### Step 2: 全テスト実行
```bash
cd /Users/akira/workspace/ai-dev/cognitive-memory-lib
python3 -m pytest tests/ --timeout=30 -q
```
**全テストパスが必須。** 1件でも失敗したらリリースしない。

### Step 3: バージョンバンプ
`src/cognitive_memory/_version.py` の `__version__` を更新。

### Step 4: ビルド
```bash
cd /Users/akira/workspace/ai-dev/cognitive-memory-lib
rm -rf dist/
python3 -m build
```
`Successfully built` を確認。

### Step 5: PyPI アップロード
```bash
cd /Users/akira/workspace/ai-dev/cognitive-memory-lib
source /Users/akira/workspace/open-claude/.env
python3 -m twine upload dist/cogmem_agent-X.Y.Z* --username __token__ --password "$pypi"
```
URL `https://pypi.org/project/cogmem-agent/X.Y.Z/` を確認。

### Step 6: ローカル更新
```bash
pip install --upgrade --no-cache-dir cogmem-agent
cogmem --help
```
バージョンが更新されていることを確認。

### Step 7: コミット
```bash
cd /Users/akira/workspace/ai-dev/cognitive-memory-lib
git add src/cognitive_memory/_version.py
git commit -m "release: cogmem-agent X.Y.Z — 変更概要"
```

### Step 8: 動作確認
open-claude ディレクトリで実際のコマンドを実行して動作確認:
```bash
cd /Users/akira/workspace/open-claude
cogmem status
```

## やらないこと
- git tag の作成（現時点では不要）
- CHANGELOG の更新（コミットメッセージで十分）
- GitHub Release の作成（リモートなし）
```

- [ ] **Step 2: cogmem skills learn を実行**

```bash
cd /Users/akira/workspace/open-claude && cogmem skills learn \
  --context "cogmem-release スキル作成" \
  --outcome "9回のリリース経験からワークフローをスキル化" \
  --effectiveness 0.8
```

- [ ] **Step 3: 動作確認**

スキル一覧に表示されることを確認:
```bash
ls ~/.claude/skills/cogmem-release/SKILL.md
```

---

### Task 2: Wrap に行動パターンレビュー Step 追加

**Files:**
- Modify: `/Users/akira/workspace/open-claude/identity/agents.md`

- [ ] **Step 1: agents.md の Wrap セクションに Step 3.8 を追加**

Step 3.7（スキル改善）の後、Step 4（knowledge summary 更新）の前に追加:

```markdown
3.8. 行動パターンレビュー（未スキル化ワークフローの検知）:
     セッション中のログエントリと git コミットを振り返り、以下を確認:
     a. 同じ手順（コマンド列やファイル編集パターン）を3回以上繰り返したか
     b. 既存スキルに含まれないワークフローを実行したか
     c. 上記に該当する場合、引き継ぎに「スキル化候補: [パターン名]（理由）」を追記
     d. 該当しない場合はスキップ（出力なし）
     注意: これはエージェント自身の内省で行う。ツール実行は不要。
```

- [ ] **Step 2: コミット**

```bash
cd /Users/akira/workspace/open-claude
git add identity/agents.md
git commit -m "feat: add Wrap Step 3.8 — behavioral pattern review for skill candidates"
```

---

### Task 3: tdd-dashboard-dev スキル改善

**Files:**
- Modify: `~/.claude/skills/tdd-dashboard-dev/SKILL.md`

- [ ] **Step 1: 既存スキルを読んで改善点を確認**

現在のスキル（64行）は基本的なチェックリストのみ。このセッションの教訓を追加:
- cwd 依存で間違った DB を読んだ問題の具体的な防止策
- conftest の設計パターン（rich fixture data）
- FastAPI TestClient の使い方
- Jinja2 テンプレートのテスト方法

- [ ] **Step 2: スキルファイルを更新**

以下のセクションを追加:

```markdown
## FastAPI + Jinja2 テストパターン

### TestClient セットアップ
```python
from fastapi.testclient import TestClient

@pytest.fixture
def client(tmp_path):
    """テスト用 DB と設定で隔離された TestClient を作成"""
    # 1. tmp_path に cogmem.toml を作成
    # 2. tmp_path に必要な DB とデータを配置
    # 3. アプリを tmp_path の設定で初期化
    # 4. TestClient(app) を返す
```

### HTML レンダリング検証の具体例
```python
def test_skills_page_shows_all_data(client):
    resp = client.get("/skills/")
    assert resp.status_code == 200

    # 列ヘッダーの存在
    for col in ["Name", "Category", "Effectiveness"]:
        assert col in resp.text

    # テストデータの値が HTML に含まれる
    assert ">25<" in resp.text  # execution_count
    assert "0.92" in resp.text  # effectiveness

    # ソート順（出現位置で検証）
    assert resp.text.index("skill-a") < resp.text.index("skill-b")
```

## cwd 依存の防止

### 問題
`CogMemConfig.find_and_load()` は cwd から `cogmem.toml` を探す。
`pip install` 等で cwd が変わると、意図しない設定を読む。

### 対策
- テストでは必ず `monkeypatch.chdir(tmp_path)` で隔離
- 本番では `cd /Users/akira/workspace/open-claude && cogmem dashboard` で起動
- CI では `cwd` を明示的に設定

## conftest 設計原則

- テストデータは**バリエーション豊か**にする（1件だけはNG）
- 数値は全て異なる値にする（0, 1, 25, 100 等）
- effectiveness は 0.0〜1.0 の範囲で複数パターン
- category は2種類以上（ソート・フィルタのテスト用）
```

- [ ] **Step 3: cogmem skills learn を実行**

```bash
cd /Users/akira/workspace/open-claude && cogmem skills learn \
  --context "tdd-dashboard-dev スキル改善" \
  --outcome "FastAPI+Jinja2テストパターンとcwd問題の防止策を追加" \
  --effectiveness 0.7
```

---

## 検証方法

1. `~/.claude/skills/cogmem-release/SKILL.md` が存在し、Claude Code のスキル一覧に表示される
2. `identity/agents.md` の Wrap セクションに Step 3.8 が追加されている
3. `~/.claude/skills/tdd-dashboard-dev/SKILL.md` に新セクションが追加されている
4. 次回の Wrap 実行時に Step 3.8 が動作する（行動パターンレビューが引き継ぎに反映される）
