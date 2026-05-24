"""Reflex copilot — action toolkit.

The copilot endpoint `/api/v1/chat` exposes these as OpenAI-spec tool
definitions to the NIM Llama 3.3 70B model. The model decides when to call
them; we execute them server-side; results feed back into the next loop
iteration so the model can chain actions.

Every tool returns a dict with two important fields:
  - `summary`: a one-line sentence the model can speak / show back.
  - `client_hint`: optional dict the UI can act on (`navigate`, `toast`,
    `refresh`).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any
from uuid import UUID

from apps.api import historical as historical_mod
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
            "name": "get_dashboard_state",
            "description": (
                "Fetch a fresh snapshot of the entire Reflex system: every workflow "
                "(running/completed/failed), anything held for human review with the "
                "conflict summary, monitor poll status, wallet balance, and recent "
                "outbox activity. Call this FIRST whenever the user asks 'what's "
                "happening', 'what should I do', 'anything for me', or anything "
                "open-ended about current state."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "launch_demo_workflow",
            "description": (
                "Fire the curated demo workflow (Metformin nitrosamine recall) — "
                "fastest way to show the full 11-agent swarm end-to-end. Returns "
                "the new workflow_id and navigates the user to it."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_new_workflow",
            "description": (
                "Start a brand new pharmacovigilance workflow for a specific drug. "
                "Use when the user names a drug to analyze ('look at valsartan', "
                "'check losartan') or asks to re-run."
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
            "name": "replay_historical_recall",
            "description": (
                "Re-run Reflex against a famous historical recall (valsartan-2018, "
                "ranitidine-2019, metformin-2020, tylenol-1982, vioxx-2004, "
                "dabigatran-2014). Shows how the swarm would have handled it."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "slug": {
                        "type": "string",
                        "enum": [
                            "valsartan-2018", "ranitidine-2019", "metformin-2020",
                            "tylenol-1982", "vioxx-2004", "dabigatran-2014",
                        ],
                    },
                },
                "required": ["slug"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_workflow_detail",
            "description": (
                "Return the full state of one workflow (brief, triage, cohort, "
                "verification, substitutes, comms, published). Use when the user "
                "asks about a specific workflow or 'what's in the brief'."
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
            "name": "dispatch_all_comms",
            "description": (
                "Convenience: send the pharmacist memo + clinician alert + patient "
                "letters in one shot. Use for 'take next steps', 'handle this', "
                "'notify everyone', 'do all of it'."
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
            "name": "send_pharmacist_memo",
            "description": "Dispatch only the pharmacist memo for this workflow.",
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
            "description": "Dispatch only the clinician alert for this workflow.",
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
            "description": "Send the patient letter to every patient in the affected cohort.",
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
            "name": "approve_review",
            "description": (
                "Approve a workflow that was held for human review (verdict = "
                "requires_human). Marks the conflict as accepted by the operator "
                "and unlocks publish. Use when the user says 'approve it', "
                "'override the conflict', 'I've seen it, go ahead'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "workflow_id": {"type": "string"},
                    "note": {"type": "string", "description": "Operator rationale (optional)."},
                },
                "required": ["workflow_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "publish_brief",
            "description": (
                "Publish (or republish) the workflow's brief to cited.md via "
                "Senso + git mirror."
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
                "Pay $0.50 (signed x402, or real Base Sepolia tx if wallet is funded) "
                "and run a deeper sub-analysis on a specific question (subgroup "
                "slice, formulary alternatives, etc)."
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
            "name": "navigate",
            "description": (
                "Navigate the user's browser to a specific Reflex page. Use for "
                "'show me the map', 'take me to the ops page', 'open the brief'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "page": {
                        "type": "string",
                        "enum": [
                            "ops", "landing", "premium", "historical", "wallet",
                            "brief", "workflow", "trace",
                        ],
                    },
                    "workflow_id": {"type": "string", "description": "Required for 'brief', 'workflow', 'trace'."},
                    "slug": {"type": "string", "description": "Required for historical-recall pages."},
                },
                "required": ["page"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_wallet_status",
            "description": "Report the burner wallet address + USDC + ETH on Base Sepolia.",
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
                    "triggered_by": "copilot",
                }
            ],
        )
    except Exception as e:  # noqa: BLE001
        log.warning("outbox insert failed: %s", e)


async def _get_dashboard_state() -> dict[str, Any]:
    workflows = list_recent(15)
    by_status: dict[str, int] = {"running": 0, "completed": 0, "failed": 0}
    queue: list[dict[str, Any]] = []
    wf_brief: list[dict[str, Any]] = []
    total_patients = 0
    total_high_risk = 0
    for w in workflows:
        by_status[w.status] = by_status.get(w.status, 0) + 1
        drug = (w.normalized.normalized_drug if w.normalized
                else (w.payload.drug_name or "unknown"))
        cohort = w.cohort.patient_count if w.cohort else 0
        hr = w.cohort.high_risk_count if w.cohort else 0
        total_patients += cohort
        total_high_risk += hr
        row = {
            "workflow_id": str(w.workflow_id),
            "drug": drug,
            "status": w.status,
            "cohort_patients": cohort,
            "high_risk": hr,
            "severity": (w.triage.severity if w.triage else None),
            "severity_score": (w.triage.severity_score if w.triage else None),
            "verdict": (w.verification.verdict if w.verification else None),
            "published": bool(w.published),
            "brief_title": (w.brief.title if w.brief else None),
        }
        wf_brief.append(row)
        if w.verification and w.verification.verdict == "requires_human":
            queue.append({
                "workflow_id": str(w.workflow_id),
                "drug": drug,
                "conflict": w.verification.conflict_summary or "(unspecified)",
                "counter_evidence_count": len(w.verification.counter_evidence or []),
            })

    wallet_info = burner.info()

    # Recent outbox (best-effort).
    recent_acts: list[dict[str, Any]] = []
    try:
        rows = clickhouse_client.query(
            "SELECT channel, drug_name, recipient_count, body FROM outbox "
            "ORDER BY created_at DESC LIMIT 5"
        )
        for r in rows:
            recent_acts.append({
                "channel": r[0],
                "drug": r[1],
                "recipients": r[2],
                "preview": (r[3] or "")[:120],
            })
    except Exception:
        pass

    summary = (
        f"{by_status['running']} running · {by_status['completed']} verified · "
        f"{by_status['failed']} failed · {len(queue)} held for human review · "
        f"{total_patients} patients on watch ({total_high_risk} high-risk)."
    )

    return {
        "summary": summary,
        "counts": by_status,
        "patients_on_watch": total_patients,
        "high_risk_patients": total_high_risk,
        "queue_requires_human": queue,
        "workflows": wf_brief,
        "wallet": {
            "address": wallet_info["address"],
            "usdc": wallet_info["usdc_balance_micro"] / 1_000_000,
            "eth": wallet_info["eth_balance_wei"] / 1e18,
        },
        "recent_activity": recent_acts,
    }


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
    task = asyncio.create_task(orchestrate(payload))
    for _ in range(80):
        await asyncio.sleep(0.05)
        for w in list_recent(20):
            if w.payload is payload:
                return {
                    "summary": f"Workflow started for {payload.drug_name}. The 11-agent swarm is running.",
                    "workflow_id": str(w.workflow_id),
                    "status": "running",
                    "client_hint": {
                        "navigate": f"/ops?wf={w.workflow_id}",
                        "toast": f"Workflow started: {payload.drug_name}",
                        "refresh": True,
                    },
                }
    _ = task
    return {"summary": f"Workflow queued for {payload.drug_name}.", "status": "queued"}


async def _launch_demo_workflow() -> dict[str, Any]:
    payload = TriggerPayload(
        drug_name="Metformin HCl ER 500mg",
        manufacturer="Marksans Pharma",
        reason="NDMA above acceptable intake limit",
        recall_class="II",
        ndc="49483-623-01",
        lot_numbers=["XX0421A"],
        source="demo",
        confidence=0.99,
    )
    task = asyncio.create_task(orchestrate(payload))
    for _ in range(80):
        await asyncio.sleep(0.05)
        for w in list_recent(20):
            if w.payload is payload:
                return {
                    "summary": "Demo workflow launched (Metformin NDMA recall). Swarm is running now.",
                    "workflow_id": str(w.workflow_id),
                    "client_hint": {
                        "navigate": f"/ops?wf={w.workflow_id}",
                        "toast": "Demo workflow launched",
                        "refresh": True,
                    },
                }
    _ = task
    return {"summary": "Demo workflow queued."}


async def _replay_historical(slug: str) -> dict[str, Any]:
    rec = historical_mod.get_recall(slug)
    if not rec:
        return {"summary": f"Unknown historical slug: {slug}.", "error": "unknown_slug"}
    payload = TriggerPayload(
        drug_name=rec["drug"],
        manufacturer=None,
        reason=rec.get("story", "")[:280],
        recall_class=None,
        source=f"historical:{slug}",
        confidence=0.99,
    )
    task = asyncio.create_task(orchestrate(payload))
    for _ in range(80):
        await asyncio.sleep(0.05)
        for w in list_recent(20):
            if w.payload is payload:
                return {
                    "summary": f"Replaying {rec['drug']} ({rec['year']}). Running the swarm against the historical case.",
                    "workflow_id": str(w.workflow_id),
                    "slug": slug,
                    "client_hint": {
                        "navigate": f"/ops?wf={w.workflow_id}",
                        "toast": f"Replaying {rec['drug']} {rec['year']}",
                        "refresh": True,
                    },
                }
    _ = task
    return {"summary": f"Replay queued for {rec['drug']}."}


def _get_workflow_detail(workflow_id: str) -> dict[str, Any]:
    try:
        wid = UUID(workflow_id)
    except Exception:
        return {"summary": "Invalid workflow id.", "error": "bad_uuid"}
    w = get_result(wid)
    if not w:
        return {"summary": "No such workflow.", "error": "not_found"}
    out: dict[str, Any] = {
        "summary": f"Status {w.status}.",
        "status": w.status,
        "drug": (w.normalized.normalized_drug if w.normalized
                 else (w.payload.drug_name or "?")),
    }
    if w.brief:
        out["brief"] = {
            "title": w.brief.title,
            "summary": w.brief.summary,
            "findings": w.brief.findings,
            "severity_score": w.brief.severity_score,
        }
    if w.triage:
        out["triage"] = {
            "severity": w.triage.severity,
            "score": w.triage.severity_score,
            "urgency": w.triage.urgency,
        }
    if w.cohort:
        out["cohort"] = {
            "patient_count": w.cohort.patient_count,
            "high_risk_count": w.cohort.high_risk_count,
        }
    if w.verification:
        out["verification"] = {
            "verdict": w.verification.verdict,
            "conflict_summary": w.verification.conflict_summary,
        }
    if w.substitutes and w.substitutes.candidates:
        out["substitutes"] = [
            {"drug": c.drug_name, "target_similarity": c.target_similarity}
            for c in w.substitutes.candidates[:5]
        ]
    if w.published:
        out["published_url"] = w.published.cited_md_url
    return out


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
    pretty = channel.replace("_", " ")
    return {
        "summary": f"Sent {pretty} to {len(targets)} recipients.",
        "channel": channel,
        "recipients": targets,
        "body_preview": body[:200] + ("…" if len(body) > 200 else ""),
        "client_hint": {"toast": f"{pretty.title()} dispatched ({len(targets)})"},
    }


async def _dispatch_all_comms(workflow_id: str) -> dict[str, Any]:
    results = []
    for channel in ("pharmacist_memo", "clinician_alert", "patient_letter"):
        r = await _send_comm(workflow_id, channel)
        results.append({channel: r})
        if r.get("error"):
            return {"summary": f"Stopped at {channel}: {r['summary']}", "partial": results}
    total = sum(
        len(list(d.values())[0].get("recipients") or [])
        for d in results
    )
    return {
        "summary": f"Sent pharmacist memo, clinician alert, and patient letters — {total} total recipients.",
        "results": results,
        "client_hint": {"toast": f"All comms dispatched ({total} recipients)", "refresh": True},
    }


async def _approve_review(workflow_id: str, note: str = "") -> dict[str, Any]:
    try:
        wid = UUID(workflow_id)
    except Exception:
        return {"summary": "Invalid workflow id.", "error": "bad_uuid"}
    w = get_result(wid)
    if not w:
        return {"summary": "No such workflow.", "error": "not_found"}
    if not w.verification or w.verification.verdict != "requires_human":
        return {
            "summary": "This workflow does not need human review.",
            "current_verdict": (w.verification.verdict if w.verification else None),
        }
    w.verification.verdict = "approved_by_operator"
    if note:
        w.verification.conflict_summary = (
            (w.verification.conflict_summary or "") + f"\nOperator: {note}"
        )
    _log_outbox(wid, "approve_review", note or "approved", recipient_count=1)
    # If brief is ready and not yet published, publish now.
    if w.brief and w.audit and not w.published:
        pub = await publisher_agent.run(
            wid, w.brief, w.audit,
            cohort_count=w.cohort.patient_count if w.cohort else 0,
            cohort_high_risk=w.cohort.high_risk_count if w.cohort else 0,
            agents_verified=w.audit.citations_verified if w.audit else 0,
        )
        w.published = pub
        return {
            "summary": f"Approved and published — {pub.cited_md_url}",
            "published_url": pub.cited_md_url,
            "client_hint": {"navigate": f"/brief/{workflow_id}", "toast": "Approved & published", "refresh": True},
        }
    return {
        "summary": "Approved. Brief will publish once the swarm finishes drafting.",
        "client_hint": {"toast": "Review approved", "refresh": True},
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


def _navigate(page: str, workflow_id: str | None = None, slug: str | None = None) -> dict[str, Any]:
    mapping = {
        "ops": "/ops",
        "landing": "/",
        "premium": "/premium",
        "historical": f"/historical/{slug}" if slug else "/historical",
        "wallet": "/wallet",
        "brief": f"/brief/{workflow_id}" if workflow_id else None,
        "workflow": f"/workflow/{workflow_id}" if workflow_id else None,
        "trace": f"/trace/{workflow_id}" if workflow_id else None,
    }
    dest = mapping.get(page)
    if not dest:
        return {"summary": f"Cannot navigate to {page} without the required id.", "error": "missing_arg"}
    return {"summary": f"Opening {dest}.", "client_hint": {"navigate": dest}}


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
        if name == "get_dashboard_state":
            return await _get_dashboard_state()
        if name == "launch_demo_workflow":
            return await _launch_demo_workflow()
        if name == "trigger_new_workflow":
            return await _trigger_new_workflow(args)
        if name == "replay_historical_recall":
            return await _replay_historical(args["slug"])
        if name == "get_workflow_detail":
            return _get_workflow_detail(args["workflow_id"])
        if name == "dispatch_all_comms":
            return await _dispatch_all_comms(args["workflow_id"])
        if name == "send_pharmacist_memo":
            return await _send_comm(args["workflow_id"], "pharmacist_memo")
        if name == "send_clinician_alert":
            return await _send_comm(args["workflow_id"], "clinician_alert")
        if name == "send_patient_letters":
            return await _send_comm(args["workflow_id"], "patient_letter")
        if name == "approve_review":
            return await _approve_review(args["workflow_id"], args.get("note", ""))
        if name == "publish_brief":
            return await _publish_brief(args["workflow_id"])
        if name == "run_premium_subbrief":
            return await _run_premium_subbrief(args["workflow_id"], args.get("question", ""))
        if name == "navigate":
            return _navigate(args["page"], args.get("workflow_id"), args.get("slug"))
        if name == "get_wallet_status":
            return _get_wallet_status()
        return {"summary": f"Unknown tool: {name}", "error": "unknown_tool"}
    except Exception as e:  # noqa: BLE001
        log.exception("tool %s failed", name)
        return {"summary": f"{name} failed: {e}", "error": str(e)}
