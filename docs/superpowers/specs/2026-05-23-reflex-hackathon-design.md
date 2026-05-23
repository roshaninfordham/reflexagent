# Reflex — Hackathon Build Spec (Delta)

**Date:** 2026-05-23
**Author:** Roshan Sharma
**Canonical PRD:** `/Users/rs/Downloads/REFLEX_PRD.md` (sections referenced as PRD §N)
**Scope:** This spec captures the deltas vs. the PRD that the build will follow. Anything not contradicted here remains as specified in the PRD.

---

## 1. What changes vs. the PRD

| # | Delta | PRD section it modifies | Reason |
|---|---|---|---|
| D1 | Add an **always-on autonomous monitor** that polls OpenFDA / FDA RSS every 30s and auto-triggers the swarm on novel signals. Camera + PDF drop become *additional* triggers, not the primary one. | §6, §8, §15 (T07–T10) | "100% autonomous" is the headline win condition; judges grading Autonomy must see the agent acting without a human prompt. |
| D2 | Replace the static "agent cards pulse" UI with a **canvas-based agent network** (HTML Canvas + simple physics). Each agent is a node; when active, an animated cursor travels from the agent to its data source (FDA, EMA, ClickHouse, Senso), fetches, returns. Counter-evidence agent spawns a red cursor that hunts refutations. | §12.2 (`AgentSwarmViz`) | "Cursors and agents moving should be visible in UI/UX so it looks wow." This is the demo's visual centerpiece. |
| D3 | **Drop Datadog LLM Observability** as a sponsor tool. Replace with a self-built in-process trace stream that writes to ClickHouse `agent_traces` AND streams to the frontend via Server-Sent Events. ClickHouse becomes the observability backend. | §11.4, §14, §15 (T28–T29) | User's sponsor list named NimbleWay + Senso + ClickHouse + payment rails — Datadog wasn't in scope. Removing it cuts ~30 min of setup tax and concentrates the observability story on ClickHouse (which has a "build with us" prize track). |
| D4 | Add **agentic.market** as a discovery-layer sponsor. Publish the brief feed as a listed paid service so other agents can discover it. | §11 (new subsection) | Adds a 5th sponsor at low cost; demonstrates agent-to-agent commerce, not just user-to-agent. |
| D5 | **x402 via Coinbase CDP on Base Sepolia** is the primary payment path (PRD's "Tier A"), not the JWT stub. We pre-fund a demo wallet so the on-stage transaction is real. JWT stub remains as `Tier B` failsafe only. | §11.5, §15 (T32) | Real payment rail is a judging criterion; testnet transactions cost nothing and finalize in seconds. |
| D6 | **No mention of underlying AI vendors in any user-facing copy, README, or code comments.** All LLM calls go through a single `apps/api/tools/reasoning.py` module branded as "Reflex Reasoning Engine." Vendor SDK imports live inside that module only. | global | User constraint: no mention of AI tools used to build this. Applies to user-visible surfaces; env var names remain conventional (`ANTHROPIC_API_KEY`) so the build doesn't fight the SDKs. |
| D7 | **Edge tier becomes optional for the hackathon demo.** Default trigger paths are (a) the autonomous monitor and (b) the PDF / image drop on the web UI (server-side vision via the reasoning engine). Local Gemma 3n is kept as a stretch goal only — it is the highest-risk single component and pulling it off the critical path frees time for D1 + D2. | §8, §15 (T07–T09) | The PRD itself flags Gemma as the #1 demo risk (R1). Removing it from the critical path raises the demo's reliability without weakening the autonomy story (D1 covers that). |

Everything else in the PRD stands.

---

## 2. Updated Sponsor Stack

| Sponsor | Role | Where it shows up in the demo |
|---|---|---|
| **NimbleWay** | Web Search Agents — Scout fans out to FDA / EMA / PubMed; Counter-evidence agent runs the adversarial search. | Scout + Counter cursors visibly fly to external sources on the canvas. |
| **Senso** | Publishes verified safety briefs to `reflex.cited.md`; provides the agent-discoverable open-web surface. | Publisher cursor animates → URL pops up on screen. |
| **ClickHouse** | Cohort SQL, historical analog vector search (Recon), AND the trace backend for the agent network visualizer. | Recon cursor flies to the ClickHouse node; live agent traces stream from CH to the SSE feed. |
| **x402 + Coinbase CDP** | Premium sub-brief paywall; real Base Sepolia transaction on stage. | "Pay $0.50" button triggers a real on-chain settlement before content unlocks. |
| **agentic.market** | Lists Reflex's brief feed as a discoverable paid service so other agents can find and subscribe. | Mentioned in pitch + linked in README; listing screenshot in the deck. |

Five sponsors. Exceeds the "2+" requirement.

---

## 3. Architecture Delta

```
                   ┌──────────────────────────────────────────────────────┐
                   │  AUTONOMOUS MONITOR  (background asyncio task, 30s)  │
                   │   - Polls OpenFDA recall enforcement API             │
                   │   - Polls FDA RSS                                     │
                   │   - Dedup against ClickHouse adverse_events          │
                   │   - On novel signal: POST /api/v1/trigger             │
                   └──────────────────────────┬───────────────────────────┘
                                              │
   ┌──────────────────────────────┐           │           ┌──────────────────────────┐
   │  Manual trigger:             │           │           │  Camera/PDF trigger       │
   │  - Web "trigger" button      │ ─────────►│◄───────── │  (stretch: edge Gemma)    │
   └──────────────────────────────┘           │           └──────────────────────────┘
                                              ▼
                            ┌─────────────────────────────────┐
                            │   FastAPI Orchestrator           │
                            │   10-agent swarm (PRD §9 intact) │
                            └────────────────┬─────────────────┘
                                             │
            ┌────────────────────────────────┼────────────────────────────────┐
            ▼                                ▼                                ▼
    ┌───────────────┐              ┌──────────────────┐             ┌─────────────────┐
    │  NimbleWay    │              │  ClickHouse      │             │  Senso          │
    │  (Scout +     │              │  (Recon + Cohort │             │  (Publish to    │
    │   Counter)    │              │  + traces)       │             │   cited.md)     │
    └───────────────┘              └──────────────────┘             └─────────────────┘
                                             │
                                             ▼
                            ┌─────────────────────────────────┐
                            │   SSE /api/v1/events/{wf_id}     │
                            │   (per-agent step events)        │
                            └────────────────┬─────────────────┘
                                             │
                                             ▼
                            ┌─────────────────────────────────┐
                            │  Next.js Canvas Agent Theater    │
                            │  - 10 agent nodes                │
                            │  - moving cursors to sources     │
                            │  - red counter cursor on conflict│
                            └─────────────────────────────────┘
```

---

## 4. Components & Responsibilities

### 4.1 `apps/api/monitor.py` — Autonomous Monitor (NEW)
- **What it does:** Background asyncio task started on FastAPI startup. Every 30s, calls OpenFDA Recall Enforcement Reports endpoint, deduplicates results against ClickHouse `adverse_events`, fires `orchestrate(payload)` for any novel record.
- **Interface:** No HTTP surface. Exposes a single `start_monitor(app)` registered as a startup event. Status (`last_poll_at`, `last_novel_signal_id`) surfaced via `GET /api/v1/monitor/status` for the UI.
- **Dependencies:** ClickHouse client, orchestrator, `httpx`.

### 4.2 `apps/api/tools/reasoning.py` — Branded LLM wrapper (RENAMED)
- **What it does:** All Anthropic SDK calls live here. Public functions: `await reason(system, user, schema=None) -> dict|str`. Logs cost + token counts to ClickHouse `agent_traces`.
- **Interface:** No agent ever imports `anthropic` directly. Tests can monkeypatch `reason` with a deterministic stub.
- **Dependencies:** `anthropic` SDK (only here), Pydantic for schema.

### 4.3 `apps/api/tools/trace.py` — Trace bus (NEW)
- **What it does:** Async context manager `trace_span(workflow_id, agent_name, ...)` that:
  1. Writes a row to ClickHouse `agent_traces` on completion.
  2. Pushes a JSON event into an in-process `asyncio.Queue` keyed by `workflow_id`.
- **Interface:** `with trace_span(...) as span: span.set("citations_found", 7)`. SSE endpoint drains the queue.
- **Dependencies:** ClickHouse client, asyncio.

### 4.4 `apps/api/events.py` — SSE event stream (NEW)
- **What it does:** `GET /api/v1/events/{workflow_id}` returns `text/event-stream`. Streams agent step events from the trace bus until workflow completes.
- **Interface:** Standard SSE format: `data: {...}\n\n`.
- **Dependencies:** Trace bus.

### 4.5 `apps/web/components/AgentTheater.tsx` — Canvas viz (NEW, replaces `AgentSwarmViz`)
- **What it does:** Renders an HTML Canvas with:
  - 10 agent nodes laid out in 3 rings.
  - 4 external "source" nodes (FDA, EMA, ClickHouse, Senso) at the canvas edge.
  - When an SSE event for an agent arrives with `step=start` and `target=<source>`, animate a cursor traveling from the agent to the source, pause briefly, return with a "result" particle.
  - Counter-evidence agent gets a red cursor; on conflict, the cursor pulses red and a tooltip surfaces the conflict text.
- **Interface:** Single prop `workflowId`. Subscribes to SSE internally.
- **Dependencies:** React, plain Canvas 2D (no heavy lib — keeps it fast and dependency-free).

### 4.6 `apps/api/payments.py` — x402 + Coinbase CDP (REVISED)
- **What it does:** Implements the x402 spec on `POST /api/v1/premium-subbrief`. On first call, returns `402 Payment Required` with payment instructions (Base Sepolia address, amount, asset). On retry with `X-PAYMENT` header containing a valid on-chain settlement proof, returns the sub-brief.
- **Interface:** Standard x402 middleware shape. Reuses Coinbase CDP SDK for settlement verification.
- **Dependencies:** `x402` Python package, `cdp-sdk`. Fallback to JWT stub if either SDK fails at runtime.

### 4.7 `apps/api/agents/*` — 10 agents (UNCHANGED from PRD §9 except all import `reasoning` not `anthropic` directly, and all use `trace_span` for instrumentation)

---

## 5. Demo Flow (revised, 90s)

| Time | What audience sees | Backstage |
|---|---|---|
| 0:00 | Presenter opens `/` — landing page already shows the autonomous monitor humming: "Last poll 4s ago. 1,247 signals reviewed. 3 confirmed recalls published today." | Monitor task has been running the whole event |
| 0:10 | Presenter clicks "Force a demo trigger" OR holds up the metformin recall PDF and drops it on the upload zone | POST /api/v1/trigger |
| 0:15 | Canvas lights up: Inbound node pulses, then Scout node spawns 3 cursors flying to FDA, EMA, PubMed | SSE events streaming from trace bus |
| 0:35 | Counter cursor (red) launches separately, hunts adversarial sources | Counter-evidence agent runs |
| 0:50 | Conflict appears: red cursor flashes, tooltip shows "FDA: Class II / Manufacturer: Class III" | Verify+Counter merges with conflict surfaced |
| 1:05 | Cohort cursor flies to ClickHouse, returns with a toast: "47 patients affected, 12 high-risk" | ClickHouse SQL |
| 1:20 | Writer + Auditor cursors finish; Publisher cursor flies to Senso, returns with a cited.md URL | Senso publish |
| 1:30 | URL displayed: `reflex.cited.md/recall/<slug>`. Click it → real published page with 14 citations | — |
| 1:40 | "Want pediatric subgroup analysis? Pay $0.50." Audience plant or presenter clicks Pay → real Base Sepolia tx settles in ~3s → sub-brief unlocks | x402 + CDP |
| 1:55 | Close | — |

Backup video still recorded per PRD R6.

---

## 6. Out of Scope (for today)

Unchanged from PRD §5.3, plus:
- Edge Gemma 3n (moved to stretch).
- Datadog dashboard (removed entirely).
- WebSocket — SSE is simpler and demo-sufficient.

---

## 7. Risks (delta from PRD §17)

| # | Risk | Mitigation |
|---|---|---|
| RD1 | OpenFDA returns nothing novel during demo (boring autonomous monitor) | Pre-seed `adverse_events` with all but ONE known recall; the next poll surfaces that recall as "novel" and the swarm fires unprompted. Also keep the "Force trigger" button. |
| RD2 | Canvas animation jank kills the wow factor | Use `requestAnimationFrame` + ≤30 cursors max on screen; profile during build. |
| RD3 | Base Sepolia wallet runs dry mid-demo | Pre-fund with 5x expected demo tx; JWT stub remains as Tier B failsafe with a feature flag. |
| RD4 | agentic.market listing not approvable in time | Treat as nice-to-have. Pitch claim becomes "agent-discoverable via cited.md feed" + screenshot of the listing form if not live. |

---

## 8. Success Criteria

The build is "done" for the hackathon when ALL of the following are true:
1. The monitor task is visibly running and has produced at least one autonomous trigger during a clean run.
2. The full 10-agent swarm completes end-to-end in < 60s on a real recall payload.
3. Canvas Agent Theater renders cursors flying to all 4 external nodes and one red counter-cursor pulses on a contrived conflict.
4. A real cited.md URL is published via Senso and resolves with citations.
5. A real Base Sepolia x402 transaction unlocks the premium sub-brief.
6. README has the elevator pitch + 90-second demo video link.
7. No user-facing surface mentions Claude, Anthropic, OpenAI, Gemma, or any model vendor by name.

---

*End of delta spec. Canonical PRD remains binding for anything not modified above.*
