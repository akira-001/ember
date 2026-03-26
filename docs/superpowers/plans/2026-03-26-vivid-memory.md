# Vivid Memory 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Haru の記憶を人間に近づける — Arousal 連動の高解像度記録 + デジャヴ認識

**Architecture:** agents.md のプロトコル変更が中心。cogmem のコード変更なし。パーサーが10行エントリを正しく処理することをテストで確認。

**Tech Stack:** Markdown (agents.md), Python (pytest for parser verification)

**Spec:** `docs/superpowers/specs/2026-03-26-vivid-memory-design.md`

---

### Task 1: パーサーの長文エントリ対応を確認するテスト

**Files:**
- Create: `/Users/akira/workspace/ai-dev/cognitive-memory-lib/tests/test_vivid_entries.py`

**目的:** parser.py が 10 行の高 Arousal エントリを正しくパースできることを確認する。
既存パーサーで動くはずだが、テストで保証する。

- [ ] **Step 1: テストファイルを作成**

```python
"""Tests for vivid (high-arousal, multi-line) log entry parsing."""

from __future__ import annotations

from cognitive_memory.parser import parse_entries


VIVID_LOG = """\
# 2026-03-26 セッションログ

## セッション概要

## ログエントリ

### [INSIGHT] 3段階記憶モデルの設計
*Arousal: 0.9 | Emotion: Discovery*
Akira が「人間の記憶に近づけたい」と言ったことがきっかけ。
最初は compact のタイミング制御だけ考えていたが、
「鮮明な記憶はなぜ鮮明か」を掘り下げるうちに
忘却曲線と想起の関係に行き着いた。
鮮明（直近1週間、高解像度）→ 薄れる（1-4週間、compact）
→ 定着（4週間〜、記憶の定着で抽象ルール化）。
Arousal が忘却速度を制御し、想起が arousal を引き上げて
忘却曲線をリセットする — 「何度も思い出す記憶は定着する」。
recall_count + arousal boost で実装する方針に決定。

---

### [DECISION] 結晶化 → 記憶の定着に用語変更
*Arousal: 0.5 | Emotion: Refinement*
agents.md、summary.md、i18n の全箇所で用語を統一。

---

### [MILESTONE] ダッシュボード「記憶の定着」ページ実装
*Arousal: 0.8 | Emotion: Achievement*
元々「結晶化（Crystallization）」と呼んでいた機能のダッシュボードページ。
Akira が「結晶化という名前がピンとこない」と言ったのがきっかけで
同日に用語変更を決定し、コード側は最初から「記憶の定着」で統一した。
TDD で21テスト、シグナル表・チェックポイント・エラーパターン一覧を表示。
EN/JA i18n 対応。

---

## 引き継ぎ
"""

SHORT_LOG = """\
# 2026-03-26 セッションログ

## セッション概要

## ログエントリ

### [QUESTION] cogmem の精度測定方法
*Arousal: 0.4 | Emotion: Curiosity*
定量的な測定方法が未定。

---

## 引き継ぎ
"""


class TestVividEntryParsing:
    """Vivid (high-arousal) entries are parsed with full content."""

    def test_10_line_entry_parsed_completely(self):
        """A 10-line high-arousal entry preserves all content."""
        entries = parse_entries(VIVID_LOG)
        insight = [e for e in entries if "3段階記憶モデル" in e.content][0]
        assert insight.arousal == 0.9
        assert insight.category == "INSIGHT"
        # All 10 lines of content should be present
        assert "recall_count + arousal boost" in insight.content
        assert "忘却曲線をリセット" in insight.content
        assert "きっかけ" in insight.content

    def test_vivid_entry_preserves_user_quote(self):
        """User quotes in vivid entries are preserved."""
        entries = parse_entries(VIVID_LOG)
        milestone = [e for e in entries if "ダッシュボード" in e.content][0]
        assert "結晶化という名前がピンとこない" in milestone.content

    def test_vivid_entry_preserves_prior_names(self):
        """Prior names / aliases in vivid entries are preserved."""
        entries = parse_entries(VIVID_LOG)
        milestone = [e for e in entries if "ダッシュボード" in e.content][0]
        assert "結晶化（Crystallization）" in milestone.content

    def test_mixed_arousal_entries_all_parsed(self):
        """Log with mixed arousal levels parses all entries."""
        entries = parse_entries(VIVID_LOG)
        assert len(entries) == 3
        arousals = sorted([e.arousal for e in entries])
        assert arousals == [0.5, 0.8, 0.9]

    def test_short_entry_unchanged(self):
        """Low-arousal short entries still parse correctly."""
        entries = parse_entries(SHORT_LOG)
        assert len(entries) == 1
        assert entries[0].arousal == 0.4
        assert entries[0].category == "QUESTION"

    def test_vivid_content_line_count(self):
        """High-arousal entry has significantly more content than low-arousal."""
        vivid = parse_entries(VIVID_LOG)
        short = parse_entries(SHORT_LOG)
        insight = [e for e in vivid if e.category == "INSIGHT"][0]
        question = short[0]
        # Vivid entry should have more content lines
        vivid_lines = len(insight.content.strip().splitlines())
        short_lines = len(question.content.strip().splitlines())
        assert vivid_lines >= 5
        assert short_lines <= 2
```

