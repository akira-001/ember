# 想起による記憶定着強化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 検索やフラッシュバックで記憶が呼び出された時に recall_count / last_recalled を記録し、arousal を引き上げて忘却曲線をリセットする。「何度も思い出す記憶は定着する」を実装する。

**Architecture:** memories テーブルに `recall_count` / `last_recalled` カラムを追加。`MemoryStore.search()` と `context_search()` の結果返却時に、ヒットした記憶の recall メタデータを更新する。arousal 引き上げは `min(arousal + 0.1, 1.0)` で上限キャップ。

**Tech Stack:** Python, SQLite, pytest

**Repo:** `/Users/akira/workspace/ai-dev/cognitive-memory-lib`

---

### Task 1: memories テーブルにカラム追加

**Files:**
- Modify: `src/cognitive_memory/store.py:61-72` (_init_db の CREATE TABLE)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_recall.py
"""Tests for recall reinforcement."""

import sqlite3
from pathlib import Path

import pytest

from cognitive_memory.config import CogMemConfig
from cognitive_memory.store import MemoryStore


@pytest.fixture
def store(tmp_path):
    (tmp_path / "memory" / "logs").mkdir(parents=True)
    (tmp_path / "cogmem.toml").write_text(
        '[cogmem]\nlogs_dir = "memory/logs"\ndb_path = "memory/vectors.db"\n',
        encoding="utf-8",
    )
    config = CogMemConfig.from_toml(tmp_path / "cogmem.toml")
    with MemoryStore(config) as s:
        yield s


