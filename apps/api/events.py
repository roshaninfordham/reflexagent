"""SSE event stream endpoint."""
from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator
from uuid import UUID

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from apps.api.tools import trace as trace_bus

router = APIRouter()


async def _stream(request: Request, workflow_id: UUID | None) -> AsyncGenerator[dict, None]:
    q = await trace_bus.subscribe(workflow_id)
    try:
        # Heartbeat at start.
        yield {
            "event": "ready",
            "data": json.dumps({"workflow_id": str(workflow_id) if workflow_id else "global"}),
        }
        while True:
            if await request.is_disconnected():
                break
            try:
                event = await asyncio.wait_for(q.get(), timeout=15)
                yield {
                    "event": "agent",
                    "data": event.model_dump_json(),
                }
            except asyncio.TimeoutError:
                # Heartbeat to keep proxies happy.
                yield {"event": "ping", "data": json.dumps({"at": "tick"})}
    finally:
        await trace_bus.unsubscribe(q, workflow_id)


@router.get("/api/v1/events/{workflow_id}")
async def events_for_workflow(workflow_id: UUID, request: Request):
    return EventSourceResponse(_stream(request, workflow_id))


@router.get("/api/v1/events")
async def events_global(request: Request):
    return EventSourceResponse(_stream(request, None))