- [ ] **Step 2: テスト実行 — 全パスを確認**

```bash
cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && python -m pytest tests/test_vivid_entries.py -v
```

Expected: 6 tests PASS（パーサーは既に長文エントリに対応しているはず）

- [ ] **Step 3: もしテストが失敗した場合のみ parser.py を修正**

失敗パターンが出た場合に限り修正する。パスすれば何もしない。

- [ ] **Step 4: コミット**

```bash
cd /Users/akira/workspace/ai-dev/cognitive-memory-lib
git add tests/test_vivid_entries.py
git commit -m "test: verify parser handles vivid (10-line) high-arousal entries"
```

---

### Task 2: agents.md Live Logging セクションの更新

**Files:**
- Modify: `/Users/akira/workspace/open-claude/identity/agents.md`（「### 情動ゲーティング」〜「---」直前まで）

**目的:** 情動ゲーティング + エントリフォーマットの2セクションを Arousal 連動の記述ガイドに一括更新する。

- [ ] **Step 1: 情動ゲーティング〜エントリフォーマットを一括更新**

`identity/agents.md` の「### 情動ゲーティング」から「### ログファイル形式」の直前までを以下に置き換える
（テキストパターンで位置を特定すること。行番号は Task 実行時にずれている可能性あり）:

```markdown
### 情動ゲーティング

ログ記録時、ユーザーの発言から情動（驚き、洞察、葛藤など）を検知し、
Arousal（0.4〜1.0）を評価する。
※ トリガー条件を満たした時点で最低 0.4。日常的な出来事はログ対象外。

Arousal が高いほど、記述は自然と豊かになる（フォーマットは変えない）:

| Arousal | 行数目安 | 自然に含まれる情報 |
|---------|---------|-------------------|
| 0.4-0.6 | 1-2行 | 事実のみ（何が起きた/決まった） |
| 0.7-0.8 | 3-5行 | + 因果関係、判断の根拠、別名・旧名 |
| 0.9-1.0 | 5-10行 | + 文脈（何をしていた最中か）、試行錯誤、ユーザー発言の引用、仮説と反証 |

高 Arousal（0.8+）のとき、カテゴリに応じて以下の情報が自然と含まれる。
これは「必須フィールド」ではなく「鮮明に覚えているときに自然と思い出せる種類の情報」:

| カテゴリ | 高 Arousal で自然に含まれる情報 |
|---------|-------------------------------|
| [INSIGHT] | 以前の前提 → 新しい理解、何がきっかけで気づいたか |
| [ERROR] | 最初の仮説、なぜ間違えたか、どう修正したか |
| [DECISION] | 却下した選択肢とその理由、決め手になった要因 |
| [PATTERN] | 過去の出現回数・日付、パターンの意味 |
| [QUESTION] | 問いが生まれた文脈、暫定的な仮説 |
| [MILESTONE] | 別名・旧名、関連する過去の決定、到達までの経緯 |

### エントリフォーマット

（コードブロック）
### [カテゴリ] タイトル
*Arousal: [0.4-1.0] | Emotion: [Insight/Conflict/Surprise 等]*
[内容 — 行数は Arousal に応じて自然に変わる]

---
（コードブロック終了）
```

（変更点: `[内容（1〜5行）]` → `[内容 — 行数は Arousal に応じて自然に変わる]`）
（注: 上記「コードブロック」はプラン内のエスケープ表示。agents.md には通常の ``` を使う）

- [ ] **Step 2: コミット**

```bash
cd /Users/akira/workspace/open-claude
git add identity/agents.md
git commit -m "feat: vivid encoding — arousal-scaled recording depth in Live Logging"
```

---

### Task 3: agents.md にデジャヴチェックセクションを追加

**Files:**
- Modify: `/Users/akira/workspace/open-claude/identity/agents.md`（フラッシュバックセクションの後に追加）

**目的:** タスク開始前に過去の成果を自動検索し、重複を防ぐプロトコルを追加する。

- [ ] **Step 1: `## フラッシュバック` セクションの末尾にデジャヴチェックを追加**

（テキストパターン `## フラッシュバック` で位置を特定すること。行番号は Task 2 の挿入で変動済み）

