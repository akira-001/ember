"""Tests for collect_data.py — Gmail/Calendar data collection script."""

import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

SCRIPT_DIR = Path(__file__).parent
SCRIPT_PATH = SCRIPT_DIR / "collect_data.py"


class TestOutputFormat:
    """Output must be valid JSON with required keys."""

    def test_output_is_valid_json(self):
        """Script stdout must be parseable as JSON."""
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH)],
            capture_output=True, text=True, timeout=30,
        )
        data = json.loads(result.stdout)
        assert isinstance(data, dict)

    def test_has_gmail_key(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH)],
            capture_output=True, text=True, timeout=30,
        )
        data = json.loads(result.stdout)
        assert "gmail" in data

    def test_has_calendar_key(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH)],
            capture_output=True, text=True, timeout=30,
        )
        data = json.loads(result.stdout)
        assert "calendar" in data

    def test_has_errors_key(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH)],
            capture_output=True, text=True, timeout=30,
        )
        data = json.loads(result.stdout)
        assert "errors" in data
        assert isinstance(data["errors"], list)

    def test_gmail_has_count(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH)],
            capture_output=True, text=True, timeout=30,
        )
        data = json.loads(result.stdout)
        assert "count" in data["gmail"]
        assert isinstance(data["gmail"]["count"], int)

    def test_gmail_has_unread_important(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH)],
            capture_output=True, text=True, timeout=30,
        )
        data = json.loads(result.stdout)
        assert "unread_important" in data["gmail"]
        assert isinstance(data["gmail"]["unread_important"], list)

    def test_calendar_has_today_and_tomorrow(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH)],
            capture_output=True, text=True, timeout=30,
        )
        data = json.loads(result.stdout)
        assert "today" in data["calendar"]
        assert "tomorrow" in data["calendar"]
        assert isinstance(data["calendar"]["today"], list)
        assert isinstance(data["calendar"]["tomorrow"], list)

    def test_exit_code_zero(self):
        """Script should always exit 0 (errors go in the errors array)."""
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH)],
            capture_output=True, text=True, timeout=30,
        )
        assert result.returncode == 0


class TestCollectDataModule:
    """Unit tests for internal functions (imported as module)."""

    def test_get_access_token_returns_string(self):
        # Import only after script exists
        sys.path.insert(0, str(SCRIPT_DIR))
        from collect_data import get_access_token
        token = get_access_token()
        assert isinstance(token, str)
        assert len(token) > 0

    def test_fetch_gmail_returns_dict_with_required_keys(self):
        sys.path.insert(0, str(SCRIPT_DIR))
        from collect_data import fetch_gmail
        result = fetch_gmail()
        assert "unread_important" in result
        assert "count" in result
        assert isinstance(result["unread_important"], list)

    def test_fetch_calendar_returns_dict_with_required_keys(self):
        sys.path.insert(0, str(SCRIPT_DIR))
        from collect_data import fetch_calendar
        result = fetch_calendar()
        assert "today" in result
        assert "tomorrow" in result

    def test_gmail_entry_has_required_fields(self):
        """Each Gmail entry must have id, from, subject, snippet, date."""
        sys.path.insert(0, str(SCRIPT_DIR))
        from collect_data import fetch_gmail
        result = fetch_gmail()
        for entry in result["unread_important"]:
            assert "id" in entry
            assert "from" in entry
            assert "subject" in entry
            assert "snippet" in entry
            assert "date" in entry


class TestTopicsFetch:
    """Tests for interest-based topic fetching."""

    def test_fetch_topics_returns_list(self):
        sys.path.insert(0, str(SCRIPT_DIR))
        from collect_data import fetch_topics
        result = fetch_topics(["温泉"])
        assert isinstance(result, list)

    def test_fetch_topics_entries_have_required_fields(self):
        sys.path.insert(0, str(SCRIPT_DIR))
        from collect_data import fetch_topics
        result = fetch_topics(["AI"])
        for entry in result:
            assert "title" in entry
            assert "source" in entry
            assert "interest" in entry

    def test_fetch_topics_empty_interests(self):
        sys.path.insert(0, str(SCRIPT_DIR))
        from collect_data import fetch_topics
        result = fetch_topics([])
        assert result == []

    def test_output_includes_topics_with_interests_flag(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "--interests", "温泉,AI"],
            capture_output=True, text=True, timeout=30,
        )
        data = json.loads(result.stdout)
        assert "topics" in data
        assert isinstance(data["topics"], list)
