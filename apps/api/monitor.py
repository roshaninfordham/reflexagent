"""Autonomous OpenFDA recall monitor.

Background asyncio task that polls OpenFDA's Drug Enforcement Reports endpoint
every N seconds, deduplicates against ClickHouse `monitor_seen`, and fires the
orchestrator on each novel signal.

This is what makes Reflex genuinely autonomous — no user action required.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any

import httpx

from apps.api.orchestrator import orchestrate
from apps.api.schemas import AgentEvent, TriggerPayload
from apps.api.settings import get_settings
from apps.api.tools import clickhouse_client
from apps.api.tools.trace import emit_event

log = logging.getLogger(__name__)

OPENFDA_URL = "https://api.fda.gov/drug/enforcement.json"


class MonitorStatus:
    def __init__(self) -> None:
        self.running: bool = False
        self.last_poll_at: datetime | None = None
        self.poll_count: int = 0
        self.signals_reviewed: int = 0
        self.novel_triggered: int = 0
        self.last_novel_id: str | None = None
        self.recent_novels: list[dict[str, Any]] = []


_status = MonitorStatus()
_task: asyncio.Task | None = None
_inject_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()


def status() -> MonitorStatus:
    return _status


async def inject_demo_signal(payload: dict[str, Any]) -> None:
    """Demo failsafe: presenter-only hook to add a 'novel' signal to the next poll."""
    await _inject_queue.put(payload)


def _already_seen(external_id: str) -> bool:
    try:
        rows = clickhouse_client.query_rows(
            "SELECT count() AS c FROM monitor_seen WHERE external_id = %(eid)s",
            {"eid": external_id},
        )
        return bool(rows and rows[0]["c"])
    except Exception:
        return False


def _mark_seen(external_id: str, source: str = "openfda") -> None:
    try:
        clickhouse_client.insert(
            "monitor_seen",
            [{"external_id": external_id, "source": source}],
        )
    except Exception as e:  # noqa: BLE001
        log.warning("monitor_seen insert failed: %s", e)


async def _poll_openfda(client: httpx.AsyncClient, limit: int = 15) -> list[dict[str, Any]]:
    # OpenFDA expects unencoded '+' between TO tokens, and the bracket syntax
    # must not be URL-encoded by httpx. We assemble the query string ourselves.
    since = (datetime.utcnow() - timedelta(days=21)).strftime("%Y%m%d")
    until = datetime.utcnow().strftime("%Y%m%d")
    query = f"search=report_date:[{since}+TO+{until}]&sort=report_date:desc&limit={limit}"
    url = f"{OPENFDA_URL}?{query}"
    try:
        r = await client.get(url, timeout=15)
        if r.status_code >= 500:
            # OpenFDA can transiently 500; try the simpler 'recent' query.
            r = await client.get(f"{OPENFDA_URL}?limit={limit}", timeout=15)
        r.raise_for_status()
        return r.json().get("results", [])
    except Exception as e:  # noqa: BLE001
        log.warning("openfda poll failed: %s", e)
        return []


def _short_drug_name(item: dict[str, Any]) -> str:
    """Pick the cleanest drug name from an OpenFDA record."""
    openfda = item.get("openfda") or {}
    # Prefer generic name (cleanest), then brand_name, then truncated description.
    for key in ("generic_name", "brand_name", "substance_name"):
        vals = openfda.get(key) or []
        if vals:
            return str(vals[0]).strip().title()[:80]
    desc = item.get("product_description") or "Unknown"
    # Take everything before the first comma — that's usually the actual product name.
    head = desc.split(",", 1)[0]
    return head.strip().title()[:80]


def _to_trigger(item: dict[str, Any]) -> TriggerPayload:
    cls_raw = (item.get("classification") or "").lower()
    if "class i" in cls_raw and "class ii" not in cls_raw:
        cls = "I"
    elif "class ii" in cls_raw and "class iii" not in cls_raw:
        cls = "II"
    elif "class iii" in cls_raw:
        cls = "III"
    else:
        cls = None
    lots: list[str] = []
    code = item.get("code_info") or ""
    # Naive lot extraction.
    for token in code.replace(",", " ").split():
        if any(ch.isdigit() for ch in token) and any(ch.isalpha() for ch in token):
            lots.append(token.strip(".:;"))
    return TriggerPayload(
        drug_name=_short_drug_name(item),
        ndc=((item.get("openfda") or {}).get("product_ndc") or [None])[0],
        lot_numbers=lots[:6],
        recall_class=cls,
        reason=(item.get("reason_for_recall") or "")[:500],
        manufacturer=item.get("recalling_firm"),
        source="monitor_openfda",
        external_id=item.get("recall_number"),
        confidence=0.95,
    )


async def _emit_status_event() -> None:
    from uuid import UUID
    await emit_event(
        AgentEvent(
            workflow_id=UUID("00000000-0000-0000-0000-000000000000"),
            agent="monitor",
            step="end",
            label=(
                f"Poll {_status.poll_count}: reviewed {_status.signals_reviewed} signals, "
                f"{_status.novel_triggered} novel."
            ),
            data={
                "running": _status.running,
                "last_poll_at": _status.last_poll_at.isoformat() + "Z"
                if _status.last_poll_at
                else None,
                "poll_count": _status.poll_count,
                "signals_reviewed": _status.signals_reviewed,
                "novel_triggered": _status.novel_triggered,
                "last_novel_id": _status.last_novel_id,
            },
        )
    )


async def _loop() -> None:
    s = get_settings()
    interval = max(5, s.monitor_poll_interval_seconds)
    log.info("autonomous monitor starting (interval=%ss)", interval)
    _status.running = True
    async with httpx.AsyncClient() as client:
        while _status.running:
            try:
                items = await _poll_openfda(client)
                _status.poll_count += 1
                _status.last_poll_at = datetime.utcnow()
                _status.signals_reviewed += len(items)

                # Drain any injected demo signals.
                while not _inject_queue.empty():
                    inj = await _inject_queue.get()
                    items.append(inj)

                novel = []
                for item in items:
                    rid = item.get("recall_number") or item.get("event_id") or ""
                    if not rid or _already_seen(rid):
                        continue
                    novel.append(item)

                for item in novel[:1]:  # one trigger per poll to keep stage pacing sane
                    payload = _to_trigger(item)
                    _mark_seen(payload.external_id or "")
                    _status.novel_triggered += 1
                    _status.last_novel_id = payload.external_id
                    _status.recent_novels.insert(
                        0,
                        {
                            "external_id": payload.external_id,
                            "drug_name": payload.drug_name,
                            "manufacturer": payload.manufacturer,
                            "at": datetime.utcnow().isoformat() + "Z",
                        },
                    )
                    _status.recent_novels = _status.recent_novels[:10]
                    asyncio.create_task(orchestrate(payload))

                # Mark remaining novel as seen so we don't reprocess them next tick.
                for item in novel[1:]:
                    rid = item.get("recall_number") or ""
                    if rid:
                        _mark_seen(rid)

                await _emit_status_event()
            except Exception as e:  # noqa: BLE001
                log.warning("monitor loop tick failed: %s", e)
            await asyncio.sleep(interval)


async def start() -> None:
    global _task
    if _task and not _task.done():
        return
    _status.running = True
    _task = asyncio.create_task(_loop(), name="reflex-monitor")


async def stop() -> None:
    _status.running = False
    if _task:
        _task.cancel()
