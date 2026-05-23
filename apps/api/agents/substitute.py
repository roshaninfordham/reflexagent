"""Substitute — protein-similarity ranked therapeutic alternatives.

When a drug is recalled, this agent:
1. Identifies the drug's target protein (fixture, fallback to LLM lookup).
2. Asks the reasoning engine for 3 therapeutic alternatives + their targets.
3. Runs NVIDIA BioNeMo ESM2-650M on the recalled target AND each candidate
   target, mean-pools to 1280-d vectors, and ranks alternatives by cosine
   similarity to the recalled target.

Output is a structured Substitutes object the UI renders as a "Therapeutic
alternatives" panel inside the published brief.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from apps.api.schemas import NormalizedRecall, SubstituteCandidate, Substitutes
from apps.api.tools.biology import (
    BiologyUnavailable,
    cosine_similarity,
    esm2_embed,
    known_target,
)
from apps.api.tools.reasoning import ReasoningUnavailable, reason_json
from apps.api.tools.trace import trace_span

log = logging.getLogger(__name__)


class _AltSuggestion(BaseModel):
    drug_name: str
    drug_class: str = ""
    target_protein: str = ""
    rationale: str = ""


class _AltList(BaseModel):
    alternatives: list[_AltSuggestion] = Field(default_factory=list)
    target_protein: str = ""


SYSTEM = """You are a clinical pharmacology assistant.

Given a recalled drug and the recall reason, output JSON with:
- target_protein: the recalled drug's primary molecular target (gene symbol +
  common name)
- alternatives: 2-3 approved therapeutic alternatives. For each: drug_name
  (INN), drug_class, target_protein (gene symbol + common name), rationale
  (≤25 words, why this is a sensible substitute given the recall reason).

Pick alternatives with a comparable indication. Be terse, no hedging."""


async def run(workflow_id: UUID, normalized: NormalizedRecall, reason_for_recall: str | None = None) -> Substitutes:
    drug = normalized.normalized_drug
    async with trace_span(
        workflow_id,
        agent="substitute",
        target="bionemo",
        label=f"Substitute candidates for {drug}",
    ) as span:
        span.set_input({"drug": drug})

        result = Substitutes(recalled_drug=drug)

        # Step 1: LLM suggests target + alternatives.
        try:
            alt = await reason_json(
                SYSTEM,
                user=(
                    f"Recalled drug: {drug}\n"
                    f"Manufacturer: {normalized.manufacturer or 'unspecified'}\n"
                    f"Reason for recall: {reason_for_recall or normalized.reason or 'unspecified'}"
                ),
                schema=_AltList,
                max_tokens=900,
            )
        except (ReasoningUnavailable, Exception) as e:  # noqa: BLE001
            log.warning("substitute LLM fallback (%s); using fixture", e)
            alt = _AltList(target_protein="(unknown — fixture fallback)", alternatives=[])

        # Anchor target sequence: fixture first → dynamic UniProt fallback so
        # any drug whose target the LLM identifies gets a real anchor.
        from apps.api.tools.biology import resolve_target_sequence
        recalled_target_info = known_target(drug)
        recalled_target_name = (
            (recalled_target_info or {}).get("target") or alt.target_protein or "unknown"
        )
        recalled_seq = (recalled_target_info or {}).get("sequence")
        if not recalled_seq:
            try:
                dyn = await resolve_target_sequence(alt.target_protein or drug)
                if dyn:
                    recalled_seq = dyn["sequence"]
                    if recalled_target_name in ("unknown", ""):
                        recalled_target_name = dyn["target"]
            except Exception as e:  # noqa: BLE001
                log.debug("anchor sequence fallback failed: %s", e)

        result.recalled_target = recalled_target_name

        # If we have no sequence and no LLM alternatives, exit gracefully.
        if not recalled_seq and not alt.alternatives:
            span.set_output(result.model_dump(mode="json"))
            return result

        # Step 2: Build candidate list. Try fixture first, then resolve via
        # UniProt+AlphaFold mapping so any LLM-identified target gets a real
        # sequence (and therefore a real ESM2 similarity instead of n/a).
        from apps.api.tools.biology import resolve_target_sequence
        candidates: list[dict[str, Any]] = []
        for a in alt.alternatives[:3]:
            fx = known_target(a.drug_name)
            seq = (fx or {}).get("sequence")
            target = a.target_protein or (fx or {}).get("target", "")
            if not seq:
                try:
                    dyn = await resolve_target_sequence(target or a.drug_name)
                    if dyn:
                        seq = dyn["sequence"]
                        if not target:
                            target = dyn["target"]
                except Exception as e:  # noqa: BLE001
                    log.debug("dynamic UniProt sequence for %s failed: %s", a.drug_name, e)
            candidates.append(
                {
                    "drug_name": a.drug_name,
                    "drug_class": a.drug_class,
                    "target_protein": target,
                    "rationale": a.rationale,
                    "sequence": seq,
                }
            )

        # Step 3: Embed every available sequence in parallel.
        seq_pairs = []
        if recalled_seq:
            seq_pairs.append(("__anchor__", recalled_seq))
        for c in candidates:
            if c.get("sequence"):
                seq_pairs.append((c["drug_name"], c["sequence"]))

        embeddings: dict[str, list[float]] = {}
        if seq_pairs:
            try:
                vecs = await asyncio.gather(
                    *[esm2_embed(seq, label=name) for name, seq in seq_pairs],
                    return_exceptions=True,
                )
                for (name, _), v in zip(seq_pairs, vecs):
                    if isinstance(v, list):
                        embeddings[name] = v
                    else:
                        log.warning("esm2_embed for %s failed: %s", name, v)
            except BiologyUnavailable as e:
                log.warning("BioNeMo unavailable, skipping embeddings: %s", e)

        anchor = embeddings.get("__anchor__")
        result.embedding_dim = len(anchor) if anchor else 0

        # Step 4: Score candidates by similarity to anchor (when available).
        scored: list[SubstituteCandidate] = []
        for c in candidates:
            sim = 0.0
            if anchor and c["drug_name"] in embeddings:
                sim = cosine_similarity(anchor, embeddings[c["drug_name"]])
            scored.append(
                SubstituteCandidate(
                    drug_name=c["drug_name"],
                    drug_class=c["drug_class"],
                    target_protein=c["target_protein"],
                    target_similarity=round(sim, 4),
                    rationale=c["rationale"],
                )
            )

        # Sort by similarity descending so the closest target is first.
        scored.sort(key=lambda s: s.target_similarity, reverse=True)
        result.candidates = scored
        result.notes = (
            f"Anchored on {recalled_target_name}; "
            f"embedded {len(embeddings)} proteins via NVIDIA BioNeMo ESM2-650M."
        )
        span.set_output(
            {
                "candidate_count": len(scored),
                "best_similarity": scored[0].target_similarity if scored else 0,
                "embedded": len(embeddings),
            }
        )
        return result
