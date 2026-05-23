"""Demo helpers: one-click launch + generated sample recall images."""
from __future__ import annotations

import asyncio
import io
import logging
from datetime import datetime

from apps.api.orchestrator import list_recent, orchestrate
from apps.api.schemas import TriggerPayload

log = logging.getLogger(__name__)


SAMPLES = {
    "metformin": {
        "title": "Apotex metformin (NDMA)",
        "manufacturer": "Apotex Corp.",
        "address": "150 Signet Drive, Toronto, ON  M9L 1T9",
        "phone": "1-800-667-4708",
        "email": "recall.usa@apotex.com",
        "drug": "Metformin HCl Extended-Release Tablets, 500 mg",
        "ndc": "60505-2657-0",
        "lots": "APX5523, APX5524",
        "exp": "OCT 2026, NOV 2026",
        "klass": "II",
        "reason": [
            "N-nitrosodimethylamine (NDMA) levels detected above the FDA",
            "interim acceptable intake limit of 96 ng/day.",
            "Probable human carcinogen.",
        ],
    },
    "valsartan": {
        "title": "Teva valsartan (NDEA)",
        "manufacturer": "Teva Pharmaceuticals USA",
        "address": "400 Interpace Pkwy, Parsippany, NJ 07054",
        "phone": "1-888-838-2872",
        "email": "drugsafety@tevausa.com",
        "drug": "Valsartan Tablets, 80 mg",
        "ndc": "00093-7361-56",
        "lots": "TV2317, TV2318, TV2319",
        "exp": "AUG 2026, SEP 2026",
        "klass": "II",
        "reason": [
            "N-nitrosodiethylamine (NDEA) detected above the FDA acceptable",
            "daily intake limit. Probable human carcinogen identified in the",
            "active pharmaceutical ingredient supply chain.",
        ],
    },
    "atorvastatin": {
        "title": "Pfizer atorvastatin (subpotency)",
        "manufacturer": "Pfizer Inc.",
        "address": "235 East 42nd Street, New York, NY 10017",
        "phone": "1-800-438-1985",
        "email": "qualityrecall@pfizer.com",
        "drug": "Atorvastatin Calcium Tablets, 40 mg",
        "ndc": "00071-0157-23",
        "lots": "ATV9012, ATV9013",
        "exp": "JAN 2027",
        "klass": "III",
        "reason": [
            "Out-of-specification dissolution test results detected during",
            "quarterly stability monitoring. Subpotent product may not deliver",
            "expected LDL-lowering effect.",
        ],
    },
    "dabigatran": {
        "title": "Boehringer dabigatran (sealing defect)",
        "manufacturer": "Boehringer Ingelheim",
        "address": "900 Ridgebury Road, Ridgefield, CT 06877",
        "phone": "1-800-243-0127",
        "email": "drugsafety.us@boehringer-ingelheim.com",
        "drug": "Dabigatran Etexilate Capsules, 150 mg",
        "ndc": "00597-0149-54",
        "lots": "BI4421",
        "exp": "MAR 2027",
        "klass": "II",
        "reason": [
            "Bottle sealing defect identified during routine quality audit.",
            "Moisture ingress may degrade active pharmaceutical ingredient,",
            "reducing anticoagulant efficacy. Risk of breakthrough thrombosis.",
        ],
    },
    "ranitidine": {
        "title": "Sanofi ranitidine (NDMA, broad recall)",
        "manufacturer": "Sanofi U.S. Services Inc.",
        "address": "55 Corporate Drive, Bridgewater, NJ 08807",
        "phone": "1-800-981-2491",
        "email": "us.qualityrecall@sanofi.com",
        "drug": "Ranitidine HCl Tablets, 150 mg (Zantac)",
        "ndc": "00024-5557-13",
        "lots": "ALL LOTS — full market withdrawal",
        "exp": "ALL EXP DATES",
        "klass": "II",
        "reason": [
            "Sustained N-nitrosodimethylamine (NDMA) generation observed",
            "during product storage at elevated temperatures.",
            "FDA recommends discontinuation of all ranitidine products.",
        ],
    },
}


def _payload_for(slug: str) -> TriggerPayload:
    s = SAMPLES[slug]
    return TriggerPayload(
        drug_name=s["drug"].split(",")[0].strip(),
        manufacturer=s["manufacturer"],
        ndc=s["ndc"],
        lot_numbers=[lot.strip() for lot in s["lots"].split(",") if lot.strip().upper() != "ALL LOTS"][:6] or [],
        recall_class=s["klass"],
        reason=" ".join(s["reason"]),
        source="manual",
        confidence=0.97,
        external_id=f"demo-{slug}-{datetime.utcnow().strftime('%H%M%S%f')}",
    )


# Default curated launch = metformin (most familiar story)
DEMO_PAYLOAD = _payload_for("metformin")


async def launch_curated_workflow(slug: str = "metformin") -> str:
    """Fire a curated recall workflow and return its workflow_id once registered."""
    if slug not in SAMPLES:
        slug = "metformin"
    payload = _payload_for(slug)
    asyncio.create_task(orchestrate(payload))
    for _ in range(60):
        await asyncio.sleep(0.05)
        for w in list_recent(20):
            if w.payload is payload:
                return str(w.workflow_id)
    return ""


