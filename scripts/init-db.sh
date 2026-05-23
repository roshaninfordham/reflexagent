#!/usr/bin/env bash
# One-time database setup: create schema, then seed patients + history.
set -euo pipefail

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
cd "$ROOT"
source .venv/bin/activate 2>/dev/null || true
set -a; source .env; set +a

echo "[reflex] init ClickHouse schema..."
python -m apps.api.tools.clickhouse_init

echo "[reflex] seed patients..."
python -m infra.seed.seed_patients

echo "[reflex] seed adverse events..."
python -m infra.seed.seed_adverse_events

echo "Done."
