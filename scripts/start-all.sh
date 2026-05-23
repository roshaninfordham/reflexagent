#!/usr/bin/env bash
set -euo pipefail

# Reflex launcher — starts the FastAPI backend (with the autonomous monitor)
# and the Next.js frontend in parallel. Tail their logs side-by-side.

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
cd "$ROOT"

if [ ! -f .env ]; then
  echo "[reflex] .env missing — copy from .env.example and fill in keys."
  exit 1
fi

if [ ! -d .venv ]; then
  echo "[reflex] creating .venv..."
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

if ! python -c "import fastapi" 2>/dev/null; then
  echo "[reflex] installing Python deps..."
  pip install --quiet -r apps/api/requirements.txt
fi

if [ ! -d apps/web/node_modules ]; then
  echo "[reflex] installing npm deps..."
  (cd apps/web && npm install --silent)
fi

mkdir -p logs

echo "[reflex] starting FastAPI on :8000 (autonomous monitor on, ddtrace-run for LLM Obs)"
(
  set -a
  source .env
  set +a
  if command -v ddtrace-run >/dev/null 2>&1 && [ -n "${DD_API_KEY:-}" ]; then
    exec ddtrace-run uvicorn apps.api.main:app --host 0.0.0.0 --port 8000 --log-level info
  else
    exec uvicorn apps.api.main:app --host 0.0.0.0 --port 8000 --log-level info
  fi
) > logs/api.log 2>&1 &
API_PID=$!

echo "[reflex] starting Next.js on :3000"
(
  cd apps/web
  exec npm run dev
) > logs/web.log 2>&1 &
WEB_PID=$!

trap "echo '[reflex] shutting down'; kill $API_PID $WEB_PID 2>/dev/null || true" INT TERM

echo
echo "  Reflex running:"
echo "  - API: http://localhost:8000/health"
echo "  - Web: http://localhost:3000"
echo "  - Tail logs/api.log and logs/web.log"
echo

wait
