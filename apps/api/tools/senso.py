"""Senso publisher — pushes verified briefs to the cited.md surface.

Per https://docs.senso.ai — we POST a content item to the org. On failure we
fall back to writing the brief to docs/cited/<slug>.md and committing+pushing
to git so the URL still resolves (GitHub raw / GitHub Pages).
"""
from __future__ import annotations

import logging
import re
import subprocess
from pathlib import Path
from typing import Any

import httpx

from apps.api.settings import get_settings

log = logging.getLogger(__name__)

CITED_DIR = Path(__file__).resolve().parent.parent.parent.parent / "docs" / "cited"
GITHUB_RAW_BASE = "https://raw.githubusercontent.com/roshaninfordham/reflexagent/main/docs/cited"


def _slugify(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:80]


async def publish_brief(
    *,
    title: str,
    slug: str,
    body_md: str,
    metadata: dict[str, Any] | None = None,
) -> tuple[str, bool]:
    """Returns (url, fallback_used)."""
    s = get_settings()
    payload = {
        "title": title,
        "slug": slug,
        "body_md": body_md,
        "metadata": metadata or {},
        "publish_target": s.senso_publish_target,
    }

    if s.senso_api_key:
        for endpoint in ("/v1/publish", "/v1/content", "/v1/citeables"):
            url = f"{s.senso_base_url.rstrip('/')}{endpoint}"
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    r = await client.post(
                        url,
                        json=payload,
                        headers={
                            "Authorization": f"Bearer {s.senso_api_key}",
                            "Content-Type": "application/json",
                        },
                    )
                if r.status_code in (200, 201):
                    data = r.json()
                    public_url = (
                        data.get("public_url")
                        or data.get("url")
                        or data.get("permalink")
                        or data.get("data", {}).get("public_url")
                    )
                    if public_url:
                        return public_url, False
            except Exception as e:  # noqa: BLE001
                log.warning("senso publish via %s failed: %s", endpoint, e)
                continue

    # Fallback: write to docs/cited/ and commit+push so the URL resolves.
    return _git_fallback(slug=slug, title=title, body_md=body_md), True


def _git_fallback(*, slug: str, title: str, body_md: str) -> str:
    CITED_DIR.mkdir(parents=True, exist_ok=True)
    path = CITED_DIR / f"{_slugify(slug)}.md"
    path.write_text(body_md)

    repo_root = CITED_DIR.parent.parent
    try:
        subprocess.run(
            ["git", "-C", str(repo_root), "add", str(path)],
            check=True,
            capture_output=True,
        )
        subprocess.run(
            [
                "git",
                "-C",
                str(repo_root),
                "commit",
                "-m",
                f"cited: publish {title}",
            ],
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "-C", str(repo_root), "push"],
            check=False,
            capture_output=True,
        )
    except subprocess.CalledProcessError as e:
        log.warning("git fallback publish failed: %s", e.stderr.decode() if e.stderr else e)

    return f"{GITHUB_RAW_BASE}/{path.name}"


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
    """Render the canonical brief markdown."""
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
