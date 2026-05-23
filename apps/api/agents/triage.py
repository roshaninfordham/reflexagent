"""Triage — classify severity / urgency."""
from __future__ import annotations

import logging
from uuid import UUID

from apps.api.schemas import NormalizedRecall, ScoutFindings, Triage
from apps.api.tools.reasoning import reason_json
from apps.api.tools.trace import trace_span

log = logging.getLogger(__name__)


SYSTEM = """You are an FDA recall triage analyst. Apply the FDA Class rubric:
- Class I: reasonable probability of serious adverse health consequences or death.
- Class II: temporary or medically reversible adverse health consequences; probability of serious consequences is remote.
- Class III: not likely to cause adverse health consequences.

Urgency tiers:
- immediate (notify within hours; Class I or active patient harm signal)
- 24h (notify within 1 day; Class II with high exposure)
- 7d (administrative; Class III or low exposure)

Identify affected populations (e.g., "geriatric", "pediatric", "CKD",
"pregnancy") only when supported by findings. Provide a one-sentence rationale.
"""


async def run(
    workflow_id: UUID,
    normalized: NormalizedRecall,
    scout: ScoutFindings,
) -> Triage:
    async with trace_span(
        workflow_id,
        agent="triage",
        label=f"Triage {normalized.normalized_drug}",
    ) as span:
        span.set_input({"drug": normalized.normalized_drug})
        user = (
            f"Drug: {normalized.normalized_drug}\n"
            f"Reported recall class (raw): {normalized.recall_class or 'unknown'}\n"
            f"Reason given: {normalized.reason or 'unknown'}\n"
            f"FDA findings: {[f.title for f in scout.faers][:3]}\n"
            f"EMA findings: {[f.title for f in scout.ema][:3]}\n"
            f"PubMed findings: {[f.title for f in scout.pubmed][:3]}\n"
        )
        try:
            result = await reason_json(SYSTEM, user, schema=Triage, max_tokens=600)
        except Exception as e:  # noqa: BLE001
            log.warning("triage fallback: %s", e)
            cls = (normalized.recall_class or "II").upper()
            result = Triage(
                severity=cls if cls in {"I", "II", "III"} else "II",
                severity_score={"I": 9.0, "II": 6.0, "III": 3.0}.get(cls, 6.0),
                urgency="immediate" if cls == "I" else "24h",
                affected_populations=["general"],
                rationale="Fallback triage based on supplied recall class.",
            )
        span.set_output(result.model_dump(mode="json"))
        return result