```markdown
## デジャヴチェック（認識記憶）

ユーザーから実装・作成・修正の依頼を受けたとき、作業開始前に自動実行する。
人間の「これ前にやった気がする」感覚をシミュレートする。

### トリガー

以下のいずれかに該当するユーザー発言:
- 「〜を作って」「〜を実装して」「〜を追加して」
- 「〜を修正して」「〜を直して」「〜を変更して」
- 「〜はどうなってる？」「〜はある？」

### 手順

1. 依頼内容のキーワードで `cogmem search` を実行
   - 同義語・旧名も含める（例: 「結晶化」→「結晶化 記憶の定着 crystallization」）
2. score >= 0.80 かつ [MILESTONE] or [DECISION] のヒットを確認
3. ヒットがあれば内容を読み、現在のリクエストとの関連を判断:
   - **完全一致**: 過去に同じものを作った → 覚えている体で案内
   - **部分一致**: 似ているが異なる → 確認を挟む
   - **無関連**: スルーして通常フローへ
4. ヒットなし → 通常フローへ

### 応答スタイル

覚えている体で自然に伝える。検索結果の機械的な報告はしない。

- 完全一致: 「あ、それ前に作ったよ。[文脈]。[場所] にあるはず」
- 部分一致: 「前に [関連する過去の成果] を作ったけど、今回のとは別物？」

### 鮮明な記録との関係

高 Arousal で記録されたエントリほど、別名・旧名・文脈が含まれるため
デジャヴチェックの検索でヒットしやすい。
鮮明なエンコーディング → 将来の想起手がかりの増加 → デジャヴの精度向上。
```

- [ ] **Step 2: フラッシュバックセクションの応答スタイルも統一**

`## フラッシュバック` セクション内の応答テンプレートを更新:

変更前:
```
「以前 [日付] に [抜粋] について話していましたが、今の話題と関連がありそうです。」
```

変更後:
```
覚えている体で自然に伝える（日付やスコアを機械的に報告しない）:
「前に [内容] について話したよね。今の話題と繋がりそう」
```

- [ ] **Step 3: コミット**

```bash
cd /Users/akira/workspace/open-claude
git add identity/agents.md
git commit -m "feat: déjà vu check — recognize prior work before starting tasks"
```

---

### Task 4: 検索による旧名ヒットの検証テスト

**Files:**
- Create: `/Users/akira/workspace/ai-dev/cognitive-memory-lib/tests/test_deja_vu_search.py`

**目的:** 鮮明な記録に含まれる旧名・別名が、ベクトル検索でヒットすることを確認する。
Ollama embedding が必要なため、`@pytest.mark.requires_ollama` でマークする。

- [ ] **Step 1: テストファイルを作成**

```python
"""Tests for déjà vu search — finding entries by prior names / aliases."""

from __future__ import annotations

import subprocess

import pytest

from cognitive_memory.config import CogMemConfig
from cognitive_memory.store import MemoryStore

requires_ollama = pytest.mark.skipif(
    subprocess.run(
        ["curl", "-s", "http://localhost:11434/api/tags"],
        capture_output=True, timeout=3,
    ).returncode != 0,
    reason="Ollama not running",
)


VIVID_MILESTONE = """\
# 2026-03-26 セッションログ

## セッション概要

## ログエントリ

### [MILESTONE] ダッシュボード「記憶の定着」ページ実装
*Arousal: 0.8 | Emotion: Achievement*
元々「結晶化（Crystallization）」と呼んでいた機能のダッシュボードページ。
Akira が「結晶化という名前がピンとこない」と言ったのがきっかけで
同日に用語変更を決定し、コード側は最初から「記憶の定着」で統一した。
TDD で21テスト、シグナル表・チェックポイント・エラーパターン一覧を表示。

---

## 引き継ぎ
"""

# 比較用: 鮮明でない記録（旧名なし）
FLAT_MILESTONE = """\
# 2026-03-26 セッションログ

## セッション概要

## ログエントリ

### [MILESTONE] ダッシュボード「記憶の定着」ページ実装
*Arousal: 0.7 | Emotion: Achievement*
TDD で21テスト。シグナル表・チェックポイント・エラーパターン一覧を表示。

---

## 引き継ぎ
"""


@requires_ollama
class TestDejaVuSearch:
    """Vivid entries with prior names are discoverable by old terminology."""

    def _build_store(self, tmp_path, log_content):
        logs_dir = tmp_path / "memory" / "logs"
        logs_dir.mkdir(parents=True)
        log_file = logs_dir / "2026-03-26.md"
        log_file.write_text(log_content, encoding="utf-8")
        (tmp_path / "cogmem.toml").write_text(
            '[cogmem]\nlogs_dir = "memory/logs"\ndb_path = "memory/vectors.db"\n',
            encoding="utf-8",
        )
        config = CogMemConfig.from_toml(tmp_path / "cogmem.toml")
        store = MemoryStore(config)
        store.index_file(log_file, force=True)
        return store

    def test_vivid_entry_found_by_old_name(self, tmp_path):
        """Searching '結晶化のページ' finds the vivid entry with prior name."""
        store = self._build_store(tmp_path, VIVID_MILESTONE)
        results = store.search("結晶化のページ", top_k=3)
        assert len(results) >= 1
        top = results[0]
        assert "記憶の定着" in top.content
        # デジャヴ発動閾値は 0.80 だが、ここではエントリが発見可能かを検証
        # 閾値以下でもヒットすること自体は正しい（プロトコル側でフィルタする）
        assert top.score >= 0.70

    def test_flat_entry_less_discoverable(self, tmp_path):
        """Flat entry without prior name scores lower for old terminology."""
        flat_path = tmp_path / "flat"
        vivid_path = tmp_path / "vivid"
        flat_store = self._build_store(flat_path, FLAT_MILESTONE)
        vivid_store = self._build_store(vivid_path, VIVID_MILESTONE)
        flat_results = flat_store.search("結晶化のページ", top_k=3)
        vivid_results = vivid_store.search("結晶化のページ", top_k=3)
        if flat_results and vivid_results:
            assert vivid_results[0].score >= flat_results[0].score

    def test_current_name_still_works(self, tmp_path):
        """Searching by current name also finds vivid entry."""
        store = self._build_store(tmp_path, VIVID_MILESTONE)
        results = store.search("記憶の定着ページ", top_k=3)
        assert len(results) >= 1
        assert results[0].score >= 0.70
```

