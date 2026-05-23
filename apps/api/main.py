"""Reflex API surface."""
from __future__ import annotations

import asyncio
import base64
import logging
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import (
    BackgroundTasks,
    FastAPI,
    File,
    Form,
    HTTPException,
    UploadFile,
    Request,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from apps.api import monitor as monitor_module
from apps.api.events import router as events_router
from apps.api.orchestrator import get_result, list_recent, orchestrate
from apps.api import wallet as burner
from apps.api.payments import (
    log_payment,
    mint_dev_token,
    verify_x402_payment,
    x402_challenge,
)
from apps.api.schemas import TriggerPayload
from apps.api.settings import get_settings
from apps.api.tools.reasoning import reason, reason_vision

log = logging.getLogger("reflex.api")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Reflex API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-PAYMENT", "WWW-Authenticate"],
)

app.include_router(events_router)


# ----- Startup / shutdown -----


@app.on_event("startup")
async def _startup() -> None:
    s = get_settings()
    _seed_inmem_if_empty()
    if s.monitor_enabled:
        log.info("starting autonomous monitor (interval=%ss)", s.monitor_poll_interval_seconds)
        await monitor_module.start()
    else:
        log.info("monitor disabled (MONITOR_ENABLED=0)")


def _seed_inmem_if_empty() -> None:
    """If ClickHouse isn't configured, populate the in-memory fixture once
    so the swarm has cohort + historical data to chew on for the demo."""
    from apps.api.tools import clickhouse_client

    if clickhouse_client._have_host():
        return
    existing_patients = clickhouse_client.query_rows("SELECT 1 FROM patients LIMIT 1")
    if existing_patients:
        return
    log.info("seeding in-memory fixture (no ClickHouse host configured)…")
    try:
        from infra.seed import seed_patients, seed_adverse_events
        seed_patients.main()
        seed_adverse_events.main()
    except Exception as e:  # noqa: BLE001
        log.warning("in-memory seed failed: %s", e)


@app.on_event("shutdown")
async def _shutdown() -> None:
    await monitor_module.stop()


# ----- Health -----


@app.get("/health")
async def health():
    return {"ok": True, "ts": datetime.utcnow().isoformat() + "Z"}


# ----- Monitor surface -----


@app.get("/api/v1/monitor/status")
async def monitor_status():
    st = monitor_module.status()
    return {
        "running": st.running,
        "last_poll_at": st.last_poll_at.isoformat() + "Z" if st.last_poll_at else None,
        "poll_count": st.poll_count,
        "signals_reviewed": st.signals_reviewed,
        "novel_triggered": st.novel_triggered,
        "last_novel_id": st.last_novel_id,
        "recent_novels": st.recent_novels,
        "poll_interval_seconds": get_settings().monitor_poll_interval_seconds,
    }


class InjectRequest(BaseModel):
    drug_name: str
    manufacturer: str | None = None
    ndc: str | None = None
    lot_numbers: list[str] = []
    recall_class: str | None = "II"
    reason: str | None = None
    external_id: str | None = None


@app.post("/api/v1/monitor/inject")
async def monitor_inject(req: InjectRequest):
    """Presenter-only failsafe: prime the monitor's next-poll buffer."""
    item = {
        "product_description": req.drug_name,
        "recall_number": req.external_id or f"DEMO-{datetime.utcnow().strftime('%H%M%S')}",
        "classification": f"Class {req.recall_class}" if req.recall_class else "Class II",
        "reason_for_recall": req.reason or "Demonstration trigger",
        "recalling_firm": req.manufacturer or "Demo Manufacturer",
        "code_info": ", ".join(req.lot_numbers),
        "openfda": {"product_ndc": [req.ndc] if req.ndc else []},
    }
    await monitor_module.inject_demo_signal(item)
    return {"queued": True, "external_id": item["recall_number"]}


# ----- Trigger / workflow -----


