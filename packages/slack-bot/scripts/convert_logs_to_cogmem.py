#!/usr/bin/env python3
"""Convert existing JSONL conversation logs to cogmem-compatible markdown format."""

import json
import re
from pathlib import Path
from datetime import datetime

JSONL_DIR = Path(__file__).parent.parent / "data" / "conversations"
COGMEM_DIR = Path(__file__).parent.parent / "data" / "memory" / "logs"


def detect_category(text: str) -> str:
    t = text.lower()
    if re.search(r"スケジュール|予定|カレンダー|会議|meeting", t):
        return "SCHEDULE"
    if re.search(r"コード|実装|バグ|エラー|デプロイ|開発", t):
        return "DEV"
    if re.search(r"旅行|温泉|キャンプ|遊び|ドジャース|野球", t):
        return "FUN"
    if re.search(r"タスク|todo|やること|確認|レビュー", t):
        return "TASK"
    if re.search(r"提案|アイデア|戦略|分析", t):
        return "IDEA"
    return "CHAT"


def convert_file(jsonl_path: Path) -> None:
    date_str = jsonl_path.stem  # e.g., 2026-03-23
    md_path = COGMEM_DIR / f"{date_str}.md"

    if md_path.exists():
        print(f"  Skipping {date_str} (already exists)")
        return

    entries = []
    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    if not entries:
        return

    # Pair user messages with bot responses
    md_lines = []
    i = 0
    while i < len(entries):
        entry = entries[i]
        if entry.get("role") == "user":
            user_text = entry.get("text", "")
            # Look ahead for bot response
            bot_text = ""
            bot_id = "mei"
            j = i + 1
            while j < len(entries) and entries[j].get("role") != "user":
                if entries[j].get("role") in ("mei", "eve"):
                    bot_id = entries[j]["role"]
                    bot_text = entries[j].get("text", "")
                    break
                j += 1

            if bot_text:
                ts = datetime.fromisoformat(entry["timestamp"].replace("Z", "+00:00"))
                time_str = ts.strftime("%H:%M")
                category = detect_category(user_text + " " + bot_text)

                max_len = 500
                user_snippet = user_text[:max_len] + ("..." if len(user_text) > max_len else "")
                bot_snippet = bot_text[:max_len] + ("..." if len(bot_text) > max_len else "")
                title = user_snippet.split("\n")[0][:60]

                md_lines.append(
                    f"\n### [{category}] {time_str} {bot_id} — {title}\n"
                    f"Arousal: 0.5\n"
                    f"Akira: {user_snippet}\n"
                    f"{bot_id}: {bot_snippet}\n"
                )
                i = j + 1
                continue
        i += 1

    if md_lines:
        COGMEM_DIR.mkdir(parents=True, exist_ok=True)
        with open(md_path, "w", encoding="utf-8") as f:
            f.writelines(md_lines)
        print(f"  Converted {date_str}: {len(md_lines)} entries")


def main() -> None:
    if not JSONL_DIR.exists():
        print("No conversation logs found")
        return

    jsonl_files = sorted(JSONL_DIR.glob("*.jsonl"))
    print(f"Found {len(jsonl_files)} log files")

    for jsonl_path in jsonl_files:
        convert_file(jsonl_path)

    print("Done. Run 'cogmem index' to build the search index.")


if __name__ == "__main__":
    main()
