"""ClinicalTrials.gov v2 API client — find active or completed trials for a
drug. Free, no API key required.

  https://clinicaltrials.gov/api/v2/studies
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)

BASE = "https://clinicaltrials.gov/api/v2/studies"


async def search(term: str, page_size: int = 8) -> list[dict[str, Any]]:
    """Search for trials whose intervention matches the drug name."""
    if not term:
        return []
    # `query.term` is the broad full-text search — covers intervention,
    # condition, sponsor, free-text. Much higher recall than `query.intr`
    # which expects exact intervention name matches.
    params = {
        "query.term": term,
        "pageSize": page_size,
        "format": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(BASE, params=params)
            if r.status_code != 200:
                log.warning("clinicaltrials %s: %s", r.status_code, r.text[:200])
                return []
            body = r.json()
    except Exception as e:  # noqa: BLE001
        log.warning("clinicaltrials fetch failed: %s", e)
        return []

    studies = (body or {}).get("studies", [])
    out: list[dict[str, Any]] = []
    for s in studies:
        proto = (s.get("protocolSection") or {})
        ident = proto.get("identificationModule") or {}
        status_mod = proto.get("statusModule") or {}
        design = proto.get("designModule") or {}
        conditions = (proto.get("conditionsModule") or {}).get("conditions", [])
        arms = (proto.get("armsInterventionsModule") or {})
        interv_names = [i.get("name") for i in arms.get("interventions", []) if i.get("name")]
        sponsor = ((proto.get("sponsorCollaboratorsModule") or {}).get("leadSponsor") or {}).get("name")
        nct = ident.get("nctId")
        out.append(
            {
                "nct_id": nct,
                "title": ident.get("briefTitle"),
                "status": status_mod.get("overallStatus"),
                "phases": design.get("phases") or [],
                "conditions": conditions[:6],
                "interventions": interv_names[:6],
                "start_date": status_mod.get("startDateStruct", {}).get("date") if status_mod.get("startDateStruct") else None,
                "completion_date": status_mod.get("completionDateStruct", {}).get("date") if status_mod.get("completionDateStruct") else None,
                "sponsor": sponsor,
                "url": f"https://clinicaltrials.gov/study/{nct}" if nct else None,
            }
        )
    return out
