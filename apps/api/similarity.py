"""RDKit Tanimoto fingerprint similarity over a curated corpus of approved drugs.

Open-source: RDKit (BSD-3) computes Morgan/ECFP fingerprints; Tanimoto
coefficient is the gold-standard 2D-structure similarity metric used across
cheminformatics. Corpus is curated from well-known approved drugs with their
canonical SMILES, covering ~25 of the most commonly recalled / referenced
small molecules.
"""
from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)

# Curated reference corpus. SMILES are canonical from PubChem.
# Keys are display names; values are (SMILES, drug_class).
DRUG_CORPUS: dict[str, tuple[str, str]] = {
    "Metformin": ("CN(C)C(=N)N=C(N)N", "Biguanide antihyperglycemic"),
    "Sitagliptin": ("C1CN2C(=NN=C2C(F)(F)F)CN1C(=O)C[C@@H](C(F)(F)F)N", "DPP-4 inhibitor"),
    "Glipizide": ("CC1=CN=C(C=N1)C(=O)NCCC2=CC=C(C=C2)S(=O)(=O)NC(=O)NC3CCCCC3", "Sulfonylurea"),
    "Glyburide": ("COC1=C(C=C(C=C1)Cl)C(=O)NCCC2=CC=C(C=C2)S(=O)(=O)NC(=O)NC3CCCCC3", "Sulfonylurea"),
    "Pioglitazone": ("CCC1=CN=C(C=C1)CCOC2=CC=C(C=C2)CC3C(=O)NC(=O)S3", "Thiazolidinedione"),
    "Repaglinide": ("CCC1=CC(=CC=C1OCC(=O)NC(CC2=CC=C(C=C2)CN3CCCCC3)C(=O)O)C(C)C", "Meglitinide"),
    "Empagliflozin": ("ClC1=CC(=C(C=C1)C[C@H]2[C@@H]([C@H]([C@@H]([C@H](O2)CO)O)O)O)C3=CC=C(C=C3)OC4CCOC4", "SGLT2 inhibitor"),
    "Atorvastatin": ("CC(C)C1=C(C(=C(N1CC[C@H](C[C@H](CC(=O)O)O)O)C2=CC=C(C=C2)F)C3=CC=CC=C3)C(=O)NC4=CC=CC=C4", "Statin"),
    "Simvastatin": ("CCC(C)(C)C(=O)O[C@H]1C[C@@H](C=C2[C@H]1[C@H]([C@H](C=C2)C)CC[C@@H]3C[C@H](CC(=O)O3)O)C", "Statin"),
    "Rosuvastatin": ("CC(C)C1=NC(=NC(=C1/C=C/[C@@H](C[C@@H](CC(=O)O)O)O)N(C)S(=O)(=O)C)C(C)C", "Statin"),
    "Valsartan": ("CCCCC(=O)N(CC1=CC=C(C=C1)C2=CC=CC=C2C3=NNN=N3)[C@@H](C(C)C)C(=O)O", "ARB"),
    "Losartan": ("CCCCC1=NC(=C(N1CC2=CC=C(C=C2)C3=CC=CC=C3C4=NNN=N4)CO)Cl", "ARB"),
    "Lisinopril": ("C1C[C@H](N(C1)C(=O)[C@H](CCCCN)N[C@@H](CCC2=CC=CC=C2)C(=O)O)C(=O)O", "ACE inhibitor"),
    "Amlodipine": ("CCOC(=O)C1=C(NC(=C(C1C2=CC=CC=C2Cl)C(=O)OC)C)COCCN", "Calcium channel blocker"),
    "Warfarin": ("CC(=O)CC(C1=CC=CC=C1)C2=C(C3=CC=CC=C3OC2=O)O", "Coumarin anticoagulant"),
    "Dabigatran": ("CN1C2=C(C=C(C=C2)C(=O)N(CCC(=O)O)C3=CC=NC=C3)N=C1NCC4=CC=C(C=C4)C(=N)N", "DTI anticoagulant"),
    "Apixaban": ("COC1=CC=C(C=C1)N2C3=CC=CC=C3C(=O)N2C4=CC=C(C=C4)N5CCC(=O)N(C5=O)C6=CC=CC=C6", "Factor Xa inhibitor"),
    "Rivaroxaban": ("ClC1=CC=C(S1)C(=O)NC[C@H]2CN(C(=O)O2)C3=CC=C(C=C3)N4CCOCC4=O", "Factor Xa inhibitor"),
    "Ranitidine": ("CN/C(=C\\[N+](=O)[O-])/NCCSCC1=CC=C(O1)CN(C)C", "H2 antagonist"),
    "Famotidine": ("C(CSCC1=CSC(=N1)N=C(N)N)C(=NS(=O)(=O)N)N", "H2 antagonist"),
    "Omeprazole": ("CC1=CN=C(C(=C1OC)C)CS(=O)C2=NC3=CC=C(C=C3N2)OC", "PPI"),
    "Acetaminophen": ("CC(=O)NC1=CC=C(C=C1)O", "Analgesic / antipyretic"),
    "Ibuprofen": ("CC(C)Cc1ccc(cc1)C(C)C(=O)O", "NSAID"),
    "Naproxen": ("CC(C1=CC2=CC=C(C=C2C=C1)OC)C(=O)O", "NSAID"),
    "Sertraline": ("CN[C@H]1CC[C@@H](C2=CC=CC=C12)C3=CC(=C(C=C3)Cl)Cl", "SSRI"),
    "Fluoxetine": ("CNCCC(C1=CC=CC=C1)OC2=CC=C(C=C2)C(F)(F)F", "SSRI"),
    "Erlotinib": ("COCCOC1=C(C=C2C(=C1)N=CN=C2NC3=CC=CC(=C3)C#C)OCCOC", "EGFR inhibitor"),
    "Imatinib": ("CC1=C(C=C(C=C1)NC(=O)C2=CC=C(C=C2)CN3CCN(CC3)C)NC4=NC=CC(=N4)C5=CN=CC=C5", "BCR-ABL inhibitor"),
}


