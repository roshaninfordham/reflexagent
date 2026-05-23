"""Reflex API surface."""
from __future__ import annotations

import asyncio
import base64
import logging
from datetime import datetime
from typing import Any
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
    if s.monitor_enabled:
        log.info("starting autonomous monitor (interval=%ss)", s.monitor_poll_interval_seconds)
        await monitor_module.start()
    else:
        log.info("monitor disabled (MONITOR_ENABLED=0)")


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
    if not ok:
        challenge = x402_challenge()
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
    )
    return {"answer": answer, "payer": payer, "paid_usd": s.x402_price_usd}


@app.get("/api/v1/payments/dev-token")
async def dev_token():
    """Local development helper — returns an X-PAYMENT header value the UI can use."""
    import base64 as _b64
    token = mint_dev_token()
    header = _b64.b64encode(
        f'{{"scheme":"jwt-stub","token":"{token}"}}'.encode("utf-8")
    ).decode("utf-8")
    return {"x_payment_header": header, "token": token}
