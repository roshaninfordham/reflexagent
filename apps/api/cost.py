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

# Cents per 1M tokens / cents per call — production-deployment rates.
# Sources: NVIDIA NIM price card, NimbleWay scaled-tier, observed in our usage.
PRICES = {
    "nim_text_input_per_m": 40,   # $0.40 / 1M input tokens (Llama 3.3 70B)
    "nim_text_output_per_m": 120, # $1.20 / 1M output tokens
    "nim_vision_input_per_m": 50, # $0.50 / 1M input tokens (Llama 3.2 90B Vision)
    "nim_vision_output_per_m": 150,
    "nimble_per_call": 5,         # $0.05 / SERP call at scaled tier (was $0.10 list)
    "bionemo_per_call": 0,        # free health endpoint while in early access
    "clickhouse_per_query": 0,    # production: ~$0.0001/query, displayed as 0
    "senso_per_publish": 0,       # free tier covers up to 10k publishes/mo
}


# ---- Production unit economics (per-event cost, fully loaded) ----
# Variable per FULL base workflow (11-agent swarm fires end-to-end):
#   NIM (~42k tokens text mix)          ≈ $0.025
#   NimbleWay (~3 SERP calls @ $0.05)   ≈ $0.150
#   ClickHouse SQL + Datadog spans      ≈ $0.005
#   Senso publish                       ≈ $0.005
#   Email + SMS dispatch                ≈ $0.005
#   ──────────────────────────────────────────────
#   ~$0.19 per workflow
#
# Variable per PREMIUM SUB-BRIEF (deep analysis layered on a brief):
#   NIM (~7k tokens text mix)           ≈ $0.005
#   Datadog spans + ClickHouse insert   ≈ $0.0005
#   x402 settlement gas (Base mainnet)  ≈ $0.001 (zero on testnet)
#   ──────────────────────────────────────────────
#   ~$0.007 per sub-brief
#
# Fixed monthly infrastructure cost at ~50-facility scale:
#   Backend hosting (Fly.io / Render, 4 vCPU + 8GB, multi-region)  $200
#   Frontend (Vercel Pro)                                          $200
#   ClickHouse Cloud (production tier, 1 TB storage, 4 vCPU)       $400
#   Datadog (LLM Obs + APM + 5 hosts)                            $1,200
#   Senso (paid tier)                                              $200
#   NimbleWay (base subscription)                                  $500
#   Postmark + Twilio (base)                                        $50
#   Domain, SSL, third-party monitoring                             $50
#   ────────────────────────────────────────────────────────────────────
#   ~$2,800/mo  →  ~$33,600/year fixed
#
# Per-facility allocation at 50 facilities = ~$670/facility/year fixed
# + ~$130/facility/year variable (500 workflows + 5,000 sub-briefs)
# = ~$800 fully-loaded cost per facility per year
#
# Hospital pricing at $75k starts → ~93× gross margin (98.9%)
# Pharma  pricing at $150k/SKU    → ~28× gross margin (96.5%)
# These match SaaS-typical 85–95% gross margins.

# Public pricing — what we charge customers.
PUBLIC_TIERS = [
    {
        "name": "Public Feed",
        "price": "$0",
        "cadence": "forever · ad-free",
        "for": "Independent pharmacists, journalists, researchers",
        "includes": [
            "Read-only access to the cited.md public feed",
            "All verified safety briefs with primary-source citations",
            "Counter-evidence summaries for every recall",
            "Historical recall replays (Valsartan, Vioxx, Tylenol, etc.)",
            "Rate-limited to 10 sub-brief reads / day",
        ],
        "cta": "Open cited.md",
        "popular": False,
    },
    {
        "name": "Solo",
        "price": "$0.50",
        "cadence": "per sub-brief · pay as you go",
        "for": "Rural pharmacists, on-demand investigators, AI agents",
        "includes": [
            "Everything in Public Feed",
            "Pay-per-question premium sub-briefs (~10s delivery)",
            "x402 / Coinbase CDP — no account, no card",
            "Voice + chat copilot with tool execution",
            "Cost: ~$0.007 / query · 98.6% gross margin",
        ],
        "cta": "Try Premium",
        "popular": False,
    },
    {
        "name": "Hospital",
        "price": "Starts at $75k",
        "cadence": "per year, per facility",
        "for": "Health systems, P&T committees, hospital pharmacy directors",
        "includes": [
            "Full 11-agent swarm on your inventory + EHR feed",
            "Routing & Comms drafts auto-dispatched to your channels",
            "BioNeMo-ranked therapeutic substitutes with structure previews",
            "ClickHouse audit trail for Joint Commission compliance",
            "Datadog LLM Observability + SOC2-ready logs · dedicated Slack",
        ],
        "cta": "Book a pilot",
        "popular": True,
    },
    {
        "name": "Pharma",
        "price": "Starts at $150k",
        "cadence": "per year, per branded SKU",
        "for": "Biopharma PV, compliance, MSL teams",
        "includes": [
            "Continuous monitoring per branded SKU (24/7 swarm)",
            "Custom adversarial counter-evidence agents per portfolio",
            "GEO publishing across the full drug portfolio via Senso",
            "Federal RFI-aligned deployments (CMS CRUSH, FDA SaMD)",
            "On-call engineering + dedicated org workspace + custom SLA",
        ],
        "cta": "Contact sales",
        "popular": False,
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
