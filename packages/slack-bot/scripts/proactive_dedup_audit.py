#!/usr/bin/env python3
"""Proactive message deduplication audit.

Analyzes the last N days of proactive messages across all bots,
detects topic duplicates, and outputs a report with fix suggestions.
"""

import json
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DAYS_BACK = int(sys.argv[1]) if len(sys.argv) > 1 else 3


def load_history(state_file: Path, days: int) -> list[dict]:
    """Load recent history entries from a bot's state file."""
    if not state_file.exists():
        return []
    data = json.loads(state_file.read_text())
    cutoff = datetime.now(JST) - timedelta(days=days)
    entries = []
    for h in data.get("history", []):
        sent = datetime.fromisoformat(h["sentAt"].replace("Z", "+00:00"))
        if sent >= cutoff:
            source_urls = h.get("sourceUrls") or []
            first_url = ""
            if source_urls:
                first = source_urls[0]
                if isinstance(first, dict):
                    first_url = first.get("url", "")
                elif isinstance(first, str):
                    first_url = first
            entries.append({
                "bot": state_file.stem.replace("-state", "").capitalize(),
                "sentAt": sent.astimezone(JST).strftime("%m/%d %H:%M"),
                "preview": h.get("preview") or h.get("fullText", "")[:120] or "",
                "url": h.get("candidateUrl") or h.get("url") or first_url,
                "category": h.get("category", ""),
                "interestCategory": h.get("interestCategory", ""),
                "skill": h.get("skill", ""),
            })
    return entries


def extract_topic_core(text: str) -> str:
    """Extract the topic core from a proactive message preview.

    Strips greeting/context preamble and extracts bold (*...*) keywords
    or falls back to the text after the first newline.
    """
    import re
    # Extract bold keywords first — these are the actual topic
    bold_parts = re.findall(r'\*([^*]+)\*', text)
    if bold_parts:
        return " ".join(bold_parts).lower()

    # Strip common preamble patterns (greetings, meeting transitions, time context)
    preamble = re.compile(
        r'^(akiraさん[、,]?\s*|'
        r'ねぇ(ねぇ)?[、,]?\s*|ねえ[、,]?\s*|'
        r'おはよう[！!。]?\s*|'
        r'そういえば(さ)?[、,]?\s*|'
        r'ちょっと[、,]?\s*|'
        r'あのさ[、,]?\s*|ふふ[、,]?\s*|'
        r'お(昼|疲れさま|つかれ)[^。]*[。\n]\s*|'
        r'(午前|午後|今日|明日|昨日|今朝|今夜|今週|週末)[^。]*[。\n]\s*|'
        r'[^\n]{0,30}(終わったら|始まるね|の前に|の合間に)[^。]*[。\n]\s*|'
        r'メール[^。]*[。\n]\s*|'
        r'寝る前に[^。]*[。\n]\s*'
        r')+',
        re.IGNORECASE
    )
    cleaned = preamble.sub('', text).strip()
    if len(cleaned) >= 10:
        return cleaned.lower()
    return text.lower()


def is_similar(a: str, b: str) -> bool:
    """Check text similarity using topic core extraction."""
    core_a = extract_topic_core(a)
    core_b = extract_topic_core(b)

    # English word overlap (4+ chars, 3+ matches)
    words_a = [w for w in core_a.split() if len(w) >= 4]
    word_matches = sum(1 for w in words_a if w in core_b)
    if word_matches >= 3:
        return True

    # CJK 4-char sliding window (5+ matches)
    windows = []
    for i in range(len(core_a) - 3):
        w = core_a[i:i+4]
        if any("\u3000" <= c <= "\u9fff" for c in w):
            windows.append(w)
    if windows:
        cjk_matches = sum(1 for w in windows if w in core_b)
        if cjk_matches >= 5:
            return True

    return False


def has_same_url(a: dict, b: dict) -> bool:
    url_a = a.get("url") or ""
    url_b = b.get("url") or ""
    return bool(url_a and url_b and url_a == url_b)


def find_duplicates(entries: list[dict]) -> list[dict]:
    """Find groups of similar messages."""
    used = set()
    groups = []

    for i, a in enumerate(entries):
        if i in used or not a["preview"]:
            continue
        group = [a]
        for j, b in enumerate(entries):
            if j <= i or j in used or not b["preview"]:
                continue
            if has_same_url(a, b) or is_similar(a["preview"][:120], b["preview"][:120]):
                group.append(b)
                used.add(j)
        if len(group) >= 2:
            used.add(i)
            groups.append(group)

    return groups


def format_report(groups: list[dict], days: int) -> str:
    """Format the deduplication report."""
    if not groups:
        return f"過去{days}日間のプロアクティブメッセージに話題の重複はなし。"

    lines = [f"*プロアクティブ話題重複レポート*（過去{days}日間）\n"]
    lines.append(f"重複検出: {len(groups)} 話題\n")

    for i, group in enumerate(groups, 1):
        bots = set(m["bot"] for m in group)
        topic = group[0]["preview"][:50]
        same_url = group[0].get("url") and all(m.get("url") == group[0].get("url") for m in group)
        tag = "Bot間重複" if len(bots) > 1 else f"{list(bots)[0]}が繰り返し"
        if same_url:
            tag += " / 同一URL"

        lines.append(f"*{i}. {topic}...* ({len(group)}回, {tag})")
        for m in group:
            url_suffix = f" ({m['url']})" if m.get("url") else ""
            lines.append(f"  - {m['bot']} [{m['sentAt']}] {m['preview'][:60]}{url_suffix}")
        lines.append("")

    lines.append("---")
    lines.append("*対策案:*")
    for i, group in enumerate(groups, 1):
        bots = set(m["bot"] for m in group)
        topic = group[0]["preview"][:30]
        if len(bots) > 1:
            lines.append(f"{i}. 「{topic}...」→ shared-history の重複フィルタが弱い可能性。interest-cache から該当記事を削除するか、interestCategory を統一")
        else:
            bot = list(bots)[0]
            lines.append(f"{i}. 「{topic}...」→ {bot} の interest-cache に古い記事が残存。キャッシュ更新 or TTL 短縮を検討")

    return "\n".join(lines)


def main():
    # Load all bot states
    all_entries = []
    for state_file in DATA_DIR.glob("*-state.json"):
        all_entries.extend(load_history(state_file, DAYS_BACK))

    # Sort by time
    all_entries.sort(key=lambda x: x["sentAt"])

    # Find duplicates
    groups = find_duplicates(all_entries)

    # Output report
    report = format_report(groups, DAYS_BACK)
    print(report)


if __name__ == "__main__":
    main()