@app.post("/api/v1/trigger")
async def trigger(payload: TriggerPayload, background: BackgroundTasks):
    task = asyncio.create_task(orchestrate(payload))
    # Hand-wait so the caller can immediately get the workflow_id.
    # We poll the in-mem cache briefly until the orchestrator registers.
    for _ in range(20):
        await asyncio.sleep(0.05)
        for w in list_recent(50):
            if w.payload is payload:
                return {"workflow_id": str(w.workflow_id)}
    # Fallback (very unlikely)
    return {"workflow_id": None, "note": "orchestrator did not register in time"}


@app.get("/api/v1/workflow/{workflow_id}")
async def get_workflow(workflow_id: UUID):
    w = get_result(workflow_id)
    if not w:
        raise HTTPException(status_code=404, detail="workflow not found")
    return w.model_dump(mode="json")


@app.get("/api/v1/workflows")
async def list_workflows(limit: int = 25):
    return [w.model_dump(mode="json") for w in list_recent(limit)]


# ----- PDF / image vision ingest -----


VISION_SYSTEM = (
    "You are an FDA pharmacovigilance entity extractor. Given an image of a "
    "drug recall notice, pill bottle, manufacturer letter, or pharmacy fax, "
    "return ONLY a JSON object with the following schema. Do not add prose. "
    "If a field cannot be confidently extracted, set it to null.\n"
    "{\n"
    '  "drug_name": string|null,\n'
    '  "ndc": string|null,\n'
    '  "lot_numbers": string[]|[],\n'
    '  "recall_class": "I"|"II"|"III"|null,\n'
    '  "reason": string|null,\n'
    '  "manufacturer": string|null,\n'
    '  "confidence": float\n'
    "}"
)


@app.post("/api/v1/ingest/vision")
async def ingest_vision(file: UploadFile = File(...)):
    raw = await file.read()
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(413, "file too large (>8MB)")
    b64 = base64.b64encode(raw).decode("utf-8")
    media = file.content_type or "image/jpeg"
    if media.startswith("application/pdf"):
        media = "application/pdf"
    raw_json = await reason_vision(
        VISION_SYSTEM,
        user="Extract the entities from this image and return JSON only.",
        image_b64=b64,
        media_type=media,
    )
    import json
    try:
        cleaned = raw_json.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
        data = json.loads(cleaned.strip())
    except Exception as e:
        raise HTTPException(422, f"vision parse failed: {e}; raw={raw_json[:200]}")
    payload = TriggerPayload(
        drug_name=data.get("drug_name"),
        ndc=data.get("ndc"),
        lot_numbers=data.get("lot_numbers") or [],
        recall_class=data.get("recall_class"),
        reason=data.get("reason"),
        manufacturer=data.get("manufacturer"),
        confidence=float(data.get("confidence") or 0.85),
        source="pdf_upload",
    )
    asyncio.create_task(orchestrate(payload))
    # Same pattern as /trigger for handing back the workflow_id.
    for _ in range(20):
        await asyncio.sleep(0.05)
        for w in list_recent(50):
            if w.payload is payload:
                return {
                    "workflow_id": str(w.workflow_id),
                    "extracted": payload.model_dump(mode="json"),
                }
    return {"workflow_id": None, "extracted": payload.model_dump(mode="json")}


# ----- x402 premium endpoint -----


class SubBriefRequest(BaseModel):
    brief_id: UUID | None = None
    workflow_id: UUID | None = None
    question: str


