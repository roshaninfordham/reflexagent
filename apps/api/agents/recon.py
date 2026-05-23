"""Recon — historical analog search in ClickHouse."""
from __future__ import annotations

import hashlib
import logging
from uuid import UUID

from apps.api.schemas import NormalizedRecall, ReconAnalog, ReconAnalogs
from apps.api.tools import clickhouse_client
from apps.api.tools.trace import trace_span

log = logging.getLogger(__name__)


def _stub_embedding(text: str, dim: int = 1536) -> list[float]:
    """Deterministic stub embedding from the text. Sufficient for demo cosine ranking."""
    h = hashlib.sha256(text.encode("utf-8")).digest()
    raw = (h * ((dim // len(h)) + 1))[:dim]
    # Map bytes to [-1, 1] then unit-normalize
    vec = [(b - 128) / 128.0 for b in raw]
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [v / norm for v in vec]


async def run(workflow_id: UUID, normalized: NormalizedRecall) -> ReconAnalogs:
    async with trace_span(
        workflow_id,
        agent="recon",
        target="clickhouse",
        label="Historical analogs",
    ) as span:
        span.set_input({"drug": normalized.normalized_drug})
        try:
            rows = clickhouse_client.query_rows(
                """
                SELECT drug_name, event_type, severity, source_url, raw_text
                FROM adverse_events
                WHERE drug_name = %(drug)s OR positionCaseInsensitive(drug_name, %(drug)s) > 0
                ORDER BY reported_at DESC
                LIMIT 8
                """,
                {"drug": normalized.normalized_drug},
            )
        except Exception as e:  # noqa: BLE001
            log.warning("recon SQL failed: %s", e)
            rows = []

        analogs = [
            ReconAnalog(
                drug_name=r.get("drug_name", ""),
                event_type=r.get("event_type", ""),
                severity=str(r.get("severity", "")),
                distance=0.0,
                snippet=(r.get("raw_text") or "")[:200],
                source_url=r.get("source_url", ""),
            )
            for r in rows
        ]
        result = ReconAnalogs(
            similar_past_events=analogs,
            pattern_signals=(
                f"{len(analogs)} prior signals retrieved from the 10-year FAERS-shaped index."
                if analogs
                else "No prior signals on file."
            ),
        )
        span.set_output(
            {"count": len(analogs), "pattern_signals": result.pattern_signals}
        )
        return result
