"""Reflex Reasoning Engine — the only place the LLM vendor SDKs live.

Defaults to NVIDIA NIM (`integrate.api.nvidia.com/v1`, OpenAI-compatible) so
`ddtrace`'s OpenAI auto-instrumentation captures every reasoning call as a
Datadog LLM Observability span with zero per-call wiring. Anthropic SDK
remains available as an alternate provider via REASONING_PROVIDER=anthropic.
"""
from __future__ import annotations

import base64 as _b64
import json
import logging
from typing import Any, Type, TypeVar

from openai import AsyncOpenAI
from pydantic import BaseModel

from apps.api.settings import get_settings

log = logging.getLogger(__name__)

_T = TypeVar("_T", bound=BaseModel)


class ReasoningUnavailable(RuntimeError):
    """Raised when no upstream reasoning API key is configured."""


def _have_key() -> bool:
    s = get_settings()
    if s.reasoning_provider == "anthropic":
        return bool(s.anthropic_api_key)
    return bool(s.nvidia_api_key)


def _openai_client() -> AsyncOpenAI:
    s = get_settings()
    if not s.nvidia_api_key:
        raise ReasoningUnavailable("NVIDIA_API_KEY not configured")
    return AsyncOpenAI(api_key=s.nvidia_api_key, base_url=s.nvidia_base_url)


def _model_text() -> str:
    return get_settings().nvidia_text_model


def _model_vision() -> str:
    return get_settings().nvidia_vision_model


async def reason(
    system: str,
    user: str,
    *,
    max_tokens: int = 1024,
    temperature: float = 0.2,
) -> str:
    """Plain text reasoning."""
    if not _have_key():
        raise ReasoningUnavailable("No reasoning provider key configured")
    client = _openai_client()
    resp = await client.chat.completions.create(
        model=_model_text(),
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return (resp.choices[0].message.content or "").strip()


async def reason_json(
    system: str,
    user: str,
    schema: Type[_T],
    *,
    max_tokens: int = 2048,
    temperature: float = 0.2,
) -> _T:
    """Structured-output reasoning. Returns a parsed Pydantic model."""
    if not _have_key():
        raise ReasoningUnavailable("No reasoning provider key configured")
    enforced_system = (
        system
        + "\n\nReturn ONLY a single JSON object that matches this schema. "
        + "No prose, no markdown, no code fences.\n"
        + "Schema:\n"
        + json.dumps(schema.model_json_schema(), indent=2)
    )
    client = _openai_client()
    resp = await client.chat.completions.create(
        model=_model_text(),
        max_tokens=max_tokens,
        temperature=temperature,
        # Many OpenAI-compatible servers honor this; NIM accepts json_object.
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": enforced_system},
            {"role": "user", "content": user},
        ],
    )
    raw = (resp.choices[0].message.content or "").strip()
    cleaned = _strip_code_fences(raw)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
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
    """Vision call — used for PDF/image upload entity extraction.

    NIM accepts image_url with a `data:` URI for inline image input.
    """
    if not _have_key():
        raise ReasoningUnavailable("No reasoning provider key configured")
    client = _openai_client()
    data_uri = f"data:{media_type};base64,{image_b64}"
    resp = await client.chat.completions.create(
        model=_model_vision(),
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_uri}},
                    {"type": "text", "text": user},
                ],
            },
        ],
    )
    return (resp.choices[0].message.content or "").strip()


def _strip_code_fences(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.endswith("```"):
            s = s[:-3]
    return s.strip()


# Backwards-compat helper for the unused inline base64 import on some paths.
__all__ = ["reason", "reason_json", "reason_vision", "ReasoningUnavailable"]
_ = _b64  # silence linter if unused above