@app.post("/api/v1/premium-subbrief")
async def premium_subbrief(req: SubBriefRequest, request: Request):
    x_payment = request.headers.get("X-PAYMENT") or request.headers.get("x-payment")
    ok, payer = await verify_x402_payment(x_payment)
    settlement: dict | None = None

    if not ok:
        # No (or invalid) X-PAYMENT. If the burner wallet is funded, the
        # backend ACTS AS THE PAYER and submits a real Base Sepolia tx,
        # then proceeds. This is the agent-to-agent payment story.
        try:
            import asyncio as _asyncio
            s = get_settings()
            wallet_info = burner.info()
            if wallet_info["usdc_balance_micro"] >= int(s.x402_price_usd * 10**6) and wallet_info["eth_balance_wei"] > 0:
                pay_to = s.x402_pay_to_address or burner.get_account().address
                settlement = await _asyncio.to_thread(burner.send_usdc, s.x402_price_usd, pay_to)
                receipt = await _asyncio.to_thread(burner.wait_for_receipt, settlement["tx_hash"], 12)
                settlement["receipt"] = receipt
                payer = settlement["from"]
                ok = True
        except Exception as e:  # noqa: BLE001
            log.warning("auto-settle failed: %s", e)

    if not ok:
        challenge = x402_challenge()
        # Surface the burner wallet so the user knows where to send funds.
        challenge["fund_burner"] = burner.info()
        return JSONResponse(
            status_code=402,
            content=challenge,
            headers={"WWW-Authenticate": "x402"},
        )

    # Pull the source brief if available.
    base_ctx = ""
    if req.workflow_id:
        w = get_result(req.workflow_id)
        if w and w.brief:
            base_ctx = (
                f"Drug: {w.brief.drug_name}\n"
                f"Summary: {w.brief.summary}\n"
                f"Severity score: {w.brief.severity_score}\n"
                f"Cohort: {w.cohort.patient_count if w.cohort else 0} "
                f"({w.cohort.high_risk_count if w.cohort else 0} high-risk)\n"
            )

    answer = await reason(
        system=(
            "You write concise pharmacovigilance sub-briefs. Be precise, structured, "
            "and cite which subgroup or angle you are analyzing. ≤300 words."
        ),
        user=f"Source brief context:\n{base_ctx}\n\nUser question:\n{req.question}",
        max_tokens=1200,
    )

    s = get_settings()
    log_payment(
        brief_id=req.brief_id,
        payer=payer,
        amount_usd=s.x402_price_usd,
        endpoint="/api/v1/premium-subbrief",
        settlement_tx=(settlement or {}).get("tx_hash", ""),
    )
    return {
        "answer": answer,
        "payer": payer,
        "paid_usd": s.x402_price_usd,
        "settlement": settlement,  # null if JWT path; populated for real chain settlement
    }


# ----- Chemistry intelligence -----


@app.get("/api/v1/chemistry/{name}")
async def chemistry_dossier(name: str):
    """Real-time molecule dossier: PubChem lookup + RDKit-computed descriptors +
    RDKit-generated SVG (works even for novel compounds not in PubChem)."""
    from apps.api import chemistry as chem
    return await chem.full_dossier(name)


# ----- Historical recalls (real openFDA + curated outcomes) -----


@app.get("/api/v1/historical/recalls")
async def historical_list():
    from apps.api import historical as hist
    return {"items": hist.list_recalls()}


@app.get("/api/v1/historical/recalls/{slug}")
async def historical_detail(slug: str):
    from apps.api import historical as hist
    r = hist.get_recall(slug)
    if not r:
        raise HTTPException(404, "not found")
    # Live evidence pull
    live = await hist.fetch_openfda_evidence(r["search"])
    out = {k: v for k, v in r.items() if k != "search"}
    out["openfda_live_records"] = live[:3]
    return out


@app.post("/api/v1/historical/replay/{slug}")
async def historical_replay(slug: str):
    """Replay a famous historical recall through Reflex's 11-agent swarm."""
    from apps.api import historical as hist
    r = hist.get_recall(slug)
    if not r:
        raise HTTPException(404, "not found")
    # Pull a live openFDA record to populate the payload realistically
    live = await hist.fetch_openfda_evidence(r["search"])
    sample = (live or [{}])[0]
    cls_raw = (sample.get("classification") or "").lower()
    cls = "II"
    if "class i" in cls_raw and "class ii" not in cls_raw: cls = "I"
    elif "class iii" in cls_raw: cls = "III"

    payload = TriggerPayload(
        drug_name=r["drug"],
        manufacturer=sample.get("recalling_firm", f"Multiple manufacturers ({r['year']})"),
        ndc=(sample.get("openfda") or {}).get("product_ndc", [None])[0],
        lot_numbers=[ln.strip() for ln in (sample.get("code_info") or "").split(",") if ln.strip()][:3],
        recall_class=cls,
        reason=(sample.get("reason_for_recall") or r["story"])[:480],
        source="manual",
        external_id=f"historical-{slug}",
        confidence=0.96,
    )
    asyncio.create_task(orchestrate(payload))
    for _ in range(60):
        await asyncio.sleep(0.05)
        for w in list_recent(20):
            if w.payload is payload:
                return {"workflow_id": str(w.workflow_id), "slug": slug}
    return {"workflow_id": None, "slug": slug}


