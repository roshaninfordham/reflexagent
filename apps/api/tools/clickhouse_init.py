"""Run as a module: `python -m apps.api.tools.clickhouse_init`."""
from __future__ import annotations

from apps.api.tools.clickhouse_client import init_schema


def main() -> None:
    print("Initializing ClickHouse schema...")
    init_schema()
    print("Done.")


if __name__ == "__main__":
    main()