def _morgan_fp(smiles: str):
    from rdkit import Chem
    from rdkit.Chem import AllChem
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    return AllChem.GetMorganFingerprintAsBitVect(mol, 2, nBits=1024)


def similar_to(query_smiles: str, top_k: int = 8) -> dict[str, Any]:
    """Return Tanimoto-ranked similar approved drugs from the curated corpus."""
    try:
        from rdkit import Chem
        from rdkit import DataStructs
    except Exception as e:  # noqa: BLE001
        return {"query_smiles": query_smiles, "matches": [], "error": str(e)}

    qfp = _morgan_fp(query_smiles)
    if qfp is None:
        return {"query_smiles": query_smiles, "matches": [], "error": "invalid SMILES"}

    scored = []
    for name, (smi, cls) in DRUG_CORPUS.items():
        rfp = _morgan_fp(smi)
        if rfp is None:
            continue
        sim = float(DataStructs.TanimotoSimilarity(qfp, rfp))
        scored.append({"drug": name, "drug_class": cls, "smiles": smi, "tanimoto": round(sim, 4)})
    scored.sort(key=lambda x: x["tanimoto"], reverse=True)
    return {
        "query_smiles": query_smiles,
        "corpus_size": len(DRUG_CORPUS),
        "method": "RDKit Morgan ECFP4 fingerprint · 1024 bits · Tanimoto coefficient",
        "matches": scored[:top_k],
    }


async def similar_to_drug(drug_name: str, top_k: int = 8) -> dict[str, Any]:
    """Convenience: resolve drug → SMILES via PubChem → run Tanimoto."""
    from apps.api import chemistry as chem
    compound = await chem.lookup_compound(drug_name)
    smiles = compound.get("smiles")
    if not smiles:
        return {"drug": drug_name, "found": False, "matches": []}
    res = similar_to(smiles, top_k=top_k)
    # Filter out the query drug itself if it matches a corpus entry by name
    nm = drug_name.lower()
    res["matches"] = [m for m in res["matches"] if nm not in m["drug"].lower()][:top_k]
    res.update({"drug": drug_name, "found": True, "compound_cid": compound.get("cid")})
    return res
