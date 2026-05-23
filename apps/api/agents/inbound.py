"""Inbound Processor — normalize and dedup the trigger payload."""
from __future__ import annotations

import logging
from uuid import UUID

from apps.api.schemas import NormalizedRecall, TriggerPayload
from apps.api.tools import clickhouse_client
from apps.api.tools.reasoning import reason_json
from apps.api.tools.trace import trace_span
from pydantic import BaseModel

log = logging.getLogger(__name__)


class _NormOut(BaseModel):
    normalized_drug: str
    drug_class: str


SYSTEM = (
    "You are a pharmacovigilance entity normalizer. Given a raw drug name "
    "(brand or established), return the FDA Established Name in title case "
    "and a high-level drug class. Be terse; no prose."
)


async def run(workflow_id: UUID, payload: TriggerPayload) -> NormalizedRecall:
    drug_input = payload.drug_name or "(unknown)"
    async with trace_span(
        workflow_id, agent="inbound", target="clickhouse", label="normalize+dedup"
    ) as span:
        span.set_input(payload.model_dump(mode="json"))

        # Python-side normalization is usually sufficient. Only invoke the LLM
        # if the drug name has odd characters that suggest OCR or fax noise.
        normalized = drug_input.strip().title()
        drug_class = ""
        if any(ch in drug_input for ch in ["#", "  ", "Rx#"]) and len(drug_input) > 25:
            try:
                out = await reason_json(
                    SYSTEM,
                    user=f"Drug: {drug_input!r}",
                    schema=_NormOut,
                    max_tokens=200,
                )
                normalized = out.normalized_drug or normalized
                drug_class = out.drug_class
            except Exception as e:  # noqa: BLE001
                log.warning("inbound normalization fell back: %s", e)

        # Dedup hint (informational only — we still run; orchestrator records workflow row)
        try:
            existing = clickhouse_client.query_rows(
                "SELECT count() AS c FROM adverse_events WHERE drug_name = %(drug)s "
                "AND hasAny(lot_numbers, %(lots)s)",
                {"drug": normalized, "lots": payload.lot_numbers or [""]},
            )
            span.set_output({"existing_event_count": existing[0]["c"] if existing else 0})
        except Exception:
            span.set_output({"existing_event_count": -1})

        result = NormalizedRecall(
            drug_name=drug_input,
            normalized_drug=normalized,
            drug_class=drug_class,
            ndc=payload.ndc,
            lot_numbers=payload.lot_numbers,
            recall_class=payload.recall_class,
            reason=payload.reason,
            manufacturer=payload.manufacturer,
            source=payload.source,
            faers_anchor=f"https://fis.fda.gov/sense/app/95239e26-e0be-42d9-a960-9a5f7f1c25ee?drug={normalized.replace(' ', '+')}",
        )
        span.set_output(result.model_dump(mode="json"))
        return result
