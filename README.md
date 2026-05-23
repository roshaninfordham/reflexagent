# Reflex

**The autonomous safety reflex for healthcare systems.**

Reflex is an always-on agent swarm that turns FDA drug recalls and pharmacovigilance signals into verified, cited, routed operational deliverables — in seconds, not weeks. It watches the open web continuously, verifies signals across multiple primary sources with an adversarial counter-evidence pass, identifies affected patients, drafts clinician communications, and publishes a cited public brief that other agents can discover and pay to query.

## What you'll see

- **An autonomous monitor** polling OpenFDA every 30 seconds. When a novel recall hits the wire, the swarm fires unprompted.
- **A 10-agent network** on an animated canvas. Cursors fly between agents and external sources (FDA, EMA, ClickHouse, Senso) as each step executes. A red counter-evidence cursor hunts for refuting evidence.
- **A published, cited brief** at a public URL with primary-source citations.
- **A real on-chain micropayment** (Base Sepolia) that unlocks a premium personalized sub-brief.

## Sponsor stack

| Tool | Role |
|---|---|
| **NimbleWay** | Web Search Agents — Scout fans out to FDA / EMA / PubMed; Counter agent runs the adversarial search. |
| **Senso** | Publishes verified safety briefs to `reflex.cited.md`. |
| **ClickHouse** | Patient cohort SQL, historical analog vector search, agent trace backend. |
| **x402 + Coinbase CDP** | Premium sub-brief paywall — real Base Sepolia settlement. |
| **agentic.market** | Lists the brief feed as a discoverable paid service. |
| **Datadog LLM Observability** | Auto-instruments every reasoning call via `lapdog`. |

## Running locally

### Prerequisites

- Python 3.12+
- Node.js 20+
- ClickHouse Cloud instance (free tier works)
- `lapdog` for Datadog instrumentation: `brew install datadog/lapdog/lapdog`

### Setup

```bash
git clone https://github.com/roshaninfordham/reflexagent.git
cd reflexagent
cp .env.example .env
# Edit .env with your API keys

# Backend
python -m venv .venv
source .venv/bin/activate
pip install -r apps/api/requirements.txt

# Initialize ClickHouse
python -m apps.api.tools.clickhouse_init
python -m infra.seed.seed_patients
python -m infra.seed.seed_adverse_events

# Frontend
cd apps/web
npm install
cd ../..
```

### Run everything

```bash
./scripts/start-all.sh
```

This starts:
- FastAPI backend on `http://localhost:8000`
- Next.js frontend on `http://localhost:3000`
- Autonomous OpenFDA monitor in the background

Open `http://localhost:3000` to watch the monitor and trigger workflows.

## Architecture

```
┌────────────────────────────────────────────────────────┐
│  Autonomous Monitor (every 30s)                        │
│   OpenFDA recall enforcement API → dedup → orchestrate │
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
       ┌─────────────────────────────────────┐
       │  10-agent swarm (FastAPI)            │
       │   Inbound → Scout → Triage → Recon   │
       │   → Verify+Counter → Cohort          │
       │   → Routing → Writer → Auditor       │
       │   → Publisher                        │
       └─────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   NimbleWay        ClickHouse         Senso
   (Scout +         (Recon +           (publish to
    Counter)         Cohort +           cited.md)
                     traces)
                         │
                         ▼
            ┌─────────────────────────┐
            │  SSE event stream        │
            └────────────┬─────────────┘
                         ▼
            ┌─────────────────────────┐
            │  Next.js Canvas Theater  │
            │  10 agent nodes,         │
            │  moving cursors,         │
            │  red counter cursor      │
            └─────────────────────────┘
```

## Repository layout

```
apps/
├── api/               # FastAPI backend
│   ├── main.py
│   ├── orchestrator.py
│   ├── monitor.py
│   ├── events.py
│   ├── payments.py
│   ├── agents/        # 10 specialized agents
│   └── tools/         # NimbleWay, ClickHouse, Senso, reasoning, trace
└── web/               # Next.js 14 frontend
    ├── app/
    └── components/
        └── AgentTheater.tsx   # Canvas viz

infra/
├── clickhouse/init.sql
└── seed/

docs/
├── superpowers/specs/   # Design spec
└── cited/               # Fallback published briefs
```

## License

MIT.
