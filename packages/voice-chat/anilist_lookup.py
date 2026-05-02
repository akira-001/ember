"""AniList GraphQL lookup for anime title resolution.

Provides async lookup of anime titles by character name,
with in-memory TTL cache to respect AniList rate limits (90 req/min).
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level shared client (reused across calls)
# ---------------------------------------------------------------------------
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            base_url="https://graphql.anilist.co",
            timeout=5.0,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
    return _client


# ---------------------------------------------------------------------------
# In-memory TTL cache (max 200 entries, 24h TTL)
# ---------------------------------------------------------------------------
_CACHE_TTL = 86400.0  # 24 hours
_CACHE_MAX = 200
_cache: dict[str, tuple[float, dict | None]] = {}  # key -> (expires_at, value)


def _cache_get(key: str) -> tuple[bool, dict | None]:
    if key in _cache:
        expires_at, value = _cache[key]
        if time.monotonic() < expires_at:
            return True, value
        del _cache[key]
    return False, None


def _cache_set(key: str, value: dict | None) -> None:
    # Evict oldest entry when full
    if len(_cache) >= _CACHE_MAX:
        oldest_key = min(_cache, key=lambda k: _cache[k][0])
        del _cache[oldest_key]
    _cache[key] = (time.monotonic() + _CACHE_TTL, value)


# ---------------------------------------------------------------------------
# GraphQL query
# ---------------------------------------------------------------------------
_QUERY = """
query ($search: String) {
  Character(search: $search) {
    name { full native }
    media(perPage: 3, sort: POPULARITY_DESC, type: ANIME) {
      nodes {
        title { romaji english native }
        popularity
        siteUrl
      }
    }
  }
}
"""


async def lookup_anime_by_character(character_name: str) -> dict | None:
    """Look up anime titles by character name via AniList GraphQL API.

    Args:
        character_name: Character name to search (katakana/kanji/romaji all OK).

    Returns:
        dict with keys:
            - "character": matched character full name
            - "candidates": list of {"title": str, "popularity": int, "url": str}
        or None if not found or on error.
    """
    key = character_name.strip()
    if not key:
        return None

    hit, cached = _cache_get(key)
    if hit:
        logger.debug(f"[anilist_lookup] cache hit: '{key}'")
        return cached

    try:
        client = _get_client()
        resp = await client.post(
            "/",
            json={"query": _QUERY, "variables": {"search": key}},
        )
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()

        errors = data.get("errors")
        if errors:
            logger.warning(f"[anilist_lookup] GraphQL errors for '{key}': {errors}")
            _cache_set(key, None)
            return None

        char_data = (data.get("data") or {}).get("Character")
        if not char_data:
            logger.debug(f"[anilist_lookup] no character found for '{key}'")
            _cache_set(key, None)
            return None

        char_name_data = char_data.get("name") or {}
        char_full = char_name_data.get("full") or char_name_data.get("native") or key

        nodes = (char_data.get("media") or {}).get("nodes") or []
        candidates = []
        for node in nodes:
            title_data = node.get("title") or {}
            # Prefer native (Japanese) title, then romaji, then english
            title = (
                title_data.get("native")
                or title_data.get("romaji")
                or title_data.get("english")
                or ""
            )
            candidates.append({
                "title": title,
                "popularity": node.get("popularity") or 0,
                "url": node.get("siteUrl") or "",
            })

        if not candidates:
            _cache_set(key, None)
            return None

        result = {"character": char_full, "candidates": candidates}
        _cache_set(key, result)
        logger.debug(f"[anilist_lookup] '{key}' → char='{char_full}' top='{candidates[0]['title']}'")
        return result

    except httpx.HTTPStatusError as e:
        logger.warning(f"[anilist_lookup] HTTP error for '{key}': {e.response.status_code}")
    except httpx.RequestError as e:
        logger.warning(f"[anilist_lookup] request error for '{key}': {e}")
    except Exception as e:
        logger.warning(f"[anilist_lookup] unexpected error for '{key}': {e}")

    _cache_set(key, None)
    return None
