#!/usr/bin/env python3
"""Collect Gmail and Calendar data for proactive-agent.

Outputs JSON to stdout with keys: gmail, calendar, errors.
Always exits 0; errors are reported in the errors array.
"""

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import URLError

JST = timezone(timedelta(hours=9))

# --- Credentials ---

GMAIL_CREDS_PATH = Path.home() / ".gmail-mcp" / "credentials.json"
GMAIL_OAUTH_PATH = Path.home() / ".gmail-mcp" / "gcp-oauth.keys.json"


def get_access_token() -> str:
    """Refresh the OAuth2 access token using stored credentials."""
    creds = json.loads(GMAIL_CREDS_PATH.read_text())
    oauth = json.loads(GMAIL_OAUTH_PATH.read_text())
    client = oauth.get("installed", oauth.get("web", {}))

    data = urlencode({
        "client_id": client["client_id"],
        "client_secret": client["client_secret"],
        "refresh_token": creds["refresh_token"],
        "grant_type": "refresh_token",
    }).encode()

    req = Request("https://oauth2.googleapis.com/token", data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())["access_token"]


# --- Gmail ---

def fetch_gmail(token: Optional[str] = None) -> dict:
    """Fetch unread important emails from Gmail API."""
    if token is None:
        token = get_access_token()

    query = "is:unread is:important newer_than:1d"
    params = urlencode({"q": query, "maxResults": 10})
    url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages?{params}"

    req = Request(url)
    req.add_header("Authorization", f"Bearer {token}")

    try:
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
    except URLError:
        return {"unread_important": [], "count": 0}

    messages = data.get("messages", [])
    result = []

    for msg_stub in messages[:10]:
        msg_url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_stub['id']}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date"
        msg_req = Request(msg_url)
        msg_req.add_header("Authorization", f"Bearer {token}")
        try:
            with urlopen(msg_req, timeout=10) as resp:
                msg = json.loads(resp.read())
        except URLError:
            continue

        headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
        result.append({
            "id": msg["id"],
            "from": headers.get("From", ""),
            "subject": headers.get("Subject", ""),
            "snippet": msg.get("snippet", ""),
            "date": headers.get("Date", ""),
        })

    return {"unread_important": result, "count": len(result)}


# --- Calendar ---

def load_exclude_calendars() -> list:
    """Load excluded calendar names from proactive-config.json."""
    config_path = Path(__file__).parent.parent / "data" / "proactive-config.json"
    if not config_path.exists():
        return []
    try:
        config = json.loads(config_path.read_text())
        return config.get("excludeCalendars", [])
    except Exception:
        return []


def fetch_calendar(token: Optional[str] = None) -> dict:
    """Fetch today and tomorrow's calendar events from all calendars."""
    if token is None:
        token = get_access_token()

    now = datetime.now(JST)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow_end = today_start + timedelta(days=2)
    today_str = now.strftime("%Y-%m-%d")
    tomorrow_str = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    exclude = load_exclude_calendars()

    # Get all calendars
    cal_list_url = "https://www.googleapis.com/calendar/v3/users/me/calendarList"
    req = Request(cal_list_url)
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urlopen(req, timeout=10) as resp:
            cal_data = json.loads(resp.read())
    except URLError:
        return {"today": [], "tomorrow": []}

    today_events = []
    tomorrow_events = []

    for cal in cal_data.get("items", []):
        cal_id = cal["id"]
        cal_name = cal.get("summary", cal_id)
        # Skip holidays
        if cal.get("accessRole") == "reader" and "holiday" in cal_id:
            continue
        # Skip excluded calendars
        if any(ex in cal_name or ex in cal_id for ex in exclude):
            continue

        params = urlencode({
            "timeMin": today_start.isoformat(),
            "timeMax": tomorrow_end.isoformat(),
            "singleEvents": "true",
            "orderBy": "startTime",
        })
        url = f"https://www.googleapis.com/calendar/v3/calendars/{urlencode_component(cal_id)}/events?{params}"
        req = Request(url)
        req.add_header("Authorization", f"Bearer {token}")

        try:
            with urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
        except URLError:
            continue

        for item in data.get("items", []):
            start = item.get("start", {})
            start_str = start.get("dateTime", start.get("date", ""))
            event = {
                "summary": item.get("summary", "(no title)"),
                "start": start_str,
                "end": item.get("end", {}).get("dateTime", item.get("end", {}).get("date", "")),
                "location": item.get("location", ""),
                "calendar": cal_name,
            }
            if start_str.startswith(today_str):
                today_events.append(event)
            elif start_str.startswith(tomorrow_str):
                tomorrow_events.append(event)

    # Sort by start time
    today_events.sort(key=lambda e: e["start"])
    tomorrow_events.sort(key=lambda e: e["start"])

    return {"today": today_events, "tomorrow": tomorrow_events}


def urlencode_component(s: str) -> str:
    """URL-encode a single component (for calendar ID with @)."""
    from urllib.parse import quote
    return quote(s, safe="")


# --- Topics (Google News RSS) ---

def fetch_topics(interests: list) -> list:
    """Fetch recent news for each interest keyword via Google News RSS."""
    if not interests:
        return []

    from xml.etree import ElementTree

    results = []
    for interest in interests[:5]:  # Limit to 5 interests
        keyword = interest.strip()
        if not keyword:
            continue
        rss_url = f"https://news.google.com/rss/search?q={urlencode({'': keyword})[1:]}&hl=ja&gl=JP&ceid=JP:ja"
        req = Request(rss_url)
        req.add_header("User-Agent", "Mozilla/5.0")
        try:
            with urlopen(req, timeout=10) as resp:
                tree = ElementTree.parse(resp)
            items = tree.findall(".//item")
            for item in items[:3]:  # Top 3 per interest
                title_el = item.find("title")
                source_el = item.find("source")
                results.append({
                    "title": title_el.text if title_el is not None else "",
                    "source": source_el.text if source_el is not None else "",
                    "interest": keyword,
                })
        except Exception:
            continue

    return results


# --- Main ---

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--interests", type=str, default="",
                        help="Comma-separated list of interests for topic search")
    args = parser.parse_args()

    errors = []
    gmail_data = {"unread_important": [], "count": 0}
    calendar_data = {"today": [], "tomorrow": []}
    topics_data = []

    try:
        token = get_access_token()
    except Exception as e:
        errors.append(f"token refresh failed: {e}")
        token = None

    if token:
        try:
            gmail_data = fetch_gmail(token)
        except Exception as e:
            errors.append(f"gmail fetch failed: {e}")

        try:
            calendar_data = fetch_calendar(token)
        except Exception as e:
            errors.append(f"calendar fetch failed: {e}")

    interests = [i.strip() for i in args.interests.split(",") if i.strip()]
    if interests:
        try:
            topics_data = fetch_topics(interests)
        except Exception as e:
            errors.append(f"topics fetch failed: {e}")

    # Mark calendar as explicitly failed if token refresh failed
    if token is None and calendar_data == {"today": [], "tomorrow": []}:
        calendar_data = {"today": [], "tomorrow": [], "error": "token refresh failed - calendar data unavailable"}

    output = {
        "gmail": gmail_data,
        "calendar": calendar_data,
        "topics": topics_data,
        "errors": errors,
    }
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
