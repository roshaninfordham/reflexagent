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
You are Reflex's voice operator — the conversational front-end to a 10-agent
pharmacovigilance swarm. The user is a pharmacy director, P&T chair, or
investigative journalist asking questions about a verified safety brief.

VOICE STYLE
- Speak in short sentences (≤20 words).
- One idea per sentence. No bulleted lists when speaking aloud.
- Numerals stated as words when natural ("eighteen patients" reads better
  out loud than "18 patients" — but exact counts may stay as digits).
- No hedging filler like "I think" or "perhaps".
- Always lead with the answer; then one sentence of context.

GROUNDING
- Use only the supplied workflow context. If the user asks something not
  in scope, say so in one sentence and offer what you CAN answer.
- Never invent FDA classifications, citation URLs, or cohort numbers.

WHEN YOU LACK INFORMATION
- "I don't have that yet" + offer to trigger a new workflow.

ACTIONABLE SUGGESTIONS
- When asked "what should we do", lean on the Routing and Comms outputs:
  pharmacist memo, clinician alert, patient letter — refer to them by name.
- When asked about alternatives, refer to the BioNeMo Substitute agent's
  ranked list explicitly ("the Substitute agent ranks Sitagliptin first
  with similarity 0.93")."""


@app.post("/api/v1/chat")
async def chat(req: ChatRequest):
    ctx = _build_chat_context(req.workflow_id)
    history_text = "\n".join(
        f"{t.role.upper()}: {t.content}" for t in (req.history or [])[-8:]
    )
    user_block = (
        (f"Workflow context:\n{ctx}\n\n" if ctx else "")
        + (f"Conversation so far:\n{history_text}\n\n" if history_text else "")
        + f"User: {req.message}"
    )
    try:
        answer = await reason(CHAT_SYSTEM, user_block, max_tokens=400)
    except Exception as e:  # noqa: BLE001
        log.warning("chat fallback: %s", e)
        answer = (
            "Reasoning engine is rate-limited. The active brief is on screen; "
            "try again in a moment."
        )
    return {"answer": answer}


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
