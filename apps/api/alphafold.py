"""AlphaFold DB lookup (EBI, open access, CC-BY 4.0).

For any drug target, return the predicted protein structure published by
DeepMind through the European Bioinformatics Institute. Coverage: ~98% of
the human proteome, plus dozens of model organisms.

  https://alphafold.ebi.ac.uk/api/prediction/{uniprot_id}
  https://alphafold.ebi.ac.uk/files/AF-{uniprot_id}-F1-model_v4.pdb
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)

# Common drug target → UniProt ID (human canonical isoforms).
# Lets us resolve a target name like "AMPK α1" to Q13131 → fetch AlphaFold.
TARGET_UNIPROT: dict[str, tuple[str, str]] = {  # match key (substring) → (uniprot, display)
    "prkaa1": ("Q13131", "PRKAA1 — AMPK α1"),
    "ampk": ("Q13131", "AMPK α1 (PRKAA1)"),
    "dpp4": ("P27487", "DPP-4 (DPP4)"),
    "dipeptidyl peptidase": ("P27487", "DPP-4 (DPP4)"),
    "glp1r": ("P43220", "GLP-1 receptor"),
    "glucagon-like peptide": ("P43220", "GLP-1 receptor (GLP1R)"),
    "slc5a2": ("P31639", "SGLT2 (SLC5A2)"),
    "sglt2": ("P31639", "SGLT2 (SLC5A2)"),
    "hmgcr": ("P04035", "HMG-CoA reductase (HMGCR)"),
    "hmg-coa": ("P04035", "HMG-CoA reductase"),
    "agtr1": ("P30556", "AT1 receptor (AGTR1)"),
    "angiotensin": ("P30556", "AT1 receptor (AGTR1)"),
    "ace": ("P12821", "ACE (peptidyl-dipeptidase A)"),
    "hrh2": ("P25021", "Histamine H2 receptor (HRH2)"),
    "histamine h2": ("P25021", "Histamine H2 receptor (HRH2)"),
    "egfr": ("P00533", "EGFR (epidermal growth factor receptor)"),
    "bcr-abl": ("P00519", "ABL1 (BCR-ABL)"),
    "ptgs1": ("P23219", "COX-1 (PTGS1)"),
    "ptgs2": ("P35354", "COX-2 (PTGS2)"),
    "slc6a4": ("P31645", "SERT (SLC6A4)"),
    "sert": ("P31645", "SERT (SLC6A4)"),
    "pparg": ("P37231", "PPARγ (PPARG)"),
    "vkorc1": ("Q9BQB6", "VKORC1 (vitamin K epoxide reductase)"),
    "f10": ("P00742", "Factor Xa (F10)"),
    "factor xa": ("P00742", "Factor Xa (F10)"),
    "f2": ("P00734", "Thrombin (F2)"),
    "thrombin": ("P00734", "Thrombin (F2)"),
    "kcnj11": ("Q14654", "KCNJ11 (K-ATP channel pore)"),
    "abcc8": ("Q09428", "SUR1 (ABCC8)"),
    "sulfonylurea receptor": ("Q09428", "SUR1 (ABCC8)"),
    # Drug-name shortcuts that aren't strictly proteins but help the UI
    # auto-find the right target for a known drug.
    "dabigatran": ("P00734", "Thrombin (dabigatran target)"),
    "warfarin": ("Q9BQB6", "VKORC1 (warfarin target)"),
    "metformin": ("Q13131", "AMPK α1 (metformin target)"),
    "atorvastatin": ("P04035", "HMG-CoA reductase (statin target)"),
    "simvastatin": ("P04035", "HMG-CoA reductase (statin target)"),
    "valsartan": ("P30556", "AT1 receptor (valsartan target)"),
    "losartan": ("P30556", "AT1 receptor (losartan target)"),
    "ranitidine": ("P25021", "Histamine H2 receptor (ranitidine target)"),
    "omeprazole": ("P20648", "H+/K+ ATPase α (omeprazole target)"),
    "sitagliptin": ("P27487", "DPP-4 (sitagliptin target)"),
    "semaglutide": ("P43220", "GLP-1R (semaglutide target)"),
    "liraglutide": ("P43220", "GLP-1R (liraglutide target)"),
    "empagliflozin": ("P31639", "SGLT2 (empagliflozin target)"),
    "glipizide": ("Q14654", "KCNJ11 (glipizide target)"),
    "pioglitazone": ("P37231", "PPARγ (pioglitazone target)"),
    "rofecoxib": ("P35354", "COX-2 (rofecoxib target)"),
    "vioxx": ("P35354", "COX-2 (rofecoxib target)"),
    "acetaminophen": ("P23219", "COX-1 (acetaminophen target — partial)"),
    "tylenol": ("P23219", "COX-1 (acetaminophen target — partial)"),
    "ibuprofen": ("P23219", "COX-1 (ibuprofen target)"),
    "erlotinib": ("P00533", "EGFR (erlotinib target)"),
    "imatinib": ("P00519", "ABL1 (imatinib target)"),
}


def resolve_uniprot(target_text: str | None) -> tuple[str, str] | None:
    if not target_text:
        return None
    # Normalize: strip parens, lowercase, also try just the drug stem.
    import re as _re
    raw = target_text.lower()
    stripped = _re.sub(r"\s*\([^)]*\)\s*", " ", raw).strip()
    candidates = [raw, stripped]
    # Also try first word (e.g. 'dabigatran' from 'dabigatran (pradaxa)')
    if " " in stripped:
        candidates.append(stripped.split()[0])
    for c in candidates:
        for key, (uniprot, label) in TARGET_UNIPROT.items():
            if key in c:
                return uniprot, label
    return None


async def fetch_prediction(uniprot: str) -> dict[str, Any] | None:
    """EBI AlphaFold DB prediction metadata."""
    url = f"https://alphafold.ebi.ac.uk/api/prediction/{uniprot}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url)
            if r.status_code == 200:
                data = r.json()
                return data[0] if isinstance(data, list) and data else data
    except Exception as e:  # noqa: BLE001
        log.warning("alphafold fetch %s failed: %s", uniprot, e)
    return None


def pdb_url(uniprot: str, version: int = 4) -> str:
    return f"https://alphafold.ebi.ac.uk/files/AF-{uniprot}-F1-model_v{version}.pdb"


async def lookup_for_target(target_text: str | None) -> dict[str, Any] | None:
    """One-shot: target name string → AlphaFold prediction + downloadable PDB URL."""
    resolved = resolve_uniprot(target_text)
    if not resolved:
        return None
    uniprot, label = resolved
    pred = await fetch_prediction(uniprot)
    version = int((pred or {}).get("latestVersion") or 4)
    out: dict[str, Any] = {
        "uniprot": uniprot,
        "label": label,
        "pdb_url": pdb_url(uniprot, version=version),
        "viewer_url": f"https://alphafold.ebi.ac.uk/entry/{uniprot}",
        "source": "alphafold-ebi",
    }
    if pred:
        out.update(
            {
                "organism": pred.get("organismScientificName"),
                "gene": pred.get("gene"),
                "description": pred.get("uniprotDescription"),
                "sequence_length": pred.get("sequenceLength") or pred.get("uniprotEnd"),
                "version": pred.get("latestVersion"),
                "confidence_summary": pred.get("globalMetricValue"),  # mean pLDDT if present
            }
        )
    return out
