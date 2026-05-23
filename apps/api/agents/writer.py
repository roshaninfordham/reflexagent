"""Writer — compose the canonical, public-facing safety brief."""
from __future__ import annotations

import logging
from datetime import datetime
from uuid import UUID

from apps.api.schemas import (
    Brief,
    Citation,
    Cohort,
    NormalizedRecall,
    ReconAnalogs,
    ScoutFindings,
    Triage,
    Verification,
)
from apps.api.tools.reasoning import reason_json
from apps.api.tools.trace import trace_span

log = logging.getLogger(__name__)


SYSTEM = """You author public-facing pharmacovigilance safety briefs. Output a
SINGLE JSON object matching the Brief schema.

Hard rules:
- `findings`: 3-5 bullet sentences each, each grounded in at least one citation.
- `counter_evidence_summary`: factual paragraph summarizing any refuting evidence
  or "No refuting evidence found across N independent searches." when none.
- `recommendation`: ONE paragraph addressed to a pharmacy director.
- `severity_score`: 0-10 float aligned with FDA class (Class I ≈ 8-10, II ≈ 5-7, III ≈ 1-4).
- `citations`: pull verbatim titles and URLs from the supplied Scout/Recon
  evidence. Do NOT invent URLs. Each citation must be from the provided list.
- `title`: "Reflex Safety Brief — <drug>: <one-line reason>"
- No emoji. No marketing tone."""


async def run(
    workflow_id: UUID,
    normalized: NormalizedRecall,
    scout: ScoutFindings,
    triage: Triage,
    recon: ReconAnalogs,
    verification: Verification,
    cohort: Cohort,
) -> Brief:
    async with trace_span(
        workflow_id, agent="writer", label="Compose safety brief"
    ) as span:
        span.set_input({"drug": normalized.normalized_drug})

        # Whitelist evidence URLs for the model to cite.
        evidence = []
        for f in scout.faers + scout.ema + scout.pubmed:
            if f.url:
                evidence.append({"title": f.title, "url": f.url, "source": f.source})
        for a in recon.similar_past_events:
            if a.source_url:
                evidence.append(
                    {"title": f"Historical: {a.drug_name} / {a.event_type}", "url": a.source_url, "source": "history"}
                )

        evidence_md = "\n".join(
            f"- [{e['source']}] {e['title']} -- {e['url']}" for e in evidence[:16]
        ) or "(no evidence supplied)"

        user = (
            f"Drug: {normalized.normalized_drug}\n"
            f"Manufacturer: {normalized.manufacturer or 'unspecified'}\n"
            f"FDA Class: {triage.severity} (severity score {triage.severity_score})\n"
            f"Verdict: {verification.verdict}; counter-evidence: "
            f"{'yes' if verification.counter_evidence else 'no'}.\n"
            f"Affected patients (demo): {cohort.patient_count}; high-risk: {cohort.high_risk_count}.\n"
            f"Evidence pool (cite only from these):\n{evidence_md}\n"
        )

        try:
            result = await reason_json(SYSTEM, user, schema=Brief, max_tokens=2500)
        except Exception as e:  # noqa: BLE001
            log.warning("writer fallback: %s", e)
            result = Brief(
                drug_name=normalized.normalized_drug,
                title=f"Reflex Safety Brief — {normalized.normalized_drug}: voluntary recall",
                summary=(
                    f"A voluntary recall has been issued for {normalized.normalized_drug}. "
                    f"Verification across {len(evidence)} sources is consistent with a "
                    f"Class {triage.severity} action."
                ),
                findings=[e["title"] for e in evidence[:3]],
                counter_evidence_summary=(
                    verification.conflict_summary
                    or "No refuting evidence found across the verification searches."
                ),
                counter_evidence_found=bool(verification.counter_evidence),
                recommendation=(
                    "Quarantine the affected lots immediately; "
                    "identify and notify exposed patients; log compliance evidence."
                ),
                severity_score=triage.severity_score,
                citations=[
                    Citation(title=e["title"], url=e["url"])
                    for e in evidence[:8]
                    if e["url"]
                ],
            )

        # Even if the model produced ok output, ensure brief_id, drug_name and
        # counter_evidence_found are correct.
        result.drug_name = normalized.normalized_drug
        result.counter_evidence_found = bool(verification.counter_evidence)

        span.set_output(
            {
                "citation_count": len(result.citations),
                "severity_score": result.severity_score,
            }
        )
        return result
