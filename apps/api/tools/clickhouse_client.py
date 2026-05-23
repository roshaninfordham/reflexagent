"""ClickHouse Cloud client + helpers.

If CLICKHOUSE_HOST is unset (or the connection fails), the module falls back to
a thread-safe in-process store so the rest of the system still functions for
local demos / hackathon judging. Real ClickHouse takes over the moment a host
is provided.
"""
from __future__ import annotations

import logging
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any

import clickhouse_connect
from clickhouse_connect.driver.client import Client

from apps.api.settings import get_settings

log = logging.getLogger(__name__)

_warned_unconfigured = False
_inmem_lock = threading.Lock()
_inmem: dict[str, list[dict[str, Any]]] = {
    "adverse_events": [],
    "agent_traces": [],
    "published_briefs": [],
    "patients": [],
    "x402_transactions": [],
    "workflows": [],
    "monitor_seen": [],
}


def _have_host() -> bool:
    return bool(get_settings().clickhouse_host)


def _warn_once_unconfigured() -> None:
    global _warned_unconfigured
    if not _warned_unconfigured:
        log.warning("CLICKHOUSE_HOST not configured — falling back to in-memory store.")
        _warned_unconfigured = True


@lru_cache(maxsize=1)
def get_client() -> Client | None:
    if not _have_host():
        _warn_once_unconfigured()
        return None
    s = get_settings()
    try:
        return clickhouse_connect.get_client(
            host=s.clickhouse_host,
            port=s.clickhouse_port,
            username=s.clickhouse_user,
            password=s.clickhouse_password,
            database=s.clickhouse_database,
            secure=True,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("ClickHouse client init failed (%s) — using in-memory fallback.", e)
        return None


def init_schema() -> None:
    """Run the init.sql DDL on a configured ClickHouse instance.

    No-op when ClickHouse is not configured; the in-memory store is always ready.
    """
    if not _have_host():
        _warn_once_unconfigured()
        return
    sql_path = (
        Path(__file__).resolve().parent.parent.parent.parent
        / "infra"
        / "clickhouse"
        / "init.sql"
    )
    raw = sql_path.read_text()
    s = get_settings()
    admin = clickhouse_connect.get_client(
        host=s.clickhouse_host,
        port=s.clickhouse_port,
        username=s.clickhouse_user,
        password=s.clickhouse_password,
        secure=True,
    )
    for stmt in _split_statements(raw):
        if not stmt.strip():
            continue
        admin.command(stmt)


def _split_statements(sql: str) -> list[str]:
    out: list[str] = []
    buf: list[str] = []
    for line in sql.splitlines():
        if line.strip().startswith("--"):
            continue
        buf.append(line)
        if line.rstrip().endswith(";"):
            out.append("\n".join(buf).rstrip().rstrip(";"))
            buf = []
    if buf:
        out.append("\n".join(buf).rstrip().rstrip(";"))
    return out


def _row_matches(row: dict, where: dict) -> bool:
    for k, v in where.items():
        if isinstance(v, list):
            if not set(v).intersection(row.get(k, []) or []):
                return False
        elif row.get(k) != v:
            return False
    return True


def query_rows(sql: str, params: dict[str, Any] | None = None) -> list[dict]:
    client = get_client()
    if client is not None:
        try:
            res = client.query(sql, parameters=params or {})
            return [dict(zip(res.column_names, row)) for row in res.result_rows]
        except Exception as e:  # noqa: BLE001
            log.warning("clickhouse query failed (%s); returning empty.", e)
            return []

    # In-memory shim — handle a handful of canonical query shapes used by agents.
    params = params or {}
    sql_lc = " ".join(sql.split()).lower()
    with _inmem_lock:
        if "from monitor_seen" in sql_lc and "external_id" in sql_lc:
            eid = str(params.get("eid", ""))
            count = sum(1 for r in _inmem["monitor_seen"] if r.get("external_id") == eid)
            return [{"c": count}]
        if "from adverse_events" in sql_lc:
            drug = str(params.get("drug", ""))
            lots = list(params.get("lots", []) or [])
            rows = [
                r for r in _inmem["adverse_events"]
                if drug.lower() in str(r.get("drug_name", "")).lower()
            ]
            if "count()" in sql_lc:
                if lots:
                    rows = [r for r in rows if set(lots).intersection(r.get("lot_numbers", []) or [])]
                return [{"c": len(rows)}]
            return rows[:8]
        if "from patients" in sql_lc:
            drug = str(params.get("drug", ""))
            lots = list(params.get("lots", []) or [])
            rows = [
                r for r in _inmem["patients"]
                if drug in (r.get("drugs_taken") or [])
            ]
            if lots:
                rows = [r for r in rows if set(lots).intersection(r.get("lots_dispensed", []) or [])]
            return rows
        if "from published_briefs" in sql_lc:
            return _inmem["published_briefs"][:]
        if "from workflows" in sql_lc:
            return _inmem["workflows"][:]
        if "from agent_traces" in sql_lc:
            return _inmem["agent_traces"][:]
    return []


def insert(table: str, rows: list[dict]) -> None:
    if not rows:
        return
    client = get_client()
    if client is not None:
        try:
            cols = list(rows[0].keys())
            data = [[r.get(c) for c in cols] for r in rows]
            client.insert(table, data, column_names=cols)
            return
        except Exception as e:  # noqa: BLE001
            log.warning("clickhouse insert(%s) failed (%s); falling back.", table, e)

    with _inmem_lock:
        bucket = _inmem.setdefault(table, [])
        bucket.extend(rows)
        # Keep memory bounded.
        if len(bucket) > 5000:
            del bucket[: len(bucket) - 5000]
