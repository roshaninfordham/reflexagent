"""Publisher — push the verified brief to Senso (with git fallback)."""
from __future__ import annotations

import logging
from datetime import datetime
from uuid import UUID

from apps.api.schemas import Audit, Brief, Published
from apps.api.settings import get_settings
from apps.api.tools import clickhouse_client
from apps.api.tools.senso import publish_brief, render_brief_markdown, _slugify
from apps.api.tools.trace import trace_span

log = logging.getLogger(__name__)


async def run(
    workflow_id: UUID,
    brief: Brief,
    audit: Audit,
    cohort_count: int = 0,
    cohort_high_risk: int = 0,
    agents_verified: int = 9,
) -> Published:
    async with trace_span(
        workflow_id,
        agent="publisher",
        target="senso",
        label="Publish to cited.md",
    ) as span:
        span.set_input(
            {"drug": brief.drug_name, "citations": len(brief.citations)}
        )

        body_md = render_brief_markdown(
            title=brief.title,
            drug_name=brief.drug_name,
            summary=brief.summary,
            findings=brief.findings,
            counter_evidence_summary=brief.counter_evidence_summary,
            counter_evidence_found=brief.counter_evidence_found,
            cohort_count=cohort_count,
            cohort_high_risk=cohort_high_risk,
            recommendation=brief.recommendation,
            severity_score=brief.severity_score,
            citations=[
                {
                    "title": c.title,
                    "url": c.url,
                    "accessed_at": c.accessed_at.isoformat(),
                }
                for c in brief.citations
            ],
            agents_verified=agents_verified,
            workflow_id=str(workflow_id),
            published_at=datetime.utcnow().isoformat(timespec="seconds") + "Z",
        )
        slug = f"recall-{_slugify(brief.drug_name)}-{str(brief.brief_id)[:8]}"
        url, fallback = await publish_brief(
            title=brief.title,
            slug=slug,
            body_md=body_md,
            metadata={
                "drug": brief.drug_name,
                "severity_score": brief.severity_score,
                "counter_evidence_found": brief.counter_evidence_found,
                "citation_count": len(brief.citations),
                "agents_verified": agents_verified,
            },
        )

        try:
            clickhouse_client.insert(
                "published_briefs",
                [
                    {
                        "brief_id": str(brief.brief_id),
                        "workflow_id": str(workflow_id),
                        "drug_name": brief.drug_name,
                        "cited_md_url": url,
                        "title": brief.title,
                        "summary": brief.summary,
                        "severity_score": brief.severity_score,
                        "citation_count": len(brief.citations),
                        "verifying_agents": [
                            "scout",
                            "triage",
                            "recon",
                            "verify_counter",
                            "writer",
                            "auditor",
                        ],
                        "counter_evidence_found": brief.counter_evidence_found,
                        "x402_revenue_usd": 0.0,
                    }
                ],
            )
        except Exception as e:  # noqa: BLE001
            log.warning("published_briefs insert failed: %s", e)

        result = Published(
            cited_md_url=url,
            brief_id=brief.brief_id,
            fallback=fallback,
        )
        span.set_output({"url": url, "fallback": fallback})
        return result
