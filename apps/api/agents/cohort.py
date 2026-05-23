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

    async with trace_span(
        workflow_id,
        agent="cohort",
        target="clickhouse",
        label=f"Affected cohort for {drug}",
    ) as span:
        span.set_input({"drug": drug, "lots": lots})
        try:
            if lots:
                sql = """
                    SELECT patient_id, age, sex, conditions
                    FROM patients
                    WHERE has(drugs_taken, %(drug)s)
                      AND hasAny(lots_dispensed, %(lots)s)
                """
                params = {"drug": drug, "lots": lots}
            else:
                sql = """
                    SELECT patient_id, age, sex, conditions
                    FROM patients
                    WHERE has(drugs_taken, %(drug)s)
                """
                params = {"drug": drug}
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
