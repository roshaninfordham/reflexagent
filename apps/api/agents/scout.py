"""Scout — fan out to FDA / EMA / PubMed via NimbleWay."""
from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from apps.api.schemas import NormalizedRecall, ScoutFinding, ScoutFindings
from apps.api.tools.nimble import nimble_search
from apps.api.tools.trace import trace_span

log = logging.getLogger(__name__)


SCOUT_QUERIES = {
    "faers": (
        "FDA FAERS adverse event reports for {drug} in past 30 days. "
        "Prefer openfda.gov and fda.gov sources. Include MedWatch IDs if any."
    ),
    "ema": (
        "European Medicines Agency safety updates, PRAC recommendations, "
        "and DHPC letters for {drug} from past 60 days. Prefer ema.europa.eu."
    ),
    "pubmed": (
        "Peer-reviewed safety case reports about {drug} published on PubMed "
        "in past 6 months. Prefer pubmed.ncbi.nlm.nih.gov. Include PMIDs."
    ),
}


async def _run_one(workflow_id: UUID, source: str, query: str) -> list[ScoutFinding]:
    async with trace_span(
        workflow_id,
        agent="scout",
        step="tool_call",
        target=source,
        label=f"NimbleWay → {source}",
    ) as span:
        span.set_input({"query": query})
        try:
            raw = await nimble_search(query, num_results=6)
        except Exception as e:  # noqa: BLE001
            log.warning("scout subquery for %s failed: %s", source, e)
            raw = []
        out = [
            ScoutFinding(
                source=source,
                title=r.get("title", "")[:200],
                url=r.get("url", ""),
                snippet=r.get("snippet", "")[:500],
                date=r.get("date"),
            )
            for r in raw
            if r.get("url")
        ][:5]
        span.set_output({"results": len(out)})
        return out


async def run(workflow_id: UUID, normalized: NormalizedRecall) -> ScoutFindings:
    drug = normalized.normalized_drug
    async with trace_span(
        workflow_id, agent="scout", label=f"Web scout for {drug}"
    ) as span:
        span.set_input({"drug": drug})
        faers, ema, pubmed = await asyncio.gather(
            _run_one(workflow_id, "fda", SCOUT_QUERIES["faers"].format(drug=drug)),
            _run_one(workflow_id, "ema", SCOUT_QUERIES["ema"].format(drug=drug)),
            _run_one(workflow_id, "pubmed", SCOUT_QUERIES["pubmed"].format(drug=drug)),
        )
        findings = ScoutFindings(
            faers=faers,
            ema=ema,
            pubmed=pubmed,
            confidence_per_source={
                "fda": 1.0 if faers else 0.0,
                "ema": 1.0 if ema else 0.0,
                "pubmed": 1.0 if pubmed else 0.0,
            },
        )
        span.set_output(
            {
                "fda_results": len(faers),
                "ema_results": len(ema),
                "pubmed_results": len(pubmed),
            }
        )
        return findings