@app.get("/api/v1/historical/compare/{slug}/{workflow_id}")
async def historical_compare(slug: str, workflow_id: UUID):
    """Side-by-side: what Reflex recommends vs what actually happened."""
    from apps.api import historical as hist
    r = hist.get_recall(slug)
    if not r:
        raise HTTPException(404, "recall not found")
    w = get_result(workflow_id)
    if not w:
        raise HTTPException(404, "workflow not found")
    reflex_block = {
        "triage_class": w.triage.severity if w.triage else None,
        "triage_urgency": w.triage.urgency if w.triage else None,
        "severity_score": w.triage.severity_score if w.triage else None,
        "cohort_count": w.cohort.patient_count if w.cohort else 0,
        "cohort_high_risk": w.cohort.high_risk_count if w.cohort else 0,
        "verification_verdict": w.verification.verdict if w.verification else None,
        "conflict_summary": (w.verification.conflict_summary if w.verification else None),
        "counter_evidence_count": len(w.verification.counter_evidence) if w.verification else 0,
        "substitutes": [
            {
                "drug": c.drug_name,
                "target": c.target_protein,
                "similarity": c.target_similarity,
            }
            for c in (w.substitutes.candidates if w.substitutes else [])
        ],
        "brief_title": w.brief.title if w.brief else None,
        "brief_recommendation": w.brief.recommendation if w.brief else None,
        "published_url": w.published.cited_md_url if w.published else None,
    }
    historical_block = {
        "drug": r["drug"],
        "year": r["year"],
        "story": r["story"],
        "actual_action": r["actual_action"],
        "scope": r["scope"],
        "lessons": r["lessons"],
        "sources": r["sources"],
    }
    return {
        "slug": slug,
        "workflow_id": str(workflow_id),
        "reflex": reflex_block,
        "historical": historical_block,
    }


# ----- One-click demo -----


@app.post("/api/v1/demo/launch")
async def demo_launch(slug: str = "metformin"):
    """Trigger a curated recall workflow and return its id."""
    from apps.api import demo as demo_mod
    wf_id = await demo_mod.launch_curated_workflow(slug)
    return {"workflow_id": wf_id, "slug": slug, "status": "running" if wf_id else "queued"}


@app.get("/api/v1/demo/sample-recall.png")
async def demo_sample_recall_default():
    from apps.api import demo as demo_mod
    from fastapi.responses import Response
    data = demo_mod.generate_sample_recall_image("metformin")
    return Response(content=data, media_type="image/png")


@app.get("/api/v1/demo/sample/{slug}.png")
async def demo_sample_recall_slug(slug: str):
    from apps.api import demo as demo_mod
    from fastapi.responses import Response
    data = demo_mod.generate_sample_recall_image(slug)
    return Response(
        content=data,
        media_type="image/png",
        headers={"Content-Disposition": f"inline; filename=recall-{slug}.png"},
    )


@app.get("/api/v1/demo/samples")
async def demo_samples():
    from apps.api import demo as demo_mod
    return {"items": demo_mod.list_samples()}


# ----- Cost / pricing -----


@app.get("/api/v1/cost")
async def cost_summary():
    from apps.api.cost import tracker, PUBLIC_TIERS, PRICES
    return {
        "usage": tracker.summary(),
        "prices_internal_cents": PRICES,
        "public_tiers": PUBLIC_TIERS,
        "rate_limit_strategy": {
            "nim_semaphore_max_inflight": 1,
            "nim_keys_pooled": 2,
            "monitor_poll_seconds": get_settings().monitor_poll_interval_seconds,
            "nimble_retries": 3,
            "openai_sdk_max_retries": 2,
            "graceful_fallbacks": (
                "Every LLM-dependent agent has a deterministic fallback. "
                "Workflows always complete even under sustained 429s."
            ),
        },
        "infra_costs_per_month_estimate_cents": {
            "clickhouse_cloud_free_tier": 0,
            "senso_free_tier": 0,
            "nvidia_bionemo_free": 0,
            "datadog_llm_obs_free_tier": 0,
            "nimble_pay_per_use": "metered",
            "nim_llama_3_3_70b_pay_per_use": "metered",
        },
    }


