"""NVIDIA BioNeMo ESM2-650M client + helpers.

Produces protein embeddings from amino-acid sequences. We use these in the
Substitute agent to rank therapeutic alternatives by how close their target
proteins are to the recalled drug's target.

Endpoint accepts JSON: {"sequences": ["MAKQK..."], "format": "npz"}.
Returns a zip/npz of {label: ndarray(L, 1280)} per sequence. We mean-pool
across residues to get one 1280-d vector per protein.
"""
from __future__ import annotations

import io
import logging
import math
import os
import tempfile
import zipfile
from functools import lru_cache
from typing import Sequence

import httpx
import numpy as np

from apps.api.settings import get_settings

log = logging.getLogger(__name__)


class BiologyUnavailable(RuntimeError):
    """Raised when BioNeMo isn't configured."""


def _have_key() -> bool:
    return bool(get_settings().nvidia_biology_api_key)


async def esm2_embed(sequence: str, label: str = "seq") -> list[float]:
    """Return a 1280-d mean-pooled ESM2-650M embedding for one protein."""
    if not _have_key():
        raise BiologyUnavailable("NVIDIA_BIOLOGY_API_KEY not configured")
    s = get_settings()
    payload = {
        "sequences": [sequence],
        "format": "npz",
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {s.nvidia_biology_api_key}",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(s.nvidia_biology_url, json=payload, headers=headers)
        r.raise_for_status()
        ct = r.headers.get("Content-Type", "")
        body = r.content
    return _parse_embedding(body, ct, label)


def _parse_embedding(body: bytes, content_type: str, label: str) -> list[float]:
    """ESM2 can return zip (with one or more npz inside) or a single npz directly."""
    # Zip wrapper.
    if content_type.startswith("application/zip") or body[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(body)) as zf:
            for name in zf.namelist():
                if name.endswith(".npz"):
                    with zf.open(name) as f:
                        return _embed_from_npz(f.read(), label)
                if name.endswith(".npy"):
                    with zf.open(name) as f:
                        arr = np.load(io.BytesIO(f.read()))
                        return _meanpool(arr).tolist()
        raise RuntimeError("zip contained no npz/npy")
    # Raw npz.
    return _embed_from_npz(body, label)


def _embed_from_npz(data: bytes, label: str) -> list[float]:
    with tempfile.NamedTemporaryFile(suffix=".npz") as tf:
        tf.write(data)
        tf.flush()
        npz = np.load(tf.name, allow_pickle=True)
        # Pick the first available array.
        keys = list(npz.keys())
        if not keys:
            raise RuntimeError("npz file empty")
        arr = npz[keys[0]]
    return _meanpool(arr).tolist()


def _meanpool(arr: np.ndarray) -> np.ndarray:
    if arr.ndim == 1:
        return arr.astype(np.float32)
    if arr.ndim == 2:
        return arr.mean(axis=0).astype(np.float32)
    # 3-d (batch, seq, hidden) — squeeze batch.
    if arr.ndim == 3:
        return arr[0].mean(axis=0).astype(np.float32)
    return np.asarray(arr).astype(np.float32).flatten()


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    av = np.asarray(a, dtype=np.float32)
    bv = np.asarray(b, dtype=np.float32)
    denom = (np.linalg.norm(av) * np.linalg.norm(bv)) or 1.0
    return float(np.dot(av, bv) / denom)


# ----- Fixture: known drug → target protein sequence -----
#
# Sequences are public UniProt canonical sequences (truncated to a representative
# window so requests stay small). For the demo we hard-code the most common
# diabetes / cardiometabolic recall targets; the agent gracefully falls back to
# an LLM-supplied sequence for anything not on this list.

PROTEIN_FIXTURE: dict[str, dict[str, str]] = {
    # AMPK alpha-1 catalytic subunit (UniProt Q13131, residues 1-300)
    "metformin": {
        "target": "PRKAA1 (AMP-activated protein kinase α1)",
        "sequence": (
            "MAEKQKHDGRVKIGHYILGDTLGVGTFGKVKVGKHELTGHKVAVKILNRQKIRSLDVVGKIRREIQNL"
            "KLFRHPHIIKLYQVISTPSDIFMVMEYVSGGELFDYICKNGRLDEKESRRLFQQILSAVDYCHRHMVV"
            "HRDLKPENVLLDAHMNAKIADFGLSNMMSDGEFLRTSCGSPNYAAPEVISGRLYAGPEVDIWSCGVIL"
            "YALLCGTLPFDDDHVPTLFKKICDGIFYTPQYLNPSVISLLKHMLQVDPMKRATIKDIREHEWFKQDL"
            "PSYLFPEDPSYDANVIDDEAVKEVCEKFECTESEVMNSLYSGDPQDQLAVAYHLIIDNRRIMNQASEF"
        ),
    },
    # Sulfonylurea receptor channel KCNJ11 (UniProt Q14654, partial)
    "glipizide": {
        "target": "KCNJ11 (ATP-sensitive K⁺ channel)",
        "sequence": (
            "MLSRKGIIPEEYVLTRLAEDPAEPRYRARQRRARFVSKKGNCNVAHKNIREQGRFLQDVFTTLVDLKW"
            "RWNLFIFILTYTVAWLFMASMWWVIAYTRGDLNKAHVGNYTPCVANVYNFPSAFLFFIETEATIGYGY"
            "RYITDKCPEGIILFLFQSILGSIVDAFLIGCMFIKMSQPKKRAETLMFSEHAVISMRDGKLTLMFRVG"
        ),
    },
    # DPP-4 dipeptidyl peptidase (UniProt P27487, partial)
    "sitagliptin": {
        "target": "DPP4 (Dipeptidyl peptidase-4)",
        "sequence": (
            "MKTPWKVLLGLLGAAALVTIITVPVVLLNKGTDDATADSRKTYTLTDYLKNTYRLKLYSLRWISDHEY"
            "LYKQENNILVFNAEYGNSSVFLENSTFDEFGHSINDYSISPDGQFILLEYNYVKQWRHSYTASYDIYD"
            "LNKRQLITEERIPNNTQWVTWSPVGHKLAYVWNNDIYVKIEPNLPSYRITWTGKEDIIYNGITDWVYE"
        ),
    },
    # GLP-1 receptor (UniProt P43220, partial)
    "semaglutide": {
        "target": "GLP1R (GLP-1 receptor)",
        "sequence": (
            "MAGAPGPLRLALLLLGMVGRAGPRPQGATVSLWETVQKWREYRRQCQRSLTEDPPPATDLFCNRTFDE"
            "YACWPDGEPGSFVNVSCPWYLPWASSVPQGHVYRFCTAEGLWLQKDNSSLPWRDLSECEESKRGERSS"
            "PEEQLLFLYIIYTVGYALSFSALVIASAILLGFRHLHCTRNYIHLNLFASFILRALSVFIKDAALKWM"
        ),
    },
    # SGLT2 sodium-glucose cotransporter (UniProt P31639, partial)
    "empagliflozin": {
        "target": "SLC5A2 (SGLT2)",
        "sequence": (
            "MEEHTEAGSAPEMGAQKALIDNPADILVIAAYFLLVIAVGLWSMCRTNRGTVGGYFLAGRSMVWWPIG"
            "ASLFASNIGSGHFVGLAGTGAASGLAVAGFEWNALVLVLILLGWLFLPFAEYLDAEMLRRRYTPLTPK"
            "EELKKAGYFTEEQHILGEELRAEELQLELLEAGYFKEFEISKVRKAFTEAVKLAVNRQPVNPS"
        ),
    },
    # HMG-CoA reductase (UniProt P04035, partial)
    "atorvastatin": {
        "target": "HMGCR (HMG-CoA reductase)",
        "sequence": (
            "MLSRLFRMHGLFVASHPWEVIVGTVTLTICMMSMNMFTGNNKICGWNYECPKFEEDVLSSDIIILTIT"
            "RCIAILYIYFQFQNLRQLGSKYILGIAGLFTIFSSFVFSTVVIHFLDKELTGLNEALPFFLLLIDLSR"
        ),
    },
    # Angiotensin II type 1 receptor (UniProt P30556, partial)
    "valsartan": {
        "target": "AGTR1 (Angiotensin II type 1 receptor)",
        "sequence": (
            "MILNSSTEDGIKRIQDDCPKAGRHNYIFVMIPTLYSIIFVVGIFGNSLVVIVIYFYMKLKTVASVFLL"
            "NLALADLCFLLTLPLWAVYTAMEYRWPFGNYLCKIASASVSFNLYASVFLLTCLSIDRYLAIVHPMKS"
        ),
    },
    # H2-receptor (UniProt P25021, partial)
    "ranitidine": {
        "target": "HRH2 (Histamine H2 receptor)",
        "sequence": (
            "MAPNGTASSFCLDSTACKITITVVLAVLILITVAGNVVVCLAVGLNRRLRNLTNCFIVSLAITDLLLG"
            "LLVLPFSAIYQLSCKWSFGKVFCNIYTSLDVMLCTASILNLFMISLDRYCAVMDPLRYPVLVTPVRVA"
        ),
    },
}


def known_target(drug_name: str) -> dict[str, str] | None:
    key = drug_name.lower().strip()
    for k, v in PROTEIN_FIXTURE.items():
        if k in key or key in k:
            return v
    return None
