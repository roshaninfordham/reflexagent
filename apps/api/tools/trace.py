"""In-process trace bus.

Used by every agent. On each `with trace_span(...)` block, the bus:
1. Writes a row to ClickHouse `agent_traces` on completion.
2. Pushes an `AgentEvent` into a per-workflow asyncio.Queue so SSE listeners
   can stream it to the canvas.

The bus also exposes broadcast/subscribe helpers so the SSE endpoint can
hook in without touching the trace logic itself.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime
from typing import AsyncIterator
from uuid import UUID

from apps.api.schemas import AgentEvent
from apps.api.tools import clickhouse_client

log = logging.getLogger(__name__)


# ----- Subscription bus -----

_subscribers: dict[UUID, list[asyncio.Queue[AgentEvent]]] = {}
_global_subscribers: list[asyncio.Queue[AgentEvent]] = []
_lock = asyncio.Lock()


async def subscribe(workflow_id: UUID | None = None) -> asyncio.Queue[AgentEvent]:
    """Subscribe to events for one workflow (or globally if workflow_id is None)."""
    q: asyncio.Queue[AgentEvent] = asyncio.Queue(maxsize=1024)
    async with _lock:
        if workflow_id is None:
            _global_subscribers.append(q)
        else:
            _subscribers.setdefault(workflow_id, []).append(q)
    return q


async def unsubscribe(q: asyncio.Queue[AgentEvent], workflow_id: UUID | None = None) -> None:
    async with _lock:
        if workflow_id is None:
            try:
                _global_subscribers.remove(q)
            except ValueError:
                pass
        else:
            lst = _subscribers.get(workflow_id, [])
            try:
                lst.remove(q)
            except ValueError:
                pass


async def broadcast(event: AgentEvent) -> None:
    async with _lock:
        targets = list(_subscribers.get(event.workflow_id, [])) + list(_global_subscribers)
    for q in targets:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            log.warning("subscriber queue full; dropping event")


# ----- ClickHouse persistence -----


def _persist_row(
    *,
    workflow_id: UUID,
    agent_name: str,
    step: str,
    target: str,
    label: str,
    input_payload: str,
    output_payload: str,
    latency_ms: int,
    status: str,
    error_message: str | None,
) -> None:
    try:
        clickhouse_client.insert(
            "agent_traces",
            [
                {
                    "workflow_id": str(workflow_id),
                    "agent_name": agent_name,
                    "step": step,
                    "drug_context": "",
                    "input_payload": input_payload,
                    "output_payload": output_payload,
                    "tool_calls": [],
                    "target": target,
                    "label": label,
                    "latency_ms": latency_ms,
                    "tokens_in": 0,
                    "tokens_out": 0,
                    "cost_usd": 0.0,
                    "status": status,
                    "error_message": error_message,
                }
            ],
        )
    except Exception as e:  # noqa: BLE001 — never let tracing kill an agent
        log.warning("trace persistence failed: %s", e)


# ----- Span manager -----


class _Span:
    def __init__(self, *, workflow_id: UUID, agent: str, step: str, target: str, label: str):
        self.workflow_id = workflow_id
        self.agent = agent
        self.step = step
        self.target = target
        self.label = label
        self.payload_in: dict = {}
        self.payload_out: dict = {}
        self.status: str = "ok"
        self.error: str | None = None

    def set_input(self, payload: dict) -> None:
        self.payload_in = payload

    def set_output(self, payload: dict) -> None:
        self.payload_out = payload

    def fail(self, error: str) -> None:
        self.status = "failed"
        self.error = error


@asynccontextmanager
async def trace_span(
    workflow_id: UUID,
    agent: str,
    *,
    step: str = "run",
    target: str = "",
    label: str = "",
) -> AsyncIterator[_Span]:
    """Run an agent step inside a span. Emits start/end events to subscribers and persists to ClickHouse."""
    span = _Span(workflow_id=workflow_id, agent=agent, step=step, target=target, label=label)
    started = time.perf_counter()

    await broadcast(
        AgentEvent(
            workflow_id=workflow_id,
            agent=agent,
            step="start",
            target=target or None,
            label=label or None,
            data={},
            at=datetime.utcnow(),
        )
    )
    try:
        yield span
    except Exception as e:  # noqa: BLE001
        span.fail(str(e))
        raise
    finally:
        latency_ms = int((time.perf_counter() - started) * 1000)
        end_event = AgentEvent(
            workflow_id=workflow_id,
            agent=agent,
            step="end",
            target=target or None,
            label=label or None,
            data={
                "status": span.status,
                "latency_ms": latency_ms,
                **({"error": span.error} if span.error else {}),
                **span.payload_out,
            },
            at=datetime.utcnow(),
        )
        await broadcast(end_event)
        _persist_row(
            workflow_id=workflow_id,
            agent_name=agent,
            step=step,
            target=target,
            label=label,
            input_payload=json.dumps(span.payload_in, default=str)[:4000],
            output_payload=json.dumps(span.payload_out, default=str)[:4000],
            latency_ms=latency_ms,
            status=span.status,
            error_message=span.error,
        )


async def emit_event(event: AgentEvent) -> None:
    """One-off emit (used for monitor / orchestrator-level events)."""
    await broadcast(event)
