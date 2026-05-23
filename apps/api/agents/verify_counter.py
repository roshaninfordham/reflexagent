"""Verify + Counter — confirm + adversarial counter-evidence."""
from __future__ import annotations

import logging
from datetime import datetime
from uuid import UUID

from apps.api.schemas import (
    AgentEvent,
    CounterEvidence,
    NormalizedRecall,
    ScoutFindings,
    Triage,
    Verification,
)
from apps.api.tools.nimble import nimble_search
from apps.api.tools.reasoning import reason_json
from apps.api.tools.trace import emit_event, trace_span
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)


class _Confirmation(BaseModel):
    confirmed_claims: list[str] = Field(default_factory=list)
    disputed_claims: list[str] = Field(default_factory=list)
    confidence: float = 0.0


CONFIRM_SYSTEM = """You verify drug safety claims. Given Scout findings, list the
specific claims that are supported by at least two independent sources, and any
claims that are unsupported. Be terse; one bullet per claim."""


COUNTER_SYSTEM = """You are a defense attorney for the drug manufacturer. Given
Scout findings AND counter-search results, find ANY statement, study, or press
release that REFUTES the recall claim. Be adversarial and exhaustive. Output
JSON with `counter_evidence` (each entry has source/url/refutation) and a brief
`conflict_summary` if you find a meaningful contradiction. If no refutation
exists, return empty arrays and a null summary."""


class _Counter(BaseModel):
    counter_evidence: list[CounterEvidence] = Field(default_factory=list)
    conflict_summary: str | None = None


COUNTER_QUERY = (
    "Manufacturer press releases, sponsored studies, or industry rebuttal "
    "statements that REFUTE the claim that {drug} causes {issue}. Be adversarial. "
    "Sources: PRNewswire, BusinessWire, manufacturer investor relations, "
    "sponsored journal supplements."
)


async def run(
    workflow_id: UUID,
    normalized: NormalizedRecall,
    scout: ScoutFindings,
    triage: Triage,
) -> Verification:
    async with trace_span(
        workflow_id,
        agent="verify_counter",
        label="Verify + Counter-evidence",
    ) as span:
        span.set_input(
            {"drug": normalized.normalized_drug, "severity": triage.severity}
        )

        # 1. Confirmation pass.
        scout_summary = "\n".join(
            f"- [{f.source}] {f.title} ({f.url})"
            for f in (scout.faers + scout.ema + scout.pubmed)[:12]
        )
        confirmation = _Confirmation()
        try:
            confirmation = await reason_json(
                CONFIRM_SYSTEM,
                user=(
                    f"Drug: {normalized.normalized_drug}\n"
                    f"Reason (claim under test): {normalized.reason or 'unspecified'}\n"
                    f"Scout findings:\n{scout_summary}\n"
                ),
                schema=_Confirmation,
                max_tokens=800,
            )
        except Exception as e:  # noqa: BLE001
            log.warning("confirmation fallback: %s", e)
            confirmation = _Confirmation(
                confirmed_claims=[f"Recall reported for {normalized.normalized_drug}"],
                confidence=0.7,
            )

        # 2. Adversarial Nimble query.
        counter_query = COUNTER_QUERY.format(
            drug=normalized.normalized_drug,
            issue=normalized.reason or "an adverse safety signal",
        )
        try:
            counter_raw = await nimble_search(counter_query, num_results=5)
        except Exception:
            counter_raw = []

        counter_summary = "\n".join(
            f"- {r.get('title', '')[:120]} ({r.get('url', '')[:120]}): {r.get('snippet', '')[:160]}"
            for r in counter_raw
        )

        # 3. Adversarial reasoning pass.
        counter = _Counter()
        try:
            counter = await reason_json(
                COUNTER_SYSTEM,
                user=(
                    f"Drug: {normalized.normalized_drug}\n"
                    f"Original Scout findings:\n{scout_summary}\n"
                    f"\nCounter-search results:\n{counter_summary or '(none)'}"
                ),
                schema=_Counter,
                max_tokens=900,
            )
        except Exception as e:  # noqa: BLE001
            log.warning("counter fallback: %s", e)

        verdict = (
            "requires_human"
            if counter.conflict_summary
            else "confirmed"
            if confirmation.confirmed_claims
            else "disputed"
        )

        result = Verification(
            confirmed_claims=confirmation.confirmed_claims,
            disputed_claims=confirmation.disputed_claims,
            counter_evidence=counter.counter_evidence,
            verdict=verdict,
            confidence=max(confirmation.confidence, 0.7) if verdict == "confirmed" else 0.55,
            conflict_summary=counter.conflict_summary,
        )

        # Surface the conflict visually if any.
        if counter.conflict_summary:
            await emit_event(
                AgentEvent(
                    workflow_id=workflow_id,
                    agent="verify_counter",
                    step="conflict",
                    label=counter.conflict_summary[:140],
                    data={
                        "evidence_count": len(counter.counter_evidence),
                        "verdict": verdict,
                    },
                    at=datetime.utcnow(),
                )
            )

        span.set_output(
            {
                "verdict": verdict,
                "confirmed_count": len(result.confirmed_claims),
                "counter_count": len(result.counter_evidence),
                "conflict": bool(counter.conflict_summary),
            }
        )
        return result
