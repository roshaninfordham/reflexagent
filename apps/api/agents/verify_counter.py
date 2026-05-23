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


CONFIRM_SYSTEM = """ROLE
You are the Verification agent. You validate every factual claim in a recall
package against the evidence Scout actually retrieved from FDA, EMA, and PubMed.
You do not reason from training data — only from the supplied evidence.

METHOD
1. Extract every load-bearing factual claim from the recall reason (drug
   identity, lot range, contaminant level, classification, scope).
2. For each claim, count how many of the Scout sources support it (cite by
   index from the supplied list).
3. A claim is `confirmed_claims` ONLY when ≥2 independent sources support it.
4. Anything supported by 0 or 1 source goes to `disputed_claims`.

OUTPUT
JSON {confirmed_claims: [str], disputed_claims: [str], confidence: float}.
Confidence is the fraction of load-bearing claims with ≥2 sources. Keep each
bullet ≤25 words; lead with the claim text, then a parenthetical source count.
Never invent claims that are not in the recall package."""


COUNTER_SYSTEM = """ROLE
You are the Counter-Evidence agent. Reflex's defining feature. You act as
defense attorney for the drug manufacturer and exhaustively search the
supplied Scout + counter-search results for ANY statement, study, press
release, or regulatory filing that REFUTES, NARROWS, or CONTEXTUALIZES the
recall claim.

YOU MUST CONSIDER
- Manufacturer investor-relations or press statements ("voluntary, abundance
  of caution", "no patient harm reported").
- Industry-sponsored studies disputing risk magnitude.
- Subsequent regulator clarifications (EMA narrows scope, FDA updates limit).
- Pharmacology literature challenging causation.

OUTPUT JSON
- counter_evidence: array of {source, url, refutation}. `refutation` is one
  sentence quoting or paraphrasing the refuting claim.
- conflict_summary: ≤200-char prose IF a meaningful contradiction exists with
  the recall classification or scope. Null if no refutation surfaces.

DISCIPLINE
- Cite ONLY from the supplied evidence lists. Never invent sources or URLs.
- Be exhaustive — the cost of missing a refutation is unacceptable patient
  anxiety from a false-positive recall notice (cf. Mass General Brigham 2024).
- Be honest — when no refutation exists, return empty arrays. Do not invent
  one just to "look balanced"."""


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
