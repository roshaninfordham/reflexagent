.PHONY: install init-db dev api web seed test

install:
	python3 -m venv .venv && . .venv/bin/activate && pip install -r apps/api/requirements.txt
	cd apps/web && npm install

init-db:
	bash scripts/init-db.sh

dev:
	bash scripts/start-all.sh

api:
	. .venv/bin/activate && set -a && . ./.env && set +a && \
	ddtrace-run uvicorn apps.api.main:app --host 0.0.0.0 --port 8000 --reload

web:
	cd apps/web && npm run dev

seed:
	. .venv/bin/activate && set -a && . ./.env && set +a && \
	python -m infra.seed.seed_patients && \
	python -m infra.seed.seed_adverse_events
