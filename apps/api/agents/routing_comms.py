"""Routing & Comms — draft pharmacist/clinician/patient communications."""
from __future__ import annotations

import logging
from uuid import UUID

from apps.api.schemas import Cohort, Comms, NormalizedRecall, Triage, Verification
from apps.api.tools.reasoning import reason_json
from apps.api.tools.trace import trace_span

log = logging.getLogger(__name__)


SYSTEM = """You draft operational communications for a hospital pharmacy.
You produce three role-specific drafts in a SINGLE JSON object:

- pharmacist_memo: ≤200 words, clinical tone, references inventory action and lot numbers.
- clinician_alert: ≤120 words, terse, actionable, identifies affected patient population.
- patient_letter: ≤150 words, 8th-grade reading level, no jargon, calm and reassuring tone, ends with how to contact the pharmacy.

Also return routing_targets — an array of org roles to notify, e.g.
["Pharmacy Director", "P&T Chair", "Attending Internal Medicine", "Patient Safety Officer", "Billing/Coding"].
Never fabricate FDA classifications — only restate what's provided.
"""


async def run(
    workflow_id: UUID,
    normalized: NormalizedRecall,
    triage: Triage,
    verification: Verification,
    cohort: Cohort,
) -> Comms:
    async with trace_span(
        workflow_id,
        agent="routing_comms",
        label="Draft pharmacist/clinician/patient comms",
    ) as span:
        span.set_input({"drug": normalized.normalized_drug, "cohort": cohort.patient_count})
        user = (
            f"Drug: {normalized.normalized_drug}\n"
            f"Manufacturer: {normalized.manufacturer or 'unspecified'}\n"
            f"NDC: {normalized.ndc or 'unspecified'}\n"
            f"Lots: {', '.join(normalized.lot_numbers) or 'unspecified'}\n"
            f"Reason: {normalized.reason or 'unspecified'}\n"
            f"FDA Class: {triage.severity} (urgency: {triage.urgency})\n"
            f"Verdict: {verification.verdict}; counter-evidence found: "
            f"{'yes' if verification.counter_evidence else 'no'}.\n"
            f"Affected patients: {cohort.patient_count} "
            f"(high-risk: {cohort.high_risk_count}).\n"
            f"Affected populations: {', '.join(triage.affected_populations) or 'general'}."
        )
        try:
            result = await reason_json(SYSTEM, user, schema=Comms, max_tokens=1400)
        except Exception as e:  # noqa: BLE001
            log.warning("routing_comms fallback: %s", e)
            result = Comms(
                pharmacist_memo=(
                    f"ACTION: Quarantine all lots {', '.join(normalized.lot_numbers) or '(see notice)'} of "
                    f"{normalized.normalized_drug} (NDC {normalized.ndc or 'n/a'}) immediately. "
                    f"Cease dispensing. Coordinate with central pharmacy on patient identification."
                ),
                clinician_alert=(
                    f"Recall: {normalized.normalized_drug}. "
                    f"FDA Class {triage.severity}. {cohort.patient_count} of your patients on this drug; "
                    f"{cohort.high_risk_count} high-risk. Review at next encounter."
                ),
                patient_letter=(
                    f"Dear patient — Your medication ({normalized.normalized_drug}) is part of a "
                    f"voluntary recall. Please stop taking it and contact our pharmacy at your "
                    f"convenience so we can arrange a replacement. There is no immediate emergency."
                ),
                routing_targets=[
                    "Pharmacy Director",
                    "P&T Chair",
                    "Attending Internal Medicine",
                    "Patient Safety Officer",
                ],
            )
        span.set_output({"targets": len(result.routing_targets)})
        return result