# ----- Patient hotspot map (open source: aggregate cohort by zip3) -----


@app.get("/api/v1/workflow/{workflow_id}/hotspots")
async def workflow_hotspots(workflow_id: UUID):
    """Aggregate the workflow's affected cohort by ZIP-3 with centroid coords +
    per-patient last_seen timestamps to support the temporal replay slider."""
    from apps.api import geo
    from apps.api.tools import clickhouse_client
    w = get_result(workflow_id)
    if not w or not w.normalized:
        raise HTTPException(404, "workflow not found or not yet normalized")
    drug = w.normalized.normalized_drug
    stem = (drug.split()[0] if drug else "")
    lots = w.normalized.lot_numbers or []
    try:
        if lots:
            rows = clickhouse_client.query_rows(
                """
                SELECT CAST(zip_3 AS String) AS zip_3,
                       count() AS patients,
                       countIf(age >= 75 OR arrayExists(c -> positionCaseInsensitive(c, 'CKD') > 0, conditions)) AS high_risk,
                       groupArray(toUnixTimestamp(last_seen)) AS seen_ts,
                       groupArray(if(age >= 75 OR arrayExists(c -> positionCaseInsensitive(c, 'CKD') > 0, conditions), 1, 0)) AS hr_flags
                FROM patients
                WHERE arrayExists(d -> positionCaseInsensitive(d, %(stem)s) > 0, drugs_taken)
                  AND hasAny(lots_dispensed, %(lots)s)
                GROUP BY zip_3
                """,
                {"stem": stem, "lots": lots},
            )
        else:
            rows = clickhouse_client.query_rows(
                """
                SELECT CAST(zip_3 AS String) AS zip_3,
                       count() AS patients,
                       countIf(age >= 75 OR arrayExists(c -> positionCaseInsensitive(c, 'CKD') > 0, conditions)) AS high_risk,
                       groupArray(toUnixTimestamp(last_seen)) AS seen_ts,
                       groupArray(if(age >= 75 OR arrayExists(c -> positionCaseInsensitive(c, 'CKD') > 0, conditions), 1, 0)) AS hr_flags
                FROM patients
                WHERE arrayExists(d -> positionCaseInsensitive(d, %(stem)s) > 0, drugs_taken)
                GROUP BY zip_3
                """,
                {"stem": stem},
            )
    except Exception as e:  # noqa: BLE001
        log.warning("hotspot SQL failed: %s", e)
        rows = []
    out = []
    all_ts: list[int] = []
    for r in rows:
        z = str(r.get("zip_3") or "")
        lat, lng, label = geo.lookup(z)
        seen = [int(t) for t in (r.get("seen_ts") or [])]
        hr_flags = [int(f) for f in (r.get("hr_flags") or [])]
        all_ts.extend(seen)
        out.append(
            {
                "zip_3": z,
                "lat": lat,
                "lng": lng,
                "label": label,
                "patients": int(r.get("patients", 0)),
                "high_risk": int(r.get("high_risk", 0)),
                # Per-patient timestamps for client-side time filtering
                "patient_ts": seen,
                "patient_hr": hr_flags,
            }
        )
    return {
        "drug": drug,
        "total_patients": sum(x["patients"] for x in out),
        "total_high_risk": sum(x["high_risk"] for x in out),
        "points": out,
        "time_range": (
            {"min": min(all_ts), "max": max(all_ts)} if all_ts else None
        ),
    }


