"""Reflex Reasoning Engine — the only place the LLM vendor SDK lives.

All agents call `reason(...)` or `reason_json(...)` here. This module is also
the canonical surface that `lapdog`'s ambient Datadog LLM Observability
instrumentation hooks into — so every reasoning call automatically becomes a
span in the dashboard with no per-call wiring.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Type, TypeVar

import anthropic
from pydantic import BaseModel

from apps.api.settings import get_settings

log = logging.getLogger(__name__)

_T = TypeVar("_T", bound=BaseModel)


def _client() -> anthropic.AsyncAnthropic:
    s = get_settings()
    return anthropic.AsyncAnthropic(api_key=s.anthropic_api_key)


async def reason(
    system: str,
    user: str,
    *,
    max_tokens: int = 1024,
    temperature: float = 0.2,
) -> str:
    """Plain text reasoning."""
    s = get_settings()
    resp = await _client().messages.create(
        model=s.reasoning_model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return _extract_text(resp)


async def reason_json(
    system: str,
    user: str,
    schema: Type[_T],
    *,
    max_tokens: int = 2048,
    temperature: float = 0.2,
) -> _T:
    """Structured-output reasoning. Returns a parsed Pydantic model."""
    s = get_settings()
    enforced_system = (
        system
        + "\n\nReturn ONLY a single JSON object that matches this schema. "
        + "No prose, no markdown, no code fences.\n"
        + "Schema:\n"
        + json.dumps(schema.model_json_schema(), indent=2)
    )
    resp = await _client().messages.create(
        model=s.reasoning_model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=enforced_system,
        messages=[{"role": "user", "content": user}],
    )
    raw = _extract_text(resp)
    cleaned = _strip_code_fences(raw)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        # Last-ditch: try to find the first {...} block
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            data = json.loads(cleaned[start : end + 1])
        else:
            raise
    return schema.model_validate(data)


async def reason_vision(
    system: str,
    user: str,
    image_b64: str,
    media_type: str = "image/jpeg",
    *,
    max_tokens: int = 1024,
    temperature: float = 0.1,
) -> str:
    """Vision call — used for PDF/image upload entity extraction."""
    s = get_settings()
    resp = await _client().messages.create(
        model=s.reasoning_model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_b64,
                        },
                    },
                    {"type": "text", "text": user},
                ],
            }
        ],
    )
    return _extract_text(resp)


def _extract_text(resp: Any) -> str:
    chunks = []
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            chunks.append(block.text)
    return "".join(chunks).strip()


def _strip_code_fences(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        # Drop the opening fence (and any language tag)
        s = s.split("\n", 1)[1] if "\n" in s else s
        # Drop the closing fence
        if s.endswith("```"):
            s = s[: -3]
    return s.strip()
