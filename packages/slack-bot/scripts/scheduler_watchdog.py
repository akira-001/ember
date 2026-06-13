#!/usr/bin/env python3
"""Scheduler fire-gap watchdog (deterministic replacement for the LLM job).

Counts proactive-family cron fires (proactive-checkin / proactive-checkin-eve /
interest-scanner) in cron-history.jsonl within the last WINDOW_MIN minutes.

- count >= 1  -> scheduler is alive -> print nothing (no Slack post)
- count == 0  -> scheduler stalled  -> print a warning line (scheduler posts it)

Why this is a plain script, not a Claude Code job:
the old `message`-type job spun up a full LLM agent just to grep a local file,
took 20-35s normally and occasionally hung past the 120s runner timeout. The
timeout aborted the SDK process, which surfaced as the misleading error
"Claude Code process aborted by user" AND fired a false Cron Error alert. A
deterministic script finishes in <1s and can never trip that path.
"""

import json
from pathlib import Path
from datetime import datetime, timedelta, timezone

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
HISTORY_FILE = DATA_DIR / "cron-history.jsonl"
WINDOW_MIN = 60
WATCHED_JOBS = {"proactive-checkin", "proactive-checkin-eve", "interest-scanner"}


def parse_started_at(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def count_recent_fires(cutoff: datetime) -> int:
    if not HISTORY_FILE.exists():
        return 0
    count = 0
    with HISTORY_FILE.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("jobName") not in WATCHED_JOBS:
                continue
            started = parse_started_at(entry.get("startedAt", ""))
            if started is not None and started >= cutoff:
                count += 1
    return count


def main() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=WINDOW_MIN)
    fires = count_recent_fires(cutoff)
    if fires == 0:
        print(
            f"⚠️ scheduler-watchdog: 直近{WINDOW_MIN}分で proactive 系ジョブの発火が0件。"
            "scheduler 停止または cron ランナーハング疑い。要確認。"
        )
    # fires >= 1: healthy -> no output -> scheduler posts nothing


if __name__ == "__main__":
    main()
