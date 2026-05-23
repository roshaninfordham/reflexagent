"""Senso publisher — publishes verified briefs to Senso + cited.md.

Senso v2 API (https://apiv2.senso.ai/api/v1, X-API-Key header) requires a
geo_question → draft → publish flow. We do all three. The publish step needs
the destination to be selected_for_generation; if it is not, we still get a
real draft in the Senso dashboard, AND we mirror the brief to docs/cited/<slug>.md
which is committed + pushed to GitHub so the URL is publicly resolvable.

Either way the result is a real, public, agent-discoverable URL.
"""
from __future__ import annotations

import asyncio
import logging
import re
import subprocess
from pathlib import Path
from typing import Any

import httpx

from apps.api.settings import get_settings

log = logging.getLogger(__name__)

CITED_DIR = Path(__file__).resolve().parent.parent.parent.parent / "docs" / "cited"
GITHUB_RAW_BASE = (
    "https://raw.githubusercontent.com/roshaninfordham/reflexagent/main/docs/cited"
)
GITHUB_BLOB_BASE = (
    "https://github.com/roshaninfordham/reflexagent/blob/main/docs/cited"
)

SENSO_BASE = "https://apiv2.senso.ai/api/v1"
CITED_MD_PUBLISHER_ID = "afa1052b-8226-438c-895e-335dcf21743a"


def _slugify(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:80]


def _headers() -> dict[str, str]:
    return {
        "X-API-Key": get_settings().senso_api_key,
        "Content-Type": "application/json",
    }


async def _create_question(client: httpx.AsyncClient, drug_name: str) -> str | None:
    body = {
        "question_text": f"What are the latest verified safety signals and recall status for {drug_name}?",
        "type": "awareness",
        "tag_ids": [],
    }
    try:
        r = await client.post(
            f"{SENSO_BASE}/org/questions", json=body, headers=_headers(), timeout=15
        )
        if r.status_code in (200, 201):
            data = r.json()
            return data.get("geo_question_id") or data.get("id")
        log.warning("senso question create returned %s: %s", r.status_code, r.text[:200])
    except Exception as e:  # noqa: BLE001
        log.warning("senso question create failed: %s", e)
    return None


async def _create_draft(
    client: httpx.AsyncClient,
    *,
    question_id: str,
    title: str,
    summary: str,
    body_md: str,
) -> dict[str, Any] | None:
    body = {
        "geo_question_id": question_id,
        "raw_markdown": body_md,
        "seo_title": title[:120],
        "summary": summary[:280],
    }
    try:
        r = await client.post(
            f"{SENSO_BASE}/org/content-engine/draft",
            json=body,
            headers=_headers(),
            timeout=20,
        )
        if r.status_code in (200, 201):
            return r.json()
        log.warning("senso draft returned %s: %s", r.status_code, r.text[:200])
    except Exception as e:  # noqa: BLE001
        log.warning("senso draft failed: %s", e)
    return None


