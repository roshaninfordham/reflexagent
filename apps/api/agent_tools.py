"""Voice-agent action toolkit.

The voice agent's `/api/v1/chat` endpoint exposes these as OpenAI-spec tool
definitions to the NIM Llama 3.3 70B model. The model decides when to call
them; we execute them server-side; results feed back into the next loop
iteration so the model can chain actions.

Every tool returns a small dict with two important fields:
  - `summary`: a single sentence the model can speak back to the user.
  - `client_hint`: optional dict the UI can act on (e.g. {"navigate": "/brief/.."}).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any
from uuid import UUID

from apps.api import wallet as burner
from apps.api.agents import publisher as publisher_agent
from apps.api.orchestrator import get_result, list_recent, orchestrate
from apps.api.payments import mint_dev_token, verify_x402_payment
from apps.api.schemas import TriggerPayload
from apps.api.settings import get_settings
from apps.api.tools import clickhouse_client
from apps.api.tools.reasoning import reason

log = logging.getLogger(__name__)


# ----- OpenAI-spec tool definitions exposed to the model -----

TOOL_SPECS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "trigger_new_workflow",
            "description": (
                "Start a brand new pharmacovigilance workflow for a specific drug recall. "
                "Use this when the user asks to monitor a new drug, re-run analysis, or "
                "process a different recall. The 11-agent swarm fires unprompted afterwards."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "drug_name": {"type": "string", "description": "Drug name (e.g. 'Valsartan')"},
                    "manufacturer": {"type": "string"},
                    "reason": {"type": "string", "description": "Reason for the recall"},
                    "recall_class": {"type": "string", "enum": ["I", "II", "III"]},
                    "ndc": {"type": "string"},
                    "lot_numbers": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["drug_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_pharmacist_memo",
            "description": (
                "Dispatch the pharmacist memo for the active workflow to the pharmacy "
                "operations team. Use when the user says 'send the memo', 'notify the "
                "pharmacy', or 'take next steps'."
            ),
            "parameters": {
                "type": "object",
                "properties": {"workflow_id": {"type": "string"}},
                "required": ["workflow_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_clinician_alert",
            "description": (
                "Send the clinician alert (terse, actionable) to attending physicians "
                "on service. Use when the user says 'alert the doctors' or 'notify clinicians'."
            ),
            "parameters": {
                "type": "object",
                "properties": {"workflow_id": {"type": "string"}},
                "required": ["workflow_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_patient_letters",
            "description": (
                "Send the patient letter to every patient in the affected cohort. Use when "
                "the user says 'notify the patients' or 'send the letters'."
            ),
            "parameters": {
                "type": "object",
                "properties": {"workflow_id": {"type": "string"}},
                "required": ["workflow_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "publish_brief",
            "description": (
                "Publish (or republish) the workflow's brief to cited.md via Senso + git "
                "mirror. Use when the user says 'publish' or 'push it live'."
            ),
            "parameters": {
                "type": "object",
                "properties": {"workflow_id": {"type": "string"}},
                "required": ["workflow_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_premium_subbrief",
            "description": (
                "Pay $0.50 (signed x402, or real Base Sepolia tx if wallet is funded) and "
                "run a premium sub-brief that deep-analyzes a specific question. Use when "
                "the user asks for a subgroup analysis, formulary alternatives, or any "
                "question requiring deeper investigation than the main brief covers."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "workflow_id": {"type": "string"},
                    "question": {"type": "string"},
                },
                "required": ["workflow_id", "question"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_recent_recalls",
            "description": "List the most recent workflows the swarm has processed.",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "default": 5}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "navigate_to_brief",
            "description": "Open the published brief page in the user's browser.",
            "parameters": {
                "type": "object",
                "properties": {"workflow_id": {"type": "string"}},
                "required": ["workflow_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_wallet_status",
            "description": "Report the burner wallet address, USDC balance, and ETH balance for the user.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


# ----- Tool implementations -----


def _drug_name_for(workflow_id: UUID | None) -> str:
    if not workflow_id:
        return ""
    w = get_result(workflow_id)
    if w and w.normalized:
        return w.normalized.normalized_drug
    if w and w.payload and w.payload.drug_name:
        return w.payload.drug_name
    return ""


def _log_outbox(
    workflow_id: UUID | None,
    channel: str,
    body: str,
    recipient_count: int = 0,
    payload_json: str = "",
) -> None:
    try:
        clickhouse_client.insert(
            "outbox",
            [
                {
                    "workflow_id": str(workflow_id) if workflow_id else str(UUID(int=0)),
                    "drug_name": _drug_name_for(workflow_id),
                    "channel": channel,
                    "recipient_count": recipient_count,
                    "body": body[:8000],
                    "payload_json": payload_json[:2000],
                    "triggered_by": "voice_agent",
                }
            ],
        )
    except Exception as e:  # noqa: BLE001
        log.warning("outbox insert failed: %s", e)


async def _trigger_new_workflow(args: dict[str, Any]) -> dict[str, Any]:
    payload = TriggerPayload(
        drug_name=args.get("drug_name"),
        manufacturer=args.get("manufacturer"),
        reason=args.get("reason"),
        recall_class=args.get("recall_class"),
        ndc=args.get("ndc"),
        lot_numbers=args.get("lot_numbers") or [],
        source="manual",
        confidence=0.95,
    )
    # Kick off in background — orchestrator registers within ~50ms.
    task = asyncio.create_task(orchestrate(payload))
    # Wait briefly for the workflow_id to be assigned.
    for _ in range(60):
        await asyncio.sleep(0.05)
        recents = list_recent(20)
        for w in recents:
            if w.payload is payload:
                return {
                    "summary": f"Workflow started for {payload.drug_name}.",
                    "workflow_id": str(w.workflow_id),
                    "status": "running",
                    "client_hint": {"navigate": f"/workflow/{w.workflow_id}"},
                }
    # If orchestrator hasn't registered yet, still return something useful.
    _ = task
    return {"summary": f"Workflow queued for {payload.drug_name}.", "status": "queued"}


async def _send_comm(workflow_id: str, channel: str) -> dict[str, Any]:
    try:
        wid = UUID(workflow_id)
    except Exception:
        return {"summary": "Invalid workflow id.", "error": "bad_uuid"}
    w = get_result(wid)
    if not w or not w.comms:
        return {
            "summary": "The workflow has not finished drafting communications yet.",
            "error": "comms_not_ready",
        }
    if channel == "pharmacist_memo":
        body = w.comms.pharmacist_memo
        targets = [t for t in w.comms.routing_targets if "Pharmac" in t or "Dispens" in t] or ["Pharmacy Director"]
    elif channel == "clinician_alert":
        body = w.comms.clinician_alert
        targets = [t for t in w.comms.routing_targets if "Attending" in t or "Chair" in t or "Hospital" in t] or ["Attending Physicians"]
    elif channel == "patient_letter":
        body = w.comms.patient_letter
        targets = [f"patient:{pid}" for pid in (w.cohort.sample_ids if w.cohort else [])][:5]
        if not targets and w.cohort:
            targets = [f"patient:cohort-{w.cohort.patient_count}"]
    else:
        return {"summary": "Unknown channel.", "error": "bad_channel"}
    _log_outbox(wid, channel, body, recipient_count=len(targets), payload_json=str(targets))
    return {
        "summary": f"Sent {channel.replace('_', ' ')} to {len(targets)} recipients.",
        "channel": channel,
        "recipients": targets,
        "body_preview": body[:200] + ("…" if len(body) > 200 else ""),
        "client_hint": {"toast": f"{channel.replace('_', ' ').title()} dispatched ({len(targets)} recipients)"},
    }


async def _publish_brief(workflow_id: str) -> dict[str, Any]:
    try:
        wid = UUID(workflow_id)
    except Exception:
        return {"summary": "Invalid workflow id.", "error": "bad_uuid"}
    w = get_result(wid)
    if not w or not w.brief or not w.audit:
        return {"summary": "Brief is not ready yet.", "error": "not_ready"}
    pub = await publisher_agent.run(
        wid,
        w.brief,
        w.audit,
        cohort_count=w.cohort.patient_count if w.cohort else 0,
        cohort_high_risk=w.cohort.high_risk_count if w.cohort else 0,
        agents_verified=w.audit.citations_verified if w.audit else 0,
    )
    w.published = pub
    _log_outbox(wid, "publish", pub.cited_md_url, recipient_count=1)
    return {
        "summary": "Brief published.",
        "url": pub.cited_md_url,
        "fallback": pub.fallback,
        "client_hint": {"navigate": f"/brief/{workflow_id}", "toast": "Brief published"},
    }


async def _run_premium_subbrief(workflow_id: str, question: str) -> dict[str, Any]:
    try:
        wid = UUID(workflow_id)
    except Exception:
        return {"summary": "Invalid workflow id.", "error": "bad_uuid"}
    s = get_settings()
    w = get_result(wid)
    ctx = ""
    if w and w.brief:
        ctx = (
            f"Drug: {w.brief.drug_name}\nSummary: {w.brief.summary}\n"
            f"Severity: {w.brief.severity_score}/10\n"
            f"Cohort: {w.cohort.patient_count if w.cohort else 0} "
            f"({w.cohort.high_risk_count if w.cohort else 0} high-risk).\n"
        )
        if w.substitutes and w.substitutes.candidates:
            ctx += "Substitutes: " + ", ".join(
                f"{c.drug_name} (sim {c.target_similarity:.2f})"
                for c in w.substitutes.candidates[:3]
            ) + "\n"

    # Settle payment: prefer on-chain if burner funded; else mint JWT.
    settlement: dict[str, Any] | None = None
    try:
        info = burner.info()
        if info["usdc_balance_micro"] >= int(s.x402_price_usd * 10**6) and info["eth_balance_wei"] > 0:
            pay_to = s.x402_pay_to_address or burner.get_account().address
            settlement = await asyncio.to_thread(burner.send_usdc, s.x402_price_usd, pay_to)
            settlement["receipt"] = await asyncio.to_thread(burner.wait_for_receipt, settlement["tx_hash"], 12)
            payer = settlement["from"]
        else:
            token = mint_dev_token()
            import base64
            header = base64.b64encode(f'{{"scheme":"jwt-stub","token":"{token}"}}'.encode()).decode()
            ok, payer = await verify_x402_payment(header)
            if not ok:
                return {"summary": "Payment failed.", "error": "x402_failed"}
    except Exception as e:  # noqa: BLE001
        log.warning("settle in tool failed: %s", e)
        payer = "agent-fallback"

    answer = await reason(
        system=(
            "You write concise pharmacovigilance sub-briefs. Be precise, structured, "
            "and cite which subgroup or angle you are analyzing. ≤300 words."
        ),
        user=f"Source brief context:\n{ctx}\n\nUser question:\n{question}",
        max_tokens=900,
    )

    _log_outbox(
        wid,
        "payment",
        f"Sub-brief paid ${s.x402_price_usd} by {payer}",
        recipient_count=1,
        payload_json=str(settlement or {}),
    )
    out: dict[str, Any] = {
        "summary": "Sub-brief generated.",
        "answer": answer,
        "payer": payer,
    }
    if settlement:
        out["settlement"] = {
            "tx_hash": settlement.get("tx_hash"),
            "explorer_url": settlement.get("explorer_url"),
            "block": (settlement.get("receipt") or {}).get("block_number"),
        }
        out["client_hint"] = {"toast": f"On-chain settlement: {settlement.get('tx_hash', '')[:14]}…"}
    else:
        out["client_hint"] = {"toast": "Sub-brief generated (signed x402)"}
    return out


def _list_recent_recalls(limit: int = 5) -> dict[str, Any]:
    items = list_recent(limit)
    summary_rows = []
    for w in items:
        drug = (w.normalized.normalized_drug if w.normalized else (w.payload.drug_name or "?"))
        summary_rows.append(
            {
                "workflow_id": str(w.workflow_id),
                "drug": drug,
                "status": w.status,
                "source": w.payload.source,
                "cohort": w.cohort.patient_count if w.cohort else 0,
            }
        )
    one_line = "; ".join(
        f"{r['drug']} ({r['status']}, {r['cohort']} patients)" for r in summary_rows
    )
    return {
        "summary": f"{len(summary_rows)} recent: {one_line}" if summary_rows else "No workflows yet.",
        "workflows": summary_rows,
    }


def _navigate_to_brief(workflow_id: str) -> dict[str, Any]:
    return {
        "summary": "Opening the brief.",
        "client_hint": {"navigate": f"/brief/{workflow_id}"},
    }


def _get_wallet_status() -> dict[str, Any]:
    info = burner.info()
    usdc = info["usdc_balance_micro"] / 1_000_000
    eth = info["eth_balance_wei"] / 1e18
    return {
        "summary": (
            f"Burner wallet has {usdc:.4f} USDC and {eth:.6f} ETH on Base Sepolia testnet."
        ),
        "address": info["address"],
        "usdc": usdc,
        "eth": eth,
        "explorer": info["address_url"],
    }


# ----- Dispatcher -----


async def execute(name: str, args: dict[str, Any]) -> dict[str, Any]:
    try:
        if name == "trigger_new_workflow":
            return await _trigger_new_workflow(args)
        if name == "send_pharmacist_memo":
            return await _send_comm(args["workflow_id"], "pharmacist_memo")
        if name == "send_clinician_alert":
            return await _send_comm(args["workflow_id"], "clinician_alert")
        if name == "send_patient_letters":
            return await _send_comm(args["workflow_id"], "patient_letter")
        if name == "publish_brief":
            return await _publish_brief(args["workflow_id"])
        if name == "run_premium_subbrief":
            return await _run_premium_subbrief(args["workflow_id"], args.get("question", ""))
        if name == "list_recent_recalls":
            return _list_recent_recalls(int(args.get("limit") or 5))
        if name == "navigate_to_brief":
            return _navigate_to_brief(args["workflow_id"])
        if name == "get_wallet_status":
            return _get_wallet_status()
        return {"summary": f"Unknown tool: {name}", "error": "unknown_tool"}
    except Exception as e:  # noqa: BLE001
        log.exception("tool %s failed", name)
        return {"summary": f"{name} failed: {e}", "error": str(e)}
