"""Auditor — verify every citation resolves; flag hallucinations."""
from __future__ import annotations

import asyncio
import logging
from uuid import UUID

import httpx

from apps.api.schemas import Audit, Brief, CitationCheck
from apps.api.tools.trace import trace_span

log = logging.getLogger(__name__)


async def _check_one(client: httpx.AsyncClient, url: str) -> CitationCheck:
    try:
        r = await client.head(url, follow_redirects=True, timeout=8)
        ok = r.status_code < 400
        if not ok:
            # Some sites 405 on HEAD; try GET with a tiny range.
            r2 = await client.get(
                url, follow_redirects=True, timeout=8, headers={"Range": "bytes=0-1024"}
            )
            ok = r2.status_code < 400
            return CitationCheck(url=url, status=r2.status_code, ok=ok)
        return CitationCheck(url=url, status=r.status_code, ok=ok)
    except Exception as e:  # noqa: BLE001
        log.warning("audit check failed for %s: %s", url, e)
        return CitationCheck(url=url, status=0, ok=False)


async def run(workflow_id: UUID, brief: Brief) -> Audit:
    async with trace_span(
        workflow_id, agent="auditor", label="Verify citations"
    ) as span:
        span.set_input({"citation_count": len(brief.citations)})
        if not brief.citations:
            audit = Audit(
                citations_verified=0,
                citations_failed=[],
                approved=False,
                notes="No citations supplied.",
            )
            span.set_output(audit.model_dump(mode="json"))
            return audit

        async with httpx.AsyncClient() as client:
            checks = await asyncio.gather(
                *[_check_one(client, c.url) for c in brief.citations]
            )
        verified = sum(1 for c in checks if c.ok)
        failed = [c for c in checks if not c.ok]
        approved = verified >= max(1, len(checks) // 2)
        audit = Audit(
            citations_verified=verified,
            citations_failed=failed,
            hallucination_score=1.0 - (verified / len(checks)),
            approved=approved,
            notes=(
                f"{verified}/{len(checks)} citation URLs resolved with 2xx/3xx."
            ),
        )
        span.set_output(
            {
                "verified": verified,
                "failed": len(failed),
                "approved": approved,
            }
        )
        return audit