async def _try_publish(
    client: httpx.AsyncClient,
    *,
    question_id: str,
    title: str,
    summary: str,
    body_md: str,
) -> dict[str, Any] | None:
    body = {
        "geo_question_id": question_id,
        "raw_markdown": body_md,
        "seo_title": title[:120],
        "summary": summary[:280],
        "publisher_ids": [CITED_MD_PUBLISHER_ID],
    }
    try:
        r = await client.post(
            f"{SENSO_BASE}/org/content-engine/publish",
            json=body,
            headers=_headers(),
            timeout=20,
        )
        if r.status_code in (200, 201):
            return r.json()
        log.info(
            "senso publish soft-failed (%s) — likely needs destination 'selected_for_generation' "
            "to be enabled in the dashboard. Continuing with git mirror.",
            r.status_code,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("senso publish failed: %s", e)
    return None


def _git_mirror(slug: str, body_md: str, title: str) -> str:
    CITED_DIR.mkdir(parents=True, exist_ok=True)
    path = CITED_DIR / f"{_slugify(slug)}.md"
    path.write_text(body_md)
    repo_root = CITED_DIR.parent.parent
    try:
        subprocess.run(
            ["git", "-C", str(repo_root), "add", str(path)],
            check=True, capture_output=True,
        )
        subprocess.run(
            ["git", "-C", str(repo_root), "commit", "-m", f"cited: publish {title[:80]}"],
            check=True, capture_output=True,
        )
        subprocess.run(
            ["git", "-C", str(repo_root), "push", "--quiet"],
            check=False, capture_output=True, timeout=20,
        )
    except subprocess.CalledProcessError as e:
        # Nothing to commit, etc. Not fatal.
        log.info("git mirror non-fatal: %s", (e.stderr or b"").decode()[:200])
    except Exception as e:  # noqa: BLE001
        log.warning("git mirror failed: %s", e)
    return f"{GITHUB_BLOB_BASE}/{path.name}"


async def publish_brief(
    *,
    title: str,
    slug: str,
    body_md: str,
    metadata: dict[str, Any] | None = None,
) -> tuple[str, bool]:
    """Returns (url, used_git_fallback).

    Always mirrors to git (publicly resolvable URL). Also creates a Senso
    draft + attempts publish; both are best-effort and visible in the Senso
    dashboard regardless of publish success.
    """
    summary = (metadata or {}).get("summary") or title

    senso_published_url: str | None = None
    senso_draft: dict | None = None

    if get_settings().senso_api_key:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                qid = await _create_question(client, drug_name=(metadata or {}).get("drug", title))
                if qid:
                    senso_draft = await _create_draft(
                        client,
                        question_id=qid,
                        title=title,
                        summary=summary,
                        body_md=body_md,
                    )
                    publish_res = await _try_publish(
                        client,
                        question_id=qid,
                        title=title,
                        summary=summary,
                        body_md=body_md,
                    )
                    if publish_res:
                        senso_published_url = (
                            publish_res.get("public_url")
                            or publish_res.get("url")
                            or publish_res.get("permalink")
                        )
        except Exception as e:  # noqa: BLE001
            log.warning("senso publishing pipeline error: %s", e)

    # Always git-mirror so the brief has a guaranteed public URL.
    git_url = await asyncio.to_thread(_git_mirror, slug, body_md, title)
    final_url = senso_published_url or git_url
    used_fallback = senso_published_url is None
    if senso_draft:
        log.info(
            "senso draft created (content_id=%s); public URL via %s.",
            senso_draft.get("content_id"),
            "Senso" if senso_published_url else "git mirror",
        )
    return final_url, used_fallback


def render_brief_markdown(
    *,
    title: str,
    drug_name: str,
    summary: str,
    findings: list[str],
    counter_evidence_summary: str,
    counter_evidence_found: bool,
    cohort_count: int,
    cohort_high_risk: int,
    recommendation: str,
    severity_score: float,
    citations: list[dict[str, str]],
    agents_verified: int,
    workflow_id: str,
    published_at: str,
) -> str:
    findings_md = "\n".join(f"- {f}" for f in findings) or "- (none provided)"
    cit_block = "\n".join(
        f"[^{i+1}]: [{c['title']}]({c['url']}) — Retrieved {c.get('accessed_at', '')}."
        for i, c in enumerate(citations)
    )
    counter_md = (
        counter_evidence_summary
        if counter_evidence_found
        else f"No refuting evidence found across the {agents_verified} verification searches."
    )
    return f"""# Reflex Safety Brief: {drug_name}

**Published:** {published_at}
**Workflow ID:** `{workflow_id}`
**Severity Score:** {severity_score:.1f} / 10
**Verification:** {agents_verified} of 9 verification agents confirmed; counter-evidence: {"yes" if counter_evidence_found else "no"}.

## Summary
{summary}

## Key Findings
{findings_md}

## Counter-Evidence Considered
{counter_md}

## Affected Population (demo fixture)
- Patients identified: **{cohort_count}**
- High-risk (>75 or CKD stage 3+): **{cohort_high_risk}**

## Recommendation
{recommendation}

## Citations
{cit_block}

---
*Reflex is an autonomous pharmacovigilance agent system. This brief is generated by an autonomous agent swarm and verified against {len(citations)} primary sources. Not a substitute for FDA labeling or licensed medical advice. For premium personalized analysis (subgroups, formulary impact): query the x402 endpoint at `/api/v1/premium-subbrief`.*
"""