@app.get("/api/v1/hotspots/global")
async def hotspots_global():
    """All-completed-workflows aggregation. Each ZIP-3 gets a per-drug breakdown
    + total patients. Powers the Ops-page multi-recall overlay."""
    from apps.api import geo
    from apps.api.tools import clickhouse_client
    recents = list_recent(50)
    workflows = [w for w in recents if w.normalized]
    if not workflows:
        return {"drugs": [], "zones": []}

    # Per (drug, zip3) → patient count
    per_zone: dict[str, dict[str, int]] = {}  # zip3 → {drug: count}
    per_drug_total: dict[str, int] = {}

    for w in workflows:
        drug = w.normalized.normalized_drug
        stem = drug.split()[0] if drug else ""
        lots = w.normalized.lot_numbers or []
        try:
            if lots:
                rows = clickhouse_client.query_rows(
                    """
                    SELECT CAST(zip_3 AS String) AS zip_3, count() AS patients
                    FROM patients
                    WHERE arrayExists(d -> positionCaseInsensitive(d, %(stem)s) > 0, drugs_taken)
                      AND hasAny(lots_dispensed, %(lots)s)
                    GROUP BY zip_3
                    """,
                    {"stem": stem, "lots": lots},
                )
            else:
                rows = clickhouse_client.query_rows(
                    """
                    SELECT CAST(zip_3 AS String) AS zip_3, count() AS patients
                    FROM patients
                    WHERE arrayExists(d -> positionCaseInsensitive(d, %(stem)s) > 0, drugs_taken)
                    GROUP BY zip_3
                    """,
                    {"stem": stem},
                )
        except Exception as e:  # noqa: BLE001
            log.warning("global hotspot per-drug SQL failed: %s", e)
            rows = []
        for r in rows:
            z = str(r.get("zip_3") or "")
            cnt = int(r.get("patients", 0))
            per_zone.setdefault(z, {})[drug] = per_zone.get(z, {}).get(drug, 0) + cnt
            per_drug_total[drug] = per_drug_total.get(drug, 0) + cnt

    drugs_ranked = sorted(per_drug_total.items(), key=lambda kv: kv[1], reverse=True)
    drugs = [{"name": d, "total_patients": c} for d, c in drugs_ranked]

    zones = []
    for z, drug_counts in per_zone.items():
        lat, lng, label = geo.lookup(z)
        total = sum(drug_counts.values())
        # Pick the dominant drug for this zone (drives the marker color)
        dominant = max(drug_counts.items(), key=lambda kv: kv[1])[0]
        zones.append(
            {
                "zip_3": z,
                "lat": lat,
                "lng": lng,
                "label": label,
                "total_patients": total,
                "dominant_drug": dominant,
                "drug_counts": drug_counts,
            }
        )
    return {
        "drugs": drugs,
        "zones": zones,
        "total_patients": sum(d["total_patients"] for d in drugs),
        "workflow_count": len(workflows),
    }


# ----- Outbox feed -----


@app.get("/api/v1/outbox/recent")
async def outbox_recent(limit: int = 30):
    """Recent agent-triggered actions (memos sent, briefs published, payments).

    Reads from ClickHouse with an in-memory fallback when CH isn't configured.
    """
    from apps.api.tools import clickhouse_client
    try:
        rows = clickhouse_client.query_rows(
            """
            SELECT sent_id, workflow_id, drug_name, channel, recipient_count,
                   body, triggered_by, sent_at
            FROM outbox
            ORDER BY sent_at DESC
            LIMIT %(limit)s
            """,
            {"limit": max(1, min(limit, 100))},
        )
    except Exception as e:  # noqa: BLE001
        log.warning("outbox query failed: %s", e)
        rows = []
    # Normalize datetimes to ISO strings for the client.
    out = []
    for r in rows:
        item = dict(r)
        sa = item.get("sent_at")
        if sa is not None and not isinstance(sa, str):
            item["sent_at"] = sa.isoformat() + "Z" if hasattr(sa, "isoformat") else str(sa)
        # Truncate body for ticker.
        b = item.get("body") or ""
        item["body_preview"] = b[:160] + ("…" if len(b) > 160 else "")
        out.append(item)
    return {"items": out}


# ----- Conversational voice agent (NIM-backed chat) -----


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"] = "user"
    content: str


class ChatRequest(BaseModel):
    workflow_id: UUID | None = None
    history: list[ChatTurn] = []
    message: str


