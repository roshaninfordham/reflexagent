"""ClickHouse Cloud client + helpers."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import clickhouse_connect
from clickhouse_connect.driver.client import Client

from apps.api.settings import get_settings


@lru_cache(maxsize=1)
def get_client() -> Client:
    s = get_settings()
    if not s.clickhouse_host:
        raise RuntimeError(
            "CLICKHOUSE_HOST not configured. Set it in .env."
        )
    return clickhouse_connect.get_client(
        host=s.clickhouse_host,
        port=s.clickhouse_port,
        username=s.clickhouse_user,
        password=s.clickhouse_password,
        database=s.clickhouse_database,
        secure=True,
    )


def init_schema() -> None:
    """Run the init.sql DDL. Idempotent."""
    sql_path = Path(__file__).resolve().parent.parent.parent.parent / "infra" / "clickhouse" / "init.sql"
    raw = sql_path.read_text()
    s = get_settings()
    # When connecting we already used CLICKHOUSE_DATABASE; create it via the
    # admin connection (no database parameter).
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
    """Naive split — sufficient for our DDL which has no embedded semicolons in strings."""
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


def query_rows(sql: str, params: dict[str, Any] | None = None) -> list[dict]:
    res = get_client().query(sql, parameters=params or {})
    return [dict(zip(res.column_names, row)) for row in res.result_rows]


def insert(table: str, rows: list[dict]) -> None:
    if not rows:
        return
    cols = list(rows[0].keys())
    data = [[r.get(c) for c in cols] for r in rows]
    get_client().insert(table, data, column_names=cols)
