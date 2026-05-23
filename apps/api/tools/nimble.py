"""NimbleWay Web Search Agent client.

Uses NimbleWay's Online Search API (the SaaS endpoint).
Docs: https://docs.nimbleway.com/

Notes:
- Falls back to a cached canonical response (infra/seed/nimble_cache.json) if
  the live call returns nothing — keeps the demo resilient.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from apps.api.settings import get_settings

log = logging.getLogger(__name__)

CACHE_PATH = (
    Path(__file__).resolve().parent.parent.parent.parent
    / "infra"
    / "seed"
    / "nimble_cache.json"
)


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=0.5, min=0.5, max=8),
    retry=retry_if_exception_type((httpx.HTTPError,)),
)
async def _live_search(query: str, *, num_results: int = 8) -> dict[str, Any]:
    s = get_settings()
    headers = {
        "Authorization": f"Bearer {s.nimble_api_key}",
        "Content-Type": "application/json",
    }
    # NimbleWay Online Search API
    url = f"{s.nimble_base_url.rstrip('/')}/api/v1/realtime/serp"
    payload = {
        "query": query,
        "country": "US",
        "locale": "en",
        "parse": True,
        "render": False,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(url, json=payload, headers=headers)
        r.raise_for_status()
        return r.json()


def _load_cache() -> dict[str, Any]:
    if not CACHE_PATH.exists():
        return {}
    try:
        return json.loads(CACHE_PATH.read_text())
    except Exception:
        return {}


def _cache_hit(query: str) -> dict[str, Any] | None:
    cache = _load_cache()
    # Match on substring of the drug name when present
    for key, value in cache.items():
        if key.lower() in query.lower():
            return value
    return None


def _normalize(raw: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten Nimble's SERP shape into a list of {title,url,snippet,date}."""
    out: list[dict[str, Any]] = []
    parsing = raw.get("parsing") or raw
    organic = (parsing.get("organic_results") or parsing.get("organic") or [])
    for item in organic[:10]:
        out.append(
            {
                "title": item.get("title") or item.get("name") or "",
                "url": item.get("link") or item.get("url") or "",
                "snippet": item.get("snippet")
                or item.get("description")
                or "",
                "date": item.get("date") or item.get("published_date"),
            }
        )
    return out


async def nimble_search(query: str, *, num_results: int = 8) -> list[dict[str, Any]]:
    """Public surface — returns a normalized list of results.

    On failure, falls back to the canonical cache and finally to an empty list.
    """
    try:
        raw = await _live_search(query, num_results=num_results)
        results = _normalize(raw)
        if results:
            return results
    except Exception as e:  # noqa: BLE001
        log.warning("nimble live search failed (%s); falling back to cache", e)

    cached = _cache_hit(query)
    if cached:
        return _normalize(cached)
    return []