def generate_sample_recall_image(slug: str = "metformin") -> bytes:
    """Render an 800x1200 PNG that looks like a faxed FDA recall notice for the given drug."""
    from PIL import Image, ImageDraw, ImageFont
    if slug not in SAMPLES:
        slug = "metformin"
    s = SAMPLES[slug]

    W, H = 900, 1300
    img = Image.new("RGB", (W, H), color=(248, 248, 244))
    d = ImageDraw.Draw(img)

    def _font(size: int, bold: bool = False):
        candidates = (
            [
                "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                "/Library/Fonts/Arial Bold.ttf",
            ] if bold else [
                "/System/Library/Fonts/Supplemental/Arial.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/Library/Fonts/Arial.ttf",
            ]
        )
        for c in candidates:
            try: return ImageFont.truetype(c, size)
            except Exception: continue
        return ImageFont.load_default()

    f_title = _font(32, bold=True)
    f_h = _font(20, bold=True)
    f_b = _font(18)
    f_s = _font(14)

    # Header
    d.rectangle([(0, 0), (W, 80)], fill=(20, 20, 20))
    d.text((40, 28), "URGENT DRUG RECALL — VOLUNTARY", font=f_title, fill=(255, 255, 255))

    # Class badge
    class_color = {"I": (180, 0, 0), "II": (180, 90, 0), "III": (60, 60, 60)}.get(s["klass"], (60, 60, 60))
    d.rectangle([(40, 100), (200, 140)], outline=class_color, width=3)
    d.text((75, 109), f"CLASS {s['klass']}", font=f_h, fill=class_color)

    # From block
    y = 170
    d.text((40, y), "FROM:", font=f_h, fill=(0, 0, 0)); y += 28
    for line in [
        f"{s['manufacturer']} Pharmacovigilance",
        s["address"],
        f"Tel: {s['phone']}",
    ]:
        d.text((100, y), line, font=f_b, fill=(40, 40, 40)); y += 24

    y += 16
    d.text((40, y), "DATE:", font=f_h, fill=(0, 0, 0))
    d.text((140, y), datetime.utcnow().strftime("%d %B %Y"), font=f_b, fill=(40, 40, 40)); y += 32
    d.text((40, y), "TO:", font=f_h, fill=(0, 0, 0))
    d.text((140, y), "Pharmacy Director / Pharmacist in Charge", font=f_b, fill=(40, 40, 40)); y += 40

    # Product block
    d.rectangle([(40, y), (W - 40, y + 180)], outline=(0, 0, 0), width=2)
    yy = y + 14
    d.text((60, yy), "PRODUCT:", font=f_h, fill=(0, 0, 0))
    d.text((220, yy), s["drug"][:60], font=f_b, fill=(0, 0, 0)); yy += 30
    d.text((60, yy), "NDC:", font=f_h, fill=(0, 0, 0))
    d.text((220, yy), s["ndc"], font=f_b, fill=(0, 0, 0)); yy += 30
    d.text((60, yy), "LOTS:", font=f_h, fill=(0, 0, 0))
    d.text((220, yy), s["lots"][:60], font=f_b, fill=(0, 0, 0)); yy += 30
    d.text((60, yy), "EXP:", font=f_h, fill=(0, 0, 0))
    d.text((220, yy), s["exp"], font=f_b, fill=(0, 0, 0)); yy += 30

    y += 210
    d.text((40, y), "REASON FOR RECALL:", font=f_h, fill=(0, 0, 0)); y += 28
    for line in s["reason"]:
        d.text((40, y), line, font=f_b, fill=(40, 40, 40)); y += 24

    y += 16
    d.text((40, y), "ACTION REQUIRED:", font=f_h, fill=(0, 0, 0)); y += 28
    for line in [
        "1. Cease distribution and sale immediately.",
        "2. Quarantine all unsold inventory of the affected lots.",
        "3. Identify and notify affected patients per institutional SOPs.",
        "4. Return product per the enclosed return instructions.",
    ]:
        d.text((40, y), line, font=f_b, fill=(40, 40, 40)); y += 24

    y += 32
    d.text((40, y), "CONTACT:", font=f_h, fill=(0, 0, 0))
    d.text((140, y), f"{s['phone']}", font=f_b, fill=(40, 40, 40)); y += 26
    d.text((140, y), s["email"], font=f_b, fill=(40, 40, 40)); y += 40

    d.text((40, y), "This recall is being conducted with the knowledge of", font=f_s, fill=(80, 80, 80)); y += 18
    d.text((40, y), "the U.S. Food and Drug Administration.", font=f_s, fill=(80, 80, 80))

    d.text((40, H - 40), "  *** TRANSMITTED VIA FACSIMILE ***", font=f_s, fill=(160, 160, 160))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def list_samples() -> list[dict]:
    return [
        {
            "slug": k,
            "title": v["title"],
            "drug": v["drug"],
            "manufacturer": v["manufacturer"],
            "class": v["klass"],
            "image_url": f"/api/v1/demo/sample/{k}.png",
        }
        for k, v in SAMPLES.items()
    ]