def _build_chat_context(workflow_id: UUID | None) -> str:
    """Concise summary of the current workflow for the voice agent's context."""
    if not workflow_id:
        return ""
    w = get_result(workflow_id)
    if not w:
        return ""
    parts = []
    if w.brief:
        parts.append(f"Active brief: {w.brief.title}.")
        parts.append(f"Summary: {w.brief.summary}")
    if w.triage:
        parts.append(
            f"Triage: FDA Class {w.triage.severity}, urgency {w.triage.urgency}, "
            f"severity score {w.triage.severity_score}/10."
        )
    if w.cohort:
        parts.append(
            f"Affected cohort: {w.cohort.patient_count} patients, "
            f"{w.cohort.high_risk_count} high-risk."
        )
    if w.verification:
        parts.append(f"Verification verdict: {w.verification.verdict}.")
        if w.verification.conflict_summary:
            parts.append(f"Counter-evidence: {w.verification.conflict_summary}")
    if w.substitutes and w.substitutes.candidates:
        names = ", ".join(
            f"{c.drug_name} ({c.target_protein.split(' ')[0] if c.target_protein else '?'}, sim {c.target_similarity:.2f})"
            for c in w.substitutes.candidates[:3]
        )
        parts.append(
            f"Therapeutic substitutes (BioNeMo ESM2 ranked): {names}. "
            f"Recalled target: {w.substitutes.recalled_target}."
        )
    return "\n".join(parts)


CHAT_SYSTEM = """ROLE
You are Reflex's voice operator AND action agent. You are the conversational
front-end to an 11-agent pharmacovigilance swarm, AND you have tools to take
real action on behalf of the user (a pharmacy director, P&T chair, or
healthcare journalist).

DEFAULT POSTURE: ACT, DON'T REFUSE
When the user gives any directive verb — "send the memo", "notify the
clinicians", "publish", "do that", "take next steps", "alert everyone",
"run a sub-brief", "show me", "open the brief", "trigger a new workflow",
"monitor X" — CALL THE APPROPRIATE TOOL. Do not say "not in scope" for
anything that maps to a tool you have. The tools cover real pharmacy ops.

TOOLS
- trigger_new_workflow: start a new analysis for a different drug
- send_pharmacist_memo, send_clinician_alert, send_patient_letters: actually
  dispatch the drafted communications (logged in the outbox, recipient
  counts returned)
- publish_brief: republish to cited.md
- run_premium_subbrief: pay $0.50 and run a deeper analysis (subgroup
  slice, formulary alternatives, etc.) — this performs a REAL x402
  settlement (signed or on-chain)
- list_recent_recalls: enumerate what's been processed
- navigate_to_brief: open the brief page in the user's browser
- get_wallet_status: check the burner wallet balance

CHAINING
Multiple tools per turn is fine. "Take next steps" almost always means:
send_pharmacist_memo + send_clinician_alert + send_patient_letters (in
that order). Acknowledge what you did in one sentence afterwards.

VOICE STYLE
- After tool calls, speak in one or two short sentences confirming what
  was done and offering the next logical action.
- Lead with the action verb.
- No bulleted lists when speaking; use prose.

GROUNDING
- Use the supplied workflow context for facts.
- Never invent FDA classifications, citation URLs, or cohort numbers.

WHEN A TOOL FAILS
- If a tool returns an error, say what failed in one sentence and offer a
  workable next step (e.g. "the brief isn't drafted yet — the swarm is
  still on the Verify step").
"""


