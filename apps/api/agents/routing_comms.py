"""Routing & Comms — draft pharmacist/clinician/patient communications."""
from __future__ import annotations

import logging
from uuid import UUID

from apps.api.schemas import Cohort, Comms, NormalizedRecall, Triage, Verification
from apps.api.tools.reasoning import reason_json
from apps.api.tools.trace import trace_span

log = logging.getLogger(__name__)


SYSTEM = """ROLE
You are the Routing & Communications agent for a hospital pharmacy operations
team. You produce three role-specific communications + a routing list in a
single JSON object.

VOICE & CONSTRAINTS
- pharmacist_memo (≤200 words, clinical/procedural):
    Audience: Pharmacy Director, central pharmacy staff.
    Open with the action verb ("Quarantine..." / "Hold dispensing of..."),
    cite NDC + every lot number, name the recall class, give a deadline.
    Reference SOP IDs only if known; do not fabricate.

- clinician_alert (≤120 words, terse, actionable):
    Audience: attending physicians on service.
    Lead with affected drug + class. State patient-impact estimate from the
    Cohort agent. Give the one specific action ("Review at next encounter" /
    "Switch to <substitute> per P&T", "Hold scheduled dose until further notice").

- patient_letter (≤150 words, 8th-grade reading level, calm and reassuring):
    Audience: patients receiving the drug.
    Open with "Dear patient,". No jargon, no panic words. State that this is
    a precaution, give the pharmacy contact phone and hours, give a single
    next step ("please bring your remaining tablets to any pharmacy window").

ROUTING TARGETS
Return ≥3 and ≤6 role names from this canonical list (or close variants):
"Pharmacy Director", "Pharmacy Buyer", "P&T Committee Chair",
"Attending Internal Medicine", "Attending Hospitalist", "Patient Safety
Officer", "Risk Management", "Billing/Coding Lead", "ED Charge Pharmacist".
Pick by relevance to the recall class and the affected population.

RULES
- Never invent an FDA classification. Restate only what Triage provided.
- Never make a clinical recommendation beyond "review", "hold dispensing",
  "switch to a substitute per P&T". You are operational, not prescribing.
- Never use scare words ("dangerous", "deadly") in the patient letter.
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
