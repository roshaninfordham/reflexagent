"""Triage — classify severity / urgency."""
from __future__ import annotations

import logging
from uuid import UUID

from apps.api.schemas import NormalizedRecall, ScoutFindings, Triage
from apps.api.tools.reasoning import reason_json
from apps.api.tools.trace import trace_span

log = logging.getLogger(__name__)


SYSTEM = """ROLE
You are the Triage agent inside an autonomous pharmacovigilance system used
by hospital P&T committees. Your job is to classify the severity and urgency
of a drug recall using the FDA's formal rubric — not your opinion.

RUBRIC (FDA Recall Classification, 21 CFR §7.3)
- Class I (severity_score 8.0–10.0): reasonable probability that use of, or
  exposure to, a violative product WILL CAUSE serious adverse health
  consequences or death.
- Class II (severity_score 4.0–7.5): use of, or exposure to, a violative
  product may cause temporary or medically reversible adverse health
  consequences, OR the probability of serious adverse consequences is remote.
- Class III (severity_score 1.0–3.5): use of, or exposure to, a violative
  product is not likely to cause adverse health consequences.

URGENCY (operational)
- immediate: notify within hours. Class I, OR an active patient-harm signal
  in Scout findings, OR known-vulnerable population at exposure.
- 24h: notify within one business day. Class II with substantial exposure.
- 7d: administrative cadence. Class III or limited exposure.

AFFECTED POPULATIONS
Only list populations explicitly supported by the recall reason or Scout
findings. Use canonical labels: "geriatric (≥75)", "pediatric (<18)",
"pregnancy", "CKD stage 3+", "hepatic impairment", "concomitant warfarin".

OUTPUT
Single JSON matching the Triage schema. `rationale` is ONE sentence quoting
the specific evidence that drove your class+urgency. Never inflate above the
FDA's stated class unless Scout surfaced new evidence of harm. Never deflate
below it without explicit refutation.
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
