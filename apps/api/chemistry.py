"""Chemistry intelligence layer — PubChem REST + RDKit local generation.

Open-source stack:
  - PubChem PUG REST (public, no API key): name → CID, properties, SMILES, 3D conformer
  - RDKit (BSD-3): local SMILES parsing, 2D depiction (SVG), descriptor computation,
    novel-structure rendering when PubChem has no record

Used for real-time molecule structure generation in the workflow + brief pages.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any
from urllib.parse import quote

import httpx

log = logging.getLogger(__name__)

PUBCHEM = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"


async def _get_json(url: str) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url, headers={"Accept": "application/json"})
        if r.status_code == 200:
            return r.json()
    except Exception as e:  # noqa: BLE001
        log.debug("pubchem fetch %s failed: %s", url, e)
    return None


def normalize_drug_query(name: str) -> str:
    """Strip parenthetical brand/INN suffixes before searching external APIs.
       'Dabigatran (Pradaxa)' → 'dabigatran'
       'Atorvastatin Calcium Tablets, 40 mg' → 'atorvastatin'
    """
    if not name:
        return ""
    import re as _re
    s = _re.sub(r"\s*\([^)]*\)\s*", " ", name)  # drop parentheticals
    s = s.split(",", 1)[0]                        # drop after first comma
    # Drop common formulation suffixes
    for stop in (" Tablets", " Capsules", " Injection", " HCl", " Hydrochloride", " Calcium", " Sodium", " ER", " Extended-Release"):
        idx = s.lower().find(stop.lower())
        if idx > 3:
            s = s[:idx]
            break
    return s.strip().lower()


async def lookup_compound(name: str) -> dict[str, Any]:
    """Resolve a drug name to PubChem CID + canonical properties.

    Returns: {cid, name, iupac, smiles, inchi, inchikey, formula, mw, xlogp,
              h_donor, h_acceptor, rotatable, source, structure_2d_url,
              structure_3d_url, pubchem_url}
    """
    out: dict[str, Any] = {"name": name, "found": False}
    if not name:
        return out
    norm = normalize_drug_query(name) or name
    q = quote(norm.strip())
    # 1. Name → CID
    cid_doc = await _get_json(f"{PUBCHEM}/compound/name/{q}/cids/JSON")
    cids = ((cid_doc or {}).get("IdentifierList") or {}).get("CID") or []
    if not cids:
        return out
    cid = cids[0]
    out["cid"] = cid
    out["found"] = True
    out["structure_2d_url"] = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/PNG?image_size=large"
    out["structure_3d_url"] = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/record/SDF?record_type=3d"
    out["pubchem_url"] = f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}"
    # 2. Properties — PubChem renamed CanonicalSMILES → SMILES + InChI/InChIKey
    # now live on dedicated endpoints. Try the modern bundle first.
    props_doc = await _get_json(
        f"{PUBCHEM}/compound/cid/{cid}/property/"
        "IUPACName,SMILES,IsomericSMILES,MolecularFormula,MolecularWeight,"
        "XLogP,HBondDonorCount,HBondAcceptorCount,RotatableBondCount,TPSA/JSON"
    )
    props = ((props_doc or {}).get("PropertyTable") or {}).get("Properties") or [{}]
    p = props[0] if props else {}
    smiles = p.get("SMILES") or p.get("IsomericSMILES") or p.get("CanonicalSMILES")

    # InChI + InChIKey via their dedicated endpoints (more reliable)
    inchi_doc = await _get_json(f"{PUBCHEM}/compound/cid/{cid}/property/InChI,InChIKey/JSON")
    inchi_p = ((inchi_doc or {}).get("PropertyTable") or {}).get("Properties") or [{}]
    ip = inchi_p[0] if inchi_p else {}

    out.update(
        {
            "iupac": p.get("IUPACName"),
            "smiles": smiles,
            "inchi": ip.get("InChI"),
            "inchikey": ip.get("InChIKey"),
            "formula": p.get("MolecularFormula"),
            "mw": p.get("MolecularWeight"),
            "xlogp": p.get("XLogP"),
            "h_donor": p.get("HBondDonorCount"),
            "h_acceptor": p.get("HBondAcceptorCount"),
            "rotatable": p.get("RotatableBondCount"),
            "tpsa_pubchem": p.get("TPSA"),
            "source": "pubchem",
        }
    )
    return out


def generate_2d_svg(smiles: str, width: int = 360, height: int = 280) -> str | None:
    """Use RDKit to render an SVG of a SMILES string. Works for novel/unknown
    compounds that aren't in PubChem (LLM-predicted structures, research molecules)."""
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem
        from rdkit.Chem.Draw import rdMolDraw2D

        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return None
        AllChem.Compute2DCoords(mol)
        drawer = rdMolDraw2D.MolDraw2DSVG(width, height)
        opts = drawer.drawOptions()
        opts.bondLineWidth = 2
        opts.padding = 0.06
        drawer.DrawMolecule(mol)
        drawer.FinishDrawing()
        return drawer.GetDrawingText()
    except Exception as e:  # noqa: BLE001
        log.warning("rdkit svg failed: %s", e)
        return None


def descriptors_from_smiles(smiles: str) -> dict[str, Any]:
    """Compute molecular descriptors locally via RDKit — runs without network."""
    try:
        from rdkit import Chem
        from rdkit.Chem import Descriptors, Lipinski, rdMolDescriptors

        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return {}
        return {
            "mw": round(Descriptors.MolWt(mol), 2),
            "logp": round(Descriptors.MolLogP(mol), 2),
            "h_donor": Lipinski.NumHDonors(mol),
            "h_acceptor": Lipinski.NumHAcceptors(mol),
            "rotatable": Lipinski.NumRotatableBonds(mol),
            "tpsa": round(Descriptors.TPSA(mol), 2),
            "heavy_atoms": mol.GetNumHeavyAtoms(),
            "rings": rdMolDescriptors.CalcNumRings(mol),
            "lipinski_ro5_violations": _ro5_violations(mol),
            "source": "rdkit-local",
        }
    except Exception as e:  # noqa: BLE001
        log.warning("rdkit descriptors failed: %s", e)
        return {}


def _ro5_violations(mol) -> int:
    """Lipinski's Rule of Five — quick druglikeness check."""
    from rdkit.Chem import Descriptors, Lipinski
    v = 0
    if Descriptors.MolWt(mol) > 500: v += 1
    if Descriptors.MolLogP(mol) > 5: v += 1
    if Lipinski.NumHDonors(mol) > 5: v += 1
    if Lipinski.NumHAcceptors(mol) > 10: v += 1
    return v


async def full_dossier(name: str) -> dict[str, Any]:
    """Combined chemistry dossier: PubChem lookup + RDKit-computed local descriptors.

    This is what powers the workflow / brief 'Chemistry intelligence' panel.
    """
    compound = await lookup_compound(name)
    local_desc = {}
    if compound.get("smiles"):
        local_desc = descriptors_from_smiles(compound["smiles"])
        svg = generate_2d_svg(compound["smiles"])
        if svg:
            compound["structure_2d_svg"] = svg
    return {
        "compound": compound,
        "descriptors_local": local_desc,
    }