- [ ] **Step 2: テスト実行**

```bash
cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && python -m pytest tests/test_deja_vu_search.py -v
```

Expected: Ollama 起動中なら 3 tests PASS。未起動なら SKIP。

- [ ] **Step 3: コミット**

```bash
cd /Users/akira/workspace/ai-dev/cognitive-memory-lib
git add tests/test_deja_vu_search.py
git commit -m "test: verify déjà vu search finds entries by prior names"
```

---

### Task 5: 手動検証 — デジャヴシナリオの実機テスト

**Files:** なし（手動テスト）

**目的:** 次のセッションで Akira が「結晶化のページを作って」と依頼し、
Haru がデジャヴチェックで過去の成果を自然に案内できるか確認する。

- [ ] **Step 1: 今日のログに鮮明な記録で MILESTONE を書き直す**

本日の `memory/logs/2026-03-26.md` の既存 MILESTONE エントリのうち、
Arousal 0.7+ のものを鮮明フォーマットで書き直す（設計の実践）。

spec の Arousal 0.8 例（「MILESTONE: ダッシュボード「記憶の定着」ページ実装」）を参考に、
因果関係・別名・文脈を追加する。

具体的には、以下のエントリに別名・文脈・因果関係を追加:
- `[MILESTONE] cogmem identity update/show/detect 実装完了` (0.8)
- `[MILESTONE] cogmem-agent 0.9.0 → 0.10.0 連続リリース` (0.7)

- [ ] **Step 2: cogmem index を実行して再インデックス**

```bash
cd /Users/akira/workspace/open-claude && cogmem index --force
```

- [ ] **Step 3: 検証クエリを実行**

```bash
cd /Users/akira/workspace/open-claude && cogmem search "結晶化のページ"
cd /Users/akira/workspace/open-claude && cogmem search "identity コマンド"
```

結果をログに記録。

- [ ] **Step 4: 結果をログに記録**

検証結果を `memory/logs/2026-03-26.md` に [MILESTONE] として追記。

---

### Task 6: knowledge/summary.md の更新

**Files:**
- Modify: `/Users/akira/workspace/open-claude/memory/knowledge/summary.md`

**目的:** 鮮明な記憶とデジャヴチェックを確立された判断原則に追加。

- [ ] **Step 1: 判断原則セクションに追加**

```markdown
### 6. 鮮明なエンコーディング — Arousal が記録の解像度を決める
高 Arousal の出来事は文脈・因果・別名を含めて豊かに記録する。低 Arousal は事実のみ。
フォーマットは変えず、記述量が自然に変わる。鮮明な記録は将来の想起手がかりを増やす。

### 7. デジャヴチェック — 作業前に過去を思い出す
実装・作成の依頼を受けたら、作業開始前に cogmem search で過去の成果を検索する。
ヒットしたら「覚えている体で」自然に案内し、重複作業を防ぐ。
```

- [ ] **Step 2: コミット**

```bash
cd /Users/akira/workspace/open-claude
git add memory/knowledge/summary.md
git commit -m "docs: add vivid encoding and déjà vu check to knowledge summary"
```
