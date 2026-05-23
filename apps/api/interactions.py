"""Drug-drug interaction checker via openFDA Drug Label API.

openFDA aggregates FDA Structured Product Labels. The `drug_interactions`
section of any label lists the manufacturer-curated interaction warnings.
Cross-referencing two drugs' labels gives a high-recall pairwise warning.

  https://api.fda.gov/drug/label.json?search=openfda.generic_name:"<drug>"
"""
from __future__ import annotations

import logging
import re
from typing import Any

import httpx

log = logging.getLogger(__name__)

FDA_LABEL = "https://api.fda.gov/drug/label.json"


async def _search(drug: str) -> dict[str, Any] | None:
    name = drug.lower().split()[0]  # first token usually most reliable
    url = f'{FDA_LABEL}?search=openfda.generic_name:"{name}"&limit=1'
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url)
            if r.status_code == 200:
                results = (r.json() or {}).get("results", [])
                return results[0] if results else None
    except Exception as e:  # noqa: BLE001
        log.debug("openFDA label fetch for %s failed: %s", drug, e)
    return None


def _truncate(text: str, n: int = 1200) -> str:
    return (text[:n] + "…") if len(text) > n else text


async def get_label(drug: str) -> dict[str, Any]:
    """Returns drug label sections relevant to safety + interactions."""
    rec = await _search(drug)
    if not rec:
        return {"drug": drug, "found": False}
    of = rec.get("openfda") or {}

    def join(field: str) -> str:
        v = rec.get(field)
        if isinstance(v, list):
            return _truncate(" ".join(v))
        return _truncate(str(v or ""))

    return {
        "drug": drug,
        "found": True,
        "brand": (of.get("brand_name") or [None])[0],
        "generic": (of.get("generic_name") or [None])[0],
        "manufacturer": (of.get("manufacturer_name") or [None])[0],
        "rxcui": (of.get("rxcui") or [None])[0],
        "drug_interactions": join("drug_interactions"),
        "warnings": join("warnings"),
        "contraindications": join("contraindications"),
        "adverse_reactions": join("adverse_reactions"),
        "boxed_warning": join("boxed_warning"),
        "set_id": (of.get("spl_set_id") or [None])[0],
    }


def _extract_pair_warnings(label_text: str, other_drug: str) -> list[str]:
    if not label_text:
        return []
    other = other_drug.lower().split()[0]
    sentences = re.split(r"(?<=[.!?])\s+", label_text)
    hits = []
    for s in sentences:
        if other in s.lower():
            hits.append(s.strip())
    return hits[:5]


async def check_pair(drug_a: str, drug_b: str) -> dict[str, Any]:
    """Symmetric pair check — does either drug's label mention the other?"""
    label_a = await get_label(drug_a)
    label_b = await get_label(drug_b)
    hits_in_a = _extract_pair_warnings(
        (label_a.get("drug_interactions", "") + " " + label_a.get("warnings", ""))
        if label_a.get("found") else "",
        drug_b,
    )
    hits_in_b = _extract_pair_warnings(
        (label_b.get("drug_interactions", "") + " " + label_b.get("warnings", ""))
        if label_b.get("found") else "",
        drug_a,
    )
    severity = "none"
    if hits_in_a or hits_in_b:
        severity = "moderate"
        for h in hits_in_a + hits_in_b:
            l = h.lower()
            if any(k in l for k in [
                "contraindicated", "do not", "avoid", "fatal", "death", "life-threatening",
                "increase risk of death", "boxed warning",
            ]):
                severity = "severe"
                break
            if any(k in l for k in ["serious", "increase risk", "decrease", "hypoglycemia", "hyperkalemia"]):
                severity = severity if severity == "severe" else "moderate"
    return {
        "drug_a": drug_a,
        "drug_b": drug_b,
        "severity": severity,
        "label_a": {"found": label_a.get("found"), "rxcui": label_a.get("rxcui"), "manufacturer": label_a.get("manufacturer")},
        "label_b": {"found": label_b.get("found"), "rxcui": label_b.get("rxcui"), "manufacturer": label_b.get("manufacturer")},
        "hits_in_a_label": hits_in_a,
        "hits_in_b_label": hits_in_b,
    }