async def _run_agent_loop(
    user_message: str, workflow_id: UUID | None, history: list[ChatTurn]
) -> dict[str, Any]:
    """Multi-turn tool-calling loop. Returns {answer, actions: [tool_call_records]}."""
    import json
    from apps.api import agent_tools
    from apps.api.tools.reasoning import reason_with_tools, ReasoningUnavailable

    ctx = _build_chat_context(workflow_id)
    system_blocks = [CHAT_SYSTEM]
    if ctx:
        system_blocks.append(f"WORKFLOW CONTEXT (use as source of truth):\n{ctx}")
    if workflow_id:
        system_blocks.append(
            f"DEFAULT WORKFLOW ID (use this if the user does not specify): {workflow_id}"
        )

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": "\n\n".join(system_blocks)}
    ]
    for t in (history or [])[-8:]:
        messages.append({"role": t.role, "content": t.content})
    messages.append({"role": "user", "content": user_message})

    actions: list[dict[str, Any]] = []
    client_hints: list[dict[str, Any]] = []

    for _ in range(5):  # max 5 tool-call rounds
        try:
            msg = await reason_with_tools(
                messages, agent_tools.TOOL_SPECS, max_tokens=800
            )
        except ReasoningUnavailable:
            return {
                "answer": "Reasoning engine is offline. Set NVIDIA_API_KEY to enable.",
                "actions": actions,
                "client_hints": client_hints,
            }
        except Exception as e:  # noqa: BLE001
            log.warning("agent loop NIM call failed: %s", e)
            return {
                "answer": "I had trouble reaching the reasoning engine. Try again in a moment.",
                "actions": actions,
                "client_hints": client_hints,
            }

        tool_calls = getattr(msg, "tool_calls", None) or []
        if not tool_calls:
            final = (getattr(msg, "content", None) or "").strip()
            return {"answer": final, "actions": actions, "client_hints": client_hints}

        # Record the assistant's tool-call message so the loop is well-formed.
        messages.append(
            {
                "role": "assistant",
                "content": getattr(msg, "content", "") or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments or "{}",
                        },
                    }
                    for tc in tool_calls
                ],
            }
        )

        # Execute each tool call and feed results back.
        for tc in tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except Exception:
                args = {}
            # Inject the default workflow_id if one was implied and the tool needs it.
            if (
                "workflow_id" in (tc.function.name or "")
                or tc.function.name in {
                    "send_pharmacist_memo",
                    "send_clinician_alert",
                    "send_patient_letters",
                    "publish_brief",
                    "run_premium_subbrief",
                    "navigate_to_brief",
                }
            ) and not args.get("workflow_id"):
                if workflow_id:
                    args["workflow_id"] = str(workflow_id)

            result = await agent_tools.execute(tc.function.name, args)
            actions.append(
                {
                    "name": tc.function.name,
                    "args": args,
                    "summary": result.get("summary", ""),
                    "result": {k: v for k, v in result.items() if k != "client_hint"},
                }
            )
            if result.get("client_hint"):
                client_hints.append(result["client_hint"])
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result, default=str)[:4000],
                }
            )

    return {
        "answer": "I ran out of tool-call rounds without a final summary.",
        "actions": actions,
        "client_hints": client_hints,
    }


@app.post("/api/v1/chat")
async def chat(req: ChatRequest):
    result = await _run_agent_loop(req.message, req.workflow_id, req.history or [])
    return result


@app.get("/api/v1/payments/dev-token")
async def dev_token():
    """Local development helper — returns an X-PAYMENT header value the UI can use."""
    import base64 as _b64
    token = mint_dev_token()
    header = _b64.b64encode(
        f'{{"scheme":"jwt-stub","token":"{token}"}}'.encode("utf-8")
    ).decode("utf-8")
    return {"x_payment_header": header, "token": token}


# ----- Real Base Sepolia wallet (burner, testnet, zero monetary value) -----


@app.get("/api/v1/payments/wallet")
async def wallet_info():
    return burner.info()


class SettleRequest(BaseModel):
    amount_usd: float | None = None
    to: str | None = None


@app.post("/api/v1/payments/settle")
async def wallet_settle(req: SettleRequest):
    """Sign and broadcast a real Base Sepolia USDC transfer from the burner wallet.

    Returns the tx hash + BaseScan link + (best-effort) on-chain receipt.
    """
    import asyncio as _asyncio

    s = get_settings()
    amount = req.amount_usd or s.x402_price_usd
    to_addr = req.to or s.x402_pay_to_address or burner.get_account().address  # self-transfer if no payee configured

    try:
        result = await _asyncio.to_thread(burner.send_usdc, amount, to_addr)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e))

    # Poll receipt in background-ish (short wait, then return).
    receipt = await _asyncio.to_thread(burner.wait_for_receipt, result["tx_hash"], 18)
    result["receipt"] = receipt
    return result
