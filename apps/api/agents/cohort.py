"""Cohort — identify affected patients from the fixture."""
from __future__ import annotations

import logging
from uuid import UUID

from apps.api.schemas import Cohort, CohortDemographics, NormalizedRecall
from apps.api.tools import clickhouse_client
from apps.api.tools.trace import trace_span

log = logging.getLogger(__name__)


def _age_band(age: int) -> str:
    if age < 18:
        return "<18"
    if age < 40:
        return "18-39"
    if age < 65:
        return "40-64"
    if age < 75:
        return "65-74"
    return "75+"


async def run(workflow_id: UUID, normalized: NormalizedRecall) -> Cohort:
    drug = normalized.normalized_drug
    lots = normalized.lot_numbers or []

    # Fuzzy match: many fixture rows store "Metformin Hcl" while the LLM may
    # normalize to "Metformin". Use a substring match over the first 6 chars
    # of the normalized drug so common stems still match.
    stem = drug.split()[0] if drug else ""

    async with trace_span(
        workflow_id,
        agent="cohort",
        target="clickhouse",
        label=f"Affected cohort for {drug}",
    ) as span:
        span.set_input({"drug": drug, "stem": stem, "lots": lots})
        try:
            if lots:
                sql = """
                    SELECT patient_id, age, sex, conditions
                    FROM patients
                    WHERE arrayExists(d -> positionCaseInsensitive(d, %(stem)s) > 0, drugs_taken)
                      AND hasAny(lots_dispensed, %(lots)s)
                """
                params = {"stem": stem, "lots": lots}
            else:
                sql = """
                    SELECT patient_id, age, sex, conditions
                    FROM patients
                    WHERE arrayExists(d -> positionCaseInsensitive(d, %(stem)s) > 0, drugs_taken)
                """
                params = {"stem": stem}
            rows = clickhouse_client.query_rows(sql, params)
        except Exception as e:  # noqa: BLE001
            log.warning("cohort SQL failed: %s", e)
            rows = []

        ages = {"<18": 0, "18-39": 0, "40-64": 0, "65-74": 0, "75+": 0}
        sex = {"M": 0, "F": 0, "Other": 0}
        high_risk = 0
        for r in rows:
            band = _age_band(int(r.get("age", 0)))
            ages[band] = ages.get(band, 0) + 1
            sx = str(r.get("sex", "Other"))
            sex[sx] = sex.get(sx, 0) + 1
            cond = [str(c).lower() for c in (r.get("conditions") or [])]
            if int(r.get("age", 0)) >= 75 or any("ckd" in c or "renal" in c for c in cond):
                high_risk += 1

        result = Cohort(
            patient_count=len(rows),
            high_risk_count=high_risk,
            demographics=CohortDemographics(by_age_band=ages, by_sex=sex),
            sample_ids=[str(r["patient_id"]) for r in rows[:5]],
        )
        span.set_output(
            {
                "patient_count": result.patient_count,
                "high_risk_count": result.high_risk_count,
            }
        )
        return result
