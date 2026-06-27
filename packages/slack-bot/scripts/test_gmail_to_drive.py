"""Tests for gmail_to_drive.py — configurable backfill window + paging.

ネットワークは叩かない。クエリ生成と search_emails のページングロジックを
gmail_api のモックで検証する。
"""
import sys
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))
import gmail_to_drive as g  # noqa: E402


class TestBuildQueries:
    def test_default_window_is_8d(self):
        assert isinstance(g.BACKFILL_DAYS, int)
        assert f"newer_than:{g.BACKFILL_DAYS}d" in g.RECEIPT_QUERY
        assert f"newer_than:{g.BACKFILL_DAYS}d" in g.INVOICE_QUERY

    def test_custom_window_substituted(self):
        receipt, invoice = g.build_queries(90)
        assert "newer_than:90d" in receipt
        assert "newer_than:90d" in invoice

    def test_queries_preserve_filters_and_subjects(self):
        receipt, invoice = g.build_queries(30)
        # 共通: ラベル除外・アーカイブ含む
        for q in (receipt, invoice):
            assert "-label:drive-saved" in q
            assert "in:anywhere" in q
        # 領収書側の subject/from
        assert "領収書" in receipt and "receipt" in receipt
        assert '"your receipt"' in receipt and "stripe.com" in receipt
        # 請求書側の subject
        assert "請求書" in invoice and "invoice" in invoice and "INV" in invoice


def _seq(*pages):
    """gmail_api のモック: 呼ばれるたびに順に pages を返す。"""
    calls = list(pages)

    def fake(token, path, method="GET", body=None):
        return calls.pop(0)

    return fake


class TestSearchEmailsPaging:
    def test_single_page(self):
        with patch.object(g, "gmail_api",
                          _seq({"messages": [{"id": "a"}, {"id": "b"}]})):
            assert g.search_emails("tok", "q") == ["a", "b"]

    def test_empty_result(self):
        with patch.object(g, "gmail_api", _seq({})):
            assert g.search_emails("tok", "q") == []

    def test_aggregates_multiple_pages(self):
        fake = _seq(
            {"messages": [{"id": "a"}], "nextPageToken": "p2"},
            {"messages": [{"id": "b"}], "nextPageToken": "p3"},
            {"messages": [{"id": "c"}]},
        )
        with patch.object(g, "gmail_api", fake):
            assert g.search_emails("tok", "q") == ["a", "b", "c"]

    def test_forwards_page_token(self):
        seen = []

        def fake(token, path, method="GET", body=None):
            seen.append(path)
            if "pageToken" not in path:
                return {"messages": [{"id": "a"}], "nextPageToken": "TOK123"}
            return {"messages": [{"id": "b"}]}

        with patch.object(g, "gmail_api", fake):
            g.search_emails("tok", "q")
        assert any("pageToken=TOK123" in p for p in seen)

    def test_max_results_truncates_across_pages(self):
        calls = {"n": 0}

        def fake(token, path, method="GET", body=None):
            calls["n"] += 1
            n = calls["n"]
            return {"messages": [{"id": f"{n}a"}, {"id": f"{n}b"}], "nextPageToken": "more"}

        with patch.object(g, "gmail_api", fake):
            ids = g.search_emails("tok", "q", max_results=3)
        assert ids == ["1a", "1b", "2a"]
        assert calls["n"] == 2  # 2ページ目で 3 件に到達して打ち切り

    def test_max_results_stops_on_first_page(self):
        calls = {"n": 0}

        def fake(token, path, method="GET", body=None):
            calls["n"] += 1
            return {"messages": [{"id": str(i)} for i in range(5)], "nextPageToken": "more"}

        with patch.object(g, "gmail_api", fake):
            ids = g.search_emails("tok", "q", max_results=3)
        assert ids == ["0", "1", "2"]
        assert calls["n"] == 1  # 1ページで足りたら追加取得しない
