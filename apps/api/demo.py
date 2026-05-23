"""Demo helpers: one-click launch + a generated sample recall image."""
from __future__ import annotations

import asyncio
import io
import logging
from datetime import datetime

from apps.api.orchestrator import list_recent, orchestrate
from apps.api.schemas import TriggerPayload

log = logging.getLogger(__name__)


DEMO_PAYLOAD = TriggerPayload(
    drug_name="Metformin HCl",
    manufacturer="Apotex Corp.",
    ndc="60505-2657-0",
    lot_numbers=["APX5523", "APX5524"],
    recall_class="II",
    reason=(
        "NDMA (N-nitrosodimethylamine) detected above the FDA interim "
        "acceptable intake limit of 96 ng/day. Probable human carcinogen. "
        "Voluntary recall, all U.S. distribution."
    ),
    source="manual",
    confidence=0.97,
    external_id=f"demo-launch-{datetime.utcnow().strftime('%H%M%S')}",
)


async def launch_curated_workflow() -> str:
    """Fire a curated metformin workflow and return its workflow_id once registered."""
    # Use a fresh payload each call so the orchestrator's identity check matches.
    payload = DEMO_PAYLOAD.model_copy(update={
        "external_id": f"demo-launch-{datetime.utcnow().strftime('%H%M%S%f')}"
    })
    asyncio.create_task(orchestrate(payload))
    for _ in range(60):
        await asyncio.sleep(0.05)
        for w in list_recent(20):
            if w.payload is payload:
                return str(w.workflow_id)
    return ""


def generate_sample_recall_image() -> bytes:
    """Render an 800x1100 PNG that looks like a faxed FDA recall notice."""
    from PIL import Image, ImageDraw, ImageFont

    W, H = 900, 1200
    img = Image.new("RGB", (W, H), color=(248, 248, 244))
    d = ImageDraw.Draw(img)

    # Try a few font paths so this works without bundling fonts.
    def _font(size: int, bold: bool = False):
        candidates = []
        if bold:
            candidates = [
                "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                "/Library/Fonts/Arial Bold.ttf",
            ]
        else:
            candidates = [
                "/System/Library/Fonts/Supplemental/Arial.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/Library/Fonts/Arial.ttf",
            ]
        for c in candidates:
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                continue
        return ImageFont.load_default()

    f_title = _font(34, bold=True)
    f_h = _font(20, bold=True)
    f_b = _font(18)
    f_s = _font(14)

    # Header bar
    d.rectangle([(0, 0), (W, 80)], fill=(20, 20, 20))
    d.text((40, 28), "URGENT DRUG RECALL — VOLUNTARY", font=f_title, fill=(255, 255, 255))

    # Class badge
    d.rectangle([(40, 100), (180, 140)], outline=(180, 0, 0), width=3)
    d.text((75, 109), "CLASS II", font=f_h, fill=(180, 0, 0))

    # From block
    y = 170
    d.text((40, y), "FROM:", font=f_h, fill=(0, 0, 0)); y += 28
    for line in [
        "Apotex Corp. Pharmacovigilance",
        "150 Signet Drive",
        "Toronto, ON  M9L 1T9",
        "Tel: 1-800-667-4708",
    ]:
        d.text((100, y), line, font=f_b, fill=(40, 40, 40)); y += 24

    y += 16
    d.text((40, y), "DATE:", font=f_h, fill=(0, 0, 0))
    d.text((140, y), datetime.utcnow().strftime("%d %B %Y"), font=f_b, fill=(40, 40, 40))
    y += 32
    d.text((40, y), "TO:", font=f_h, fill=(0, 0, 0))
    d.text((140, y), "Pharmacy Director / Pharmacist in Charge", font=f_b, fill=(40, 40, 40))
    y += 40

    # Product block
    d.rectangle([(40, y), (W - 40, y + 170)], outline=(0, 0, 0), width=2)
    yy = y + 14
    d.text((60, yy), "PRODUCT:", font=f_h, fill=(0, 0, 0))
    d.text((220, yy), "Metformin HCl Extended-Release Tablets, 500 mg", font=f_b, fill=(0, 0, 0)); yy += 30
    d.text((60, yy), "NDC:", font=f_h, fill=(0, 0, 0))
    d.text((220, yy), "60505-2657-0", font=f_b, fill=(0, 0, 0)); yy += 30
    d.text((60, yy), "LOTS:", font=f_h, fill=(0, 0, 0))
    d.text((220, yy), "APX5523, APX5524", font=f_b, fill=(0, 0, 0)); yy += 30
    d.text((60, yy), "EXP:", font=f_h, fill=(0, 0, 0))
    d.text((220, yy), "OCT 2026, NOV 2026", font=f_b, fill=(0, 0, 0)); yy += 30

    y += 200
    d.text((40, y), "REASON FOR RECALL:", font=f_h, fill=(0, 0, 0)); y += 28
    for line in [
        "N-nitrosodimethylamine (NDMA) levels detected above the FDA",
        "interim acceptable intake limit of 96 ng/day.",
        "Probable human carcinogen.",
    ]:
        d.text((40, y), line, font=f_b, fill=(40, 40, 40)); y += 24

    y += 16
    d.text((40, y), "ACTION REQUIRED:", font=f_h, fill=(0, 0, 0)); y += 28
    for line in [
        "1. Cease distribution and sale immediately.",
        "2. Quarantine all unsold inventory of the affected lots.",
        "3. Identify and notify affected patients per institutional SOPs.",
        "4. Return product to Apotex per the enclosed return instructions.",
    ]:
        d.text((40, y), line, font=f_b, fill=(40, 40, 40)); y += 24

    y += 32
    d.text((40, y), "CONTACT:", font=f_h, fill=(0, 0, 0))
    d.text((140, y), "Apotex Pharmacovigilance Hotline: 1-800-667-4708 ext. 2", font=f_b, fill=(40, 40, 40))
    y += 26
    d.text((140, y), "recall.usa@apotex.com", font=f_b, fill=(40, 40, 40))
    y += 40
    d.text((40, y), "This recall is being conducted with the knowledge of the U.S.", font=f_s, fill=(80, 80, 80)); y += 18
    d.text((40, y), "Food and Drug Administration.", font=f_s, fill=(80, 80, 80))

    # Footer fax line
    d.text((40, H - 40), "  *** TRANSMITTED VIA FACSIMILE ***", font=f_s, fill=(160, 160, 160))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