def test_memories_table_has_recall_columns(store):
    """recall_count and last_recalled columns exist with correct defaults."""
    store.conn.execute(
        "INSERT INTO memories (content_hash, date, content, arousal, vector) "
        "VALUES ('h1', '2026-03-26', 'test', 0.5, '[]')"
    )
    row = store.conn.execute(
        "SELECT recall_count, last_recalled FROM memories WHERE content_hash = 'h1'"
    ).fetchone()
    assert row["recall_count"] == 0
    assert row["last_recalled"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && python3 -m pytest tests/test_recall.py::test_memories_table_has_recall_columns -v`
Expected: FAIL — `OperationalError: table memories has no column named recall_count`

- [ ] **Step 3: Write minimal implementation**

`store.py` の `_init_db` で CREATE TABLE に 2 カラム追加 + ALTER TABLE でマイグレーション:

```python
# _init_db 内の CREATE TABLE memories を以下に変更:
self._conn.execute("""
    CREATE TABLE IF NOT EXISTS memories (
        id           INTEGER PRIMARY KEY,
        content_hash TEXT UNIQUE,
        date         TEXT,
        content      TEXT,
        arousal      REAL,
        vector       BLOB,
        recall_count INTEGER DEFAULT 0,
        last_recalled TEXT
    )
""")

# 既存DBのマイグレーション（カラムが無ければ追加）
for col, col_def in [
    ("recall_count", "INTEGER DEFAULT 0"),
    ("last_recalled", "TEXT"),
]:
    try:
        self._conn.execute(f"ALTER TABLE memories ADD COLUMN {col} {col_def}")
    except sqlite3.OperationalError:
        pass  # column already exists
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && python3 -m pytest tests/test_recall.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && git add tests/test_recall.py src/cognitive_memory/store.py && git commit -m "feat: add recall_count and last_recalled columns to memories table"
```

---

### Task 2: reinforce_recall メソッド

**Files:**
- Modify: `src/cognitive_memory/store.py` (新メソッド追加)
- Test: `tests/test_recall.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_recall.py に追加

def test_reinforce_recall_increments_count(store):
    """reinforce_recall increments recall_count and updates last_recalled."""
    store.conn.execute(
        "INSERT INTO memories (content_hash, date, content, arousal, vector) "
        "VALUES ('h1', '2026-03-26', 'test memory', 0.5, '[]')"
    )
    store.conn.commit()

    store.reinforce_recall("h1")

    row = store.conn.execute(
        "SELECT recall_count, last_recalled, arousal FROM memories WHERE content_hash = 'h1'"
    ).fetchone()
    assert row["recall_count"] == 1
    assert row["last_recalled"] is not None
    assert row["arousal"] == 0.6  # 0.5 + 0.1


def test_reinforce_recall_caps_arousal_at_1(store):
    """arousal never exceeds 1.0."""
    store.conn.execute(
        "INSERT INTO memories (content_hash, date, content, arousal, vector) "
        "VALUES ('h2', '2026-03-26', 'high arousal', 0.95, '[]')"
    )
    store.conn.commit()

    store.reinforce_recall("h2")

    row = store.conn.execute(
        "SELECT arousal FROM memories WHERE content_hash = 'h2'"
    ).fetchone()
    assert row["arousal"] == 1.0


def test_reinforce_recall_multiple_times(store):
    """Multiple recalls accumulate count and arousal."""
    store.conn.execute(
        "INSERT INTO memories (content_hash, date, content, arousal, vector) "
        "VALUES ('h3', '2026-03-26', 'repeated', 0.5, '[]')"
    )
    store.conn.commit()

    store.reinforce_recall("h3")
    store.reinforce_recall("h3")
    store.reinforce_recall("h3")

    row = store.conn.execute(
        "SELECT recall_count, arousal FROM memories WHERE content_hash = 'h3'"
    ).fetchone()
    assert row["recall_count"] == 3
    assert row["arousal"] == 0.8  # 0.5 + 0.1*3


def test_reinforce_recall_nonexistent_hash(store):
    """Calling reinforce_recall with unknown hash does nothing (no error)."""
    store.reinforce_recall("nonexistent")  # should not raise
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && python3 -m pytest tests/test_recall.py -v`
Expected: FAIL — `AttributeError: 'MemoryStore' object has no attribute 'reinforce_recall'`

- [ ] **Step 3: Write minimal implementation**

```python
# store.py の MemoryStore クラスに追加
def reinforce_recall(self, content_hash: str, arousal_boost: float = 0.1) -> None:
    """Record a recall event: increment count, boost arousal, update timestamp."""
    self.conn.execute(
        """
        UPDATE memories
        SET recall_count = recall_count + 1,
            last_recalled = ?,
            arousal = MIN(arousal + ?, 1.0)
        WHERE content_hash = ?
        """,
        (datetime.now().isoformat(), arousal_boost, content_hash),
    )
    self.conn.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && python3 -m pytest tests/test_recall.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && git add src/cognitive_memory/store.py tests/test_recall.py && git commit -m "feat: add reinforce_recall method to MemoryStore"
```

---

### Task 3: search() で自動想起

**Files:**
- Modify: `src/cognitive_memory/store.py:203-229` (search メソッド)
- Test: `tests/test_recall.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_recall.py に追加
import hashlib
import json


def _insert_memory_with_vector(store, content_hash, date, content, arousal, vector):
    """Helper to insert a memory with a real vector."""
    store.conn.execute(
        "INSERT INTO memories (content_hash, date, content, arousal, vector) "
        "VALUES (?, ?, ?, ?, ?)",
        (content_hash, date, content, arousal, json.dumps(vector)),
    )
    store.conn.commit()


def test_search_reinforces_results(store, monkeypatch):
    """search() calls reinforce_recall for each result."""
    # Insert a memory
    content = "### [INSIGHT] テスト用の洞察エントリ"
    content_hash = hashlib.sha256(content.encode()).hexdigest()
    _insert_memory_with_vector(store, content_hash, "2026-03-26", content, 0.5, [0.1] * 10)

    # Track reinforce calls
    reinforced = []
    original_reinforce = store.reinforce_recall

    def tracking_reinforce(h, **kwargs):
        reinforced.append(h)
        return original_reinforce(h, **kwargs)

    monkeypatch.setattr(store, "reinforce_recall", tracking_reinforce)

    # Mock search to return our memory
    from cognitive_memory.types import SearchResult, SearchResponse

    def fake_search(query, top_k=5):
        return SearchResponse(
            results=[
                SearchResult(
                    score=0.9,
                    date="2026-03-26",
                    content=content,
                    arousal=0.5,
                    source="semantic",
                    cosine_sim=0.9,
                )
            ],
            status="ok",
        )

    monkeypatch.setattr(store, "_execute_search", fake_search)
    response = store.search("テスト洞察")

    # Verify reinforcement happened for the result
    row = store.conn.execute(
        "SELECT recall_count FROM memories WHERE content_hash = ?",
        (content_hash,),
    ).fetchone()
    # recall_count should be >= 1 if reinforcement was triggered
    assert row["recall_count"] >= 1 or len(reinforced) >= 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && python3 -m pytest tests/test_recall.py::test_search_reinforces_results -v`
Expected: FAIL — `AttributeError: '_execute_search'` (メソッドがまだない)

- [ ] **Step 3: Refactor search to call reinforce_recall**

search() の内部ロジックを `_execute_search` に抽出し、search() は結果に対して `reinforce_recall` を呼ぶラッパーにする:

```python
# store.py の search メソッドを分割

def _execute_search(self, query: str, top_k: int = 5) -> SearchResponse:
    """Internal search pipeline without recall reinforcement."""
    if not should_search(query):
        return SearchResponse(status="skipped_by_gate")

    query_vec = self.embedder.embed(query)
    if query_vec is not None:
        sem_results, sem_status = semantic_search(
            query_vec, self.config.database_path, self.config, top_k
        )
        if sem_status == "ok":
            grep_results = grep_search(
                query, self.config.logs_path, self.config, top_k
            )
            merged = merge_and_dedup(grep_results, sem_results, top_k)
            return SearchResponse(results=merged, status="ok")
        status_reason = sem_status
    else:
        status_reason = "ollama_unavailable"

    grep_results = grep_search(query, self.config.logs_path, self.config, top_k)
    return SearchResponse(
        results=grep_results, status=f"degraded ({status_reason})"
    )

def search(self, query: str, top_k: int = 5) -> SearchResponse:
    """Full search pipeline with recall reinforcement."""
    response = self._execute_search(query, top_k)

    # Reinforce recalled memories
    for result in response.results:
        content_hash = hashlib.sha256(result.content.encode()).hexdigest()
        self.reinforce_recall(content_hash)

    return response
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && python3 -m pytest tests/test_recall.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && python3 -m pytest tests/ -q --timeout=30`
Expected: 全パス（既存テストが壊れていないこと）

- [ ] **Step 6: Commit**

```bash
cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && git add src/cognitive_memory/store.py tests/test_recall.py && git commit -m "feat: search results automatically reinforce recalled memories"
```

---

### Task 4: context_search() でも自動想起

**Files:**
- Modify: `src/cognitive_memory/store.py:231+` (context_search メソッド)
- Test: `tests/test_recall.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_recall.py に追加

def test_context_search_reinforces_flashbacks(store, monkeypatch):
    """context_search() reinforces memories that pass flashback filter."""
    content = "### [INSIGHT] フラッシュバック対象"
    content_hash = hashlib.sha256(content.encode()).hexdigest()
    _insert_memory_with_vector(store, content_hash, "2026-03-26", content, 0.8, [0.1] * 10)

    reinforced = []
    original_reinforce = store.reinforce_recall

    def tracking_reinforce(h, **kwargs):
        reinforced.append(h)
        return original_reinforce(h, **kwargs)

    monkeypatch.setattr(store, "reinforce_recall", tracking_reinforce)

    # Mock _execute_search to return a high-score high-arousal result
    from cognitive_memory.types import SearchResult, SearchResponse

    def fake_execute(query, top_k=5):
        return SearchResponse(
            results=[
                SearchResult(
                    score=0.9,
                    date="2026-03-26",
                    content=content,
                    arousal=0.8,
                    source="semantic",
                    cosine_sim=0.9,
                )
            ],
            status="ok",
        )

    monkeypatch.setattr(store, "_execute_search", fake_execute)

    # Enable context search
    monkeypatch.setattr(store.config, "context_search_enabled", True)

    response = store.context_search("フラッシュバック")

    assert len(reinforced) >= 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && python3 -m pytest tests/test_recall.py::test_context_search_reinforces_flashbacks -v`

- [ ] **Step 3: Add reinforcement to context_search**

`context_search` の結果返却前に、search と同じパターンで `reinforce_recall` を呼ぶ:

```python
# context_search の return response の前に追加:
for result in response.results:
    content_hash = hashlib.sha256(result.content.encode()).hexdigest()
    self.reinforce_recall(content_hash)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && python3 -m pytest tests/test_recall.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && python3 -m pytest tests/ -q --timeout=30`

- [ ] **Step 6: Commit**

```bash
cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && git add src/cognitive_memory/store.py tests/test_recall.py && git commit -m "feat: context_search also reinforces recalled memories"
```

---

### Task 5: ダッシュボードに想起情報を表示

**Files:**
- Modify: `src/cognitive_memory/dashboard/services/memory_service.py`
- Modify: `src/cognitive_memory/dashboard/templates/memory/overview.html`
- Modify: `src/cognitive_memory/dashboard/i18n.py`
- Test: `tests/test_dashboard/test_routes.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_dashboard/test_routes.py に追加（既存クラスに）

def test_home_shows_recall_stats(self, client):
    """Memory overview shows most recalled memories."""
    resp = client.get("/")
    assert resp.status_code == 200
    assert "recall" in resp.text.lower() or "想起" in resp.text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && python3 -m pytest tests/test_dashboard/test_routes.py::TestRoutes::test_home_shows_recall_stats -v`

- [ ] **Step 3: Implement**

`memory_service.get_overview_data()` に most recalled memories クエリを追加:

```python
# memory_service.py に追加
most_recalled = []
try:
    rows = conn.execute(
        "SELECT content, recall_count, last_recalled, arousal "
        "FROM memories WHERE recall_count > 0 "
        "ORDER BY recall_count DESC LIMIT 5"
    ).fetchall()
    most_recalled = [
        {
            "content": r["content"].split("\n")[0][:80],
            "recall_count": r["recall_count"],
            "last_recalled": r["last_recalled"],
            "arousal": r["arousal"],
        }
        for r in rows
    ]
except sqlite3.OperationalError:
    pass  # recall_count column doesn't exist yet
```

テンプレートとi18nに対応するセクションを追加。

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Run full dashboard tests**

Run: `cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && python3 -m pytest tests/test_dashboard/ -q`

- [ ] **Step 6: Commit**

```bash
cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && git add -A && git commit -m "feat: show most recalled memories on dashboard overview"
```

---

### Task 6: cogmem recall-stats CLI コマンド

**Files:**
- Create: `src/cognitive_memory/cli/recall_cmd.py`
- Modify: `src/cognitive_memory/cli/main.py` (サブコマンド登録)
- Test: `tests/test_recall.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_recall.py に追加

def test_recall_stats_output(store):
    """recall-stats shows memories sorted by recall_count."""
    store.conn.execute(
        "INSERT INTO memories (content_hash, date, content, arousal, vector, recall_count, last_recalled) "
        "VALUES ('rs1', '2026-03-26', '### [INSIGHT] よく思い出す記憶', 0.8, '[]', 5, '2026-03-26T10:00:00')"
    )
    store.conn.execute(
        "INSERT INTO memories (content_hash, date, content, arousal, vector, recall_count) "
        "VALUES ('rs2', '2026-03-25', '### [DECISION] 一度だけ', 0.6, '[]', 1)"
    )
    store.conn.commit()

    rows = store.conn.execute(
        "SELECT content, recall_count FROM memories WHERE recall_count > 0 ORDER BY recall_count DESC"
    ).fetchall()
    assert len(rows) == 2
    assert rows[0]["recall_count"] == 5
    assert rows[1]["recall_count"] == 1
```

- [ ] **Step 2: Run test to verify it passes** (DB 層は Task 1 で実装済み)

- [ ] **Step 3: Implement CLI command**

```python
# src/cognitive_memory/cli/recall_cmd.py
"""cogmem recall-stats — show recall statistics."""

from __future__ import annotations

import sys

from ..config import CogMemConfig
from ..store import MemoryStore


def run_recall_stats(json_output: bool = False):
    config = CogMemConfig.find_and_load()

    with MemoryStore(config) as store:
        rows = store.conn.execute(
            "SELECT content, recall_count, last_recalled, arousal, date "
            "FROM memories WHERE recall_count > 0 "
            "ORDER BY recall_count DESC LIMIT 10"
        ).fetchall()

    if not rows:
        print("No recalled memories yet.")
        return

    if json_output:
        import json
        data = [
            {
                "title": r["content"].split("\n")[0][:80],
                "recall_count": r["recall_count"],
                "last_recalled": r["last_recalled"],
                "arousal": r["arousal"],
                "date": r["date"],
            }
            for r in rows
        ]
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        print(f"{'Recalls':>8}  {'Arousal':>7}  {'Date':>10}  Title")
        print("-" * 70)
        for r in rows:
            title = r["content"].split("\n")[0][:50]
            print(f"{r['recall_count']:>8}  {r['arousal']:>7.2f}  {r['date']:>10}  {title}")
```

- [ ] **Step 4: Register in main.py**

`main.py` のサブコマンドに `recall-stats` を追加。

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && python3 -m pytest tests/ -q --timeout=30`

- [ ] **Step 6: Commit**

```bash
cd /Users/akira/workspace/ai-dev/cognitive-memory-lib && git add -A && git commit -m "feat: add cogmem recall-stats CLI command"
```
