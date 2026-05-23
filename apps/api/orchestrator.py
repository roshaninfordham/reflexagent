"""Orchestrator — runs the 10-agent swarm in the correct dependency order."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from uuid import UUID, uuid4

from apps.api.agents import (
    auditor,
    cohort,
    inbound,
    publisher,
    recon,
    routing_comms,
    scout,
    triage,
    verify_counter,
    writer,
)
from apps.api.schemas import AgentEvent, TriggerPayload, WorkflowResult
from apps.api.tools import clickhouse_client
from apps.api.tools.trace import emit_event

log = logging.getLogger(__name__)


# In-memory result cache (UI polls /api/v1/workflow/{id}).
_results: dict[UUID, WorkflowResult] = {}


def get_result(workflow_id: UUID) -> WorkflowResult | None:
    return _results.get(workflow_id)


def list_recent(limit: int = 25) -> list[WorkflowResult]:
    items = list(_results.values())
    items.sort(key=lambda w: w.started_at, reverse=True)
    return items[:limit]


def _persist_workflow(result: WorkflowResult) -> None:
    try:
        clickhouse_client.insert(
            "workflows",
            [
                {
                    "workflow_id": str(result.workflow_id),
                    "payload_json": json.dumps(result.payload.model_dump(mode="json")),
                    "status": result.status if result.status != "running" else "running",
                    "completed_at": result.completed_at,
                    "drug_name": (result.normalized.normalized_drug if result.normalized else (result.payload.drug_name or "")),
                    "source": result.payload.source,
                    "brief_id": str(result.brief.brief_id) if result.brief else None,
                    "error": result.error,
                }
            ],
        )
    except Exception as e:  # noqa: BLE001
        log.warning("workflow persist failed: %s", e)


async def orchestrate(payload: TriggerPayload) -> WorkflowResult:
    workflow_id = uuid4()
    result = WorkflowResult(workflow_id=workflow_id, payload=payload)
    _results[workflow_id] = result

    await emit_event(
        AgentEvent(
            workflow_id=workflow_id,
            agent="orchestrator",
            step="start",
            label=f"Workflow started ({payload.source})",
            data={"source": payload.source, "drug": payload.drug_name},
            at=datetime.utcnow(),
        )
    )

    try:
        result.normalized = await inbound.run(workflow_id, payload)

        # Phase A: Scout + Recon in parallel (Recon doesn't need Scout).
        scout_task = asyncio.create_task(scout.run(workflow_id, result.normalized))
        recon_task = asyncio.create_task(recon.run(workflow_id, result.normalized))
        result.scout, result.recon = await asyncio.gather(scout_task, recon_task)

        # Phase B: Triage (depends on Scout) + Cohort (independent) in parallel.
        triage_task = asyncio.create_task(
            triage.run(workflow_id, result.normalized, result.scout)
        )
        cohort_task = asyncio.create_task(cohort.run(workflow_id, result.normalized))
        result.triage, result.cohort = await asyncio.gather(triage_task, cohort_task)

        # Phase C: Verify+Counter (depends on Scout + Triage).
        result.verification = await verify_counter.run(
            workflow_id, result.normalized, result.scout, result.triage
        )

        # Phase D: Routing & Comms (needs Verification + Cohort).
        result.comms = await routing_comms.run(
            workflow_id,
            result.normalized,
            result.triage,
            result.verification,
            result.cohort,
        )

        # Phase E: Writer (needs everything).
        result.brief = await writer.run(
            workflow_id,
            result.normalized,
            result.scout,
            result.triage,
            result.recon,
            result.verification,
            result.cohort,
        )

        # Phase F: Auditor → Publisher.
        result.audit = await auditor.run(workflow_id, result.brief)
        result.published = await publisher.run(
            workflow_id,
            result.brief,
            result.audit,
            cohort_count=result.cohort.patient_count,
            cohort_high_risk=result.cohort.high_risk_count,
            agents_verified=result.audit.citations_verified,
        )

        result.status = "completed"
        result.completed_at = datetime.utcnow()
    except Exception as e:  # noqa: BLE001
        log.exception("orchestrator failed")
        result.status = "failed"
        result.error = str(e)
        result.completed_at = datetime.utcnow()

    await emit_event(
        AgentEvent(
            workflow_id=workflow_id,
            agent="orchestrator",
            step="end",
            label=f"Workflow {result.status}",
            data={
                "status": result.status,
                "published_url": result.published.cited_md_url if result.published else None,
            },
            at=datetime.utcnow(),
        )
    )

    _persist_workflow(result)
    return result
