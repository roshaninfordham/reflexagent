"""In-memory cost + usage tracker.

Counts tokens per provider call (NIM text, NIM vision, BioNeMo, NimbleWay) and
exposes a single endpoint summary. Resets on process restart. Rate limit hits
are tracked too so the UI can show a backoff state.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Any

# Cents per 1M tokens / cents per call. Rough; for display.
PRICES = {
    "nim_text_input_per_m": 40,   # $0.40 / 1M
    "nim_text_output_per_m": 40,
    "nim_vision_input_per_m": 40,
    "nim_vision_output_per_m": 40,
    "nimble_per_call": 10,        # $0.10 per SERP call (rough)
    "bionemo_per_call": 0,        # free endpoint
    "clickhouse_per_query": 0,    # free tier
    "senso_per_publish": 0,       # free tier
}

# Public pricing — what we'd charge customers.
PUBLIC_TIERS = [
    {
        "name": "Public Feed",
        "price": "$0",
        "cadence": "free",
        "for": "Anyone — independent pharmacists, journalists, researchers",
        "includes": [
            "Read-only access to the cited.md public feed",
            "All verified safety briefs with primary-source citations",
            "Counter-evidence summaries for every recall",
        ],
        "cta": "Open cited.md",
    },
    {
        "name": "Solo",
        "price": "$0.50",
        "cadence": "per query",
        "for": "Rural pharmacists, on-demand investigators",
        "includes": [
            "Everything in Public Feed",
            "Pay-per-query premium sub-briefs (subgroup analysis, formulary alternatives)",
            "x402 / Coinbase CDP — no subscription required",
            "Voice agent + tool execution",
        ],
        "cta": "Try Premium",
    },
    {
        "name": "Hospital",
        "price": "$50–200k",
        "cadence": "per year per facility",
        "for": "Health systems, P&T committees",
        "includes": [
            "Full 11-agent swarm on your inventory + EHR feed",
            "Routing & Comms drafts auto-dispatched to your destinations",
            "BioNeMo-ranked therapeutic substitutes with structure previews",
            "ClickHouse audit trail for Joint Commission compliance",
            "Datadog LLM Observability + SOC2-ready logs",
        ],
        "cta": "Book a pilot",
    },
    {
        "name": "Pharma",
        "price": "$50–500k",
        "cadence": "per year per drug",
        "for": "Biopharma compliance, MSL teams",
        "includes": [
            "Continuous monitoring per branded SKU",
            "Custom adversarial counter-evidence agents",
            "Drug-portfolio-wide GEO publishing via Senso",
            "Federal RFI-aligned deployments (CMS CRUSH, FDA SaMD)",
            "On-call engineering + dedicated org workspace",
        ],
        "cta": "Contact sales",
    },
]


class Tracker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.started_at = time.time()
        self.calls: defaultdict[str, int] = defaultdict(int)
        self.tokens_in: defaultdict[str, int] = defaultdict(int)
        self.tokens_out: defaultdict[str, int] = defaultdict(int)
        self.rate_limit_hits: int = 0
        self.last_rate_limit_at: float | None = None
        self.last_call_at: float | None = None

    def record_llm(self, provider: str, tokens_in: int, tokens_out: int) -> None:
        with self._lock:
            self.calls[provider] += 1
            self.tokens_in[provider] += max(0, tokens_in)
            self.tokens_out[provider] += max(0, tokens_out)
            self.last_call_at = time.time()

    def record_call(self, provider: str) -> None:
        with self._lock:
            self.calls[provider] += 1
            self.last_call_at = time.time()

    def record_rate_limit(self) -> None:
        with self._lock:
            self.rate_limit_hits += 1
            self.last_rate_limit_at = time.time()

    def is_rate_limited(self, window_seconds: int = 30) -> bool:
        if not self.last_rate_limit_at:
            return False
        return (time.time() - self.last_rate_limit_at) < window_seconds

    def summary(self) -> dict[str, Any]:
        with self._lock:
            uptime_s = int(time.time() - self.started_at)
            total_cost_cents = 0
            per_provider = {}
            for provider in set(self.calls) | set(self.tokens_in) | set(self.tokens_out):
                tin = self.tokens_in[provider]
                tout = self.tokens_out[provider]
                calls = self.calls[provider]
                cost = 0
                if provider == "nim_text":
                    cost = (tin * PRICES["nim_text_input_per_m"] + tout * PRICES["nim_text_output_per_m"]) / 1_000_000
                elif provider == "nim_vision":
                    cost = (tin * PRICES["nim_vision_input_per_m"] + tout * PRICES["nim_vision_output_per_m"]) / 1_000_000
                elif provider == "nimble":
                    cost = calls * PRICES["nimble_per_call"]
                elif provider == "bionemo":
                    cost = calls * PRICES["bionemo_per_call"]
                elif provider == "clickhouse":
                    cost = calls * PRICES["clickhouse_per_query"]
                elif provider == "senso":
                    cost = calls * PRICES["senso_per_publish"]
                per_provider[provider] = {
                    "calls": calls,
                    "tokens_in": tin,
                    "tokens_out": tout,
                    "cost_cents": cost,
                }
                total_cost_cents += cost
            return {
                "uptime_seconds": uptime_s,
                "total_calls": sum(self.calls.values()),
                "total_tokens_in": sum(self.tokens_in.values()),
                "total_tokens_out": sum(self.tokens_out.values()),
                "total_cost_cents": total_cost_cents,
                "per_provider": per_provider,
                "rate_limit_hits": self.rate_limit_hits,
                "rate_limited_now": self.is_rate_limited(),
                "last_rate_limit_at": self.last_rate_limit_at,
                "last_call_at": self.last_call_at,
            }


tracker = Tracker()
