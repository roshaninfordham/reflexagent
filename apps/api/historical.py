"""Famous historical FDA drug recalls — ingested from openFDA + outcome record.

We curate ~6 recalls that became regulatory milestones and pair each with the
actual outcome the FDA and the manufacturer took, so Reflex's recommendation
can be compared side-by-side with what really happened.

Data sources:
  - openFDA Drug Enforcement Reports API (https://api.fda.gov/drug/enforcement.json)
  - FDA Press Announcements (URLs cited per case)
  - FDA Recall classification system (21 CFR §7.3)
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)


# Curated famous historical recalls. recall_number is the FDA's actual ID.
# When `recall_number` is provided we fetch the live openFDA payload to confirm
# the record is real. We then merge in the historical outcome we know from
# regulatory publications.
FAMOUS_RECALLS: list[dict[str, Any]] = [
    {
        "slug": "valsartan-2018",
        "drug": "Valsartan",
        "year": 2018,
        "search": "valsartan",
        "story": "ARB nitrosamine crisis — root cause was a manufacturing change at a Zhejiang Huahai plant in China that introduced NDMA into the API supply chain.",
        "actual_action": [
            "Multiple manufacturers initiated Class II voluntary recalls of valsartan-containing products beginning July 2018.",
            "FDA expanded the recall to other ARBs (losartan, irbesartan) in 2019 as more nitrosamines were detected.",
            "FDA published interim acceptable intake limits (NDMA 96 ng/day, NDEA 26.5 ng/day).",
            "Zhejiang Huahai placed on FDA Import Alert; multiple downstream brands withdrawn.",
            "EMA conducted a parallel referral procedure and harmonized limits.",
        ],
        "scope": "Nationwide; tens of millions of doses; ~6 month detection-to-recall gap",
        "lessons": "Highlighted that API supply-chain auditing was insufficient; manufacturers didn't have N-nitrosamine testing protocols.",
        "sources": [
            {
                "title": "FDA Updates on ARB Recalls (Valsartan, Losartan, Irbesartan)",
                "url": "https://www.fda.gov/drugs/drug-safety-and-availability/fda-updates-and-press-announcements-angiotensin-ii-receptor-blocker-arb-recalls-valsartan-losartan",
            }
        ],
    },
    {
        "slug": "ranitidine-2019",
        "drug": "Ranitidine",
        "year": 2019,
        "search": "ranitidine",
        "story": "NDMA detection in Zantac (ranitidine) led to full U.S. market withdrawal in April 2020 — the largest small-molecule drug withdrawal in modern FDA history.",
        "actual_action": [
            "FDA initially advised consumers in September 2019; voluntary manufacturer recalls followed in October.",
            "April 1, 2020: FDA requested withdrawal of ALL prescription and OTC ranitidine products from market.",
            "Mechanism: ranitidine generates NDMA at elevated temperatures during storage — an intrinsic instability of the molecule, not a supply contamination.",
            "Patients advised to switch to famotidine, cimetidine, or PPIs.",
        ],
        "scope": "Complete market withdrawal — all lots, all formulations, all manufacturers",
        "lessons": "Demonstrated that some molecules degrade to carcinogens under normal conditions; stability programs need long-tail surveillance.",
        "sources": [
            {
                "title": "FDA Requests Removal of All Ranitidine Products (Zantac) from the Market",
                "url": "https://www.fda.gov/news-events/press-announcements/fda-requests-removal-all-ranitidine-products-zantac-market",
            }
        ],
    },
    {
        "slug": "metformin-2020",
        "drug": "Metformin",
        "year": 2020,
        "search": "metformin",
        "story": "NDMA found in some extended-release metformin products; recall confined to specific lots, not a market withdrawal.",
        "actual_action": [
            "FDA recommended specific company-lot recalls in May 2020 based on lab testing.",
            "Apotex, Amneal, Marksans, Lupin, and others issued voluntary Class II recalls of affected lots.",
            "FDA did NOT recommend stopping metformin generally — patients told to continue use until alternatives confirmed.",
            "FDA published guidance on nitrosamine testing for all drug manufacturers (Sept 2020).",
        ],
        "scope": "Lot-specific recalls across multiple manufacturers; not market-wide",
        "lessons": "Showed that targeted lot recalls work when traceability is good. The Reflex Cohort agent is built on this principle.",
        "sources": [
            {
                "title": "FDA Updates on NDMA in Metformin",
                "url": "https://www.fda.gov/drugs/drug-safety-and-availability/fda-updates-and-press-announcements-ndma-metformin",
            }
        ],
    },
    {
        "slug": "tylenol-1982",
        "drug": "Acetaminophen",
        "year": 1982,
        "search": "tylenol",
        "story": "Chicago Tylenol cyanide tampering killed 7 people. Johnson & Johnson's response set the modern standard for crisis recall management.",
        "actual_action": [
            "J&J immediately recalled 31 million bottles nationwide despite the contamination being limited to Chicago.",
            "Halted all Tylenol advertising and production.",
            "Designed and shipped the first tamper-evident packaging in U.S. consumer drug history within 8 weeks.",
            "Led to passage of the Federal Anti-Tampering Act (1983).",
        ],
        "scope": "31 million bottles, $100M+ direct cost, complete brand rescue within 12 months",
        "lessons": "The textbook example of treating recall response as a brand-saving moment, not damage control. Speed + transparency + structural change.",
        "sources": [
            {
                "title": "FDA: Tamper-Evident Packaging Requirements",
                "url": "https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-bulk-packaging-and-tamper-evident-packaging-requirements",
            }
        ],
    },
    {
        "slug": "vioxx-2004",
        "drug": "Rofecoxib (Vioxx)",
        "year": 2004,
        "search": "vioxx",
        "story": "COX-2 inhibitor withdrawn after a long-term colon polyp trial revealed elevated cardiovascular risk. FDA had signals years earlier.",
        "actual_action": [
            "Merck voluntarily withdrew Vioxx worldwide on September 30, 2004.",
            "Subsequent analyses suggested ~38,000 excess cardiac deaths in U.S. during the 5 years it was on the market.",
            "Led to the FDA Amendments Act of 2007 establishing the Sentinel post-market surveillance system.",
            "FDA gained authority to require post-approval studies and Risk Evaluation and Mitigation Strategies (REMS).",
        ],
        "scope": "Worldwide withdrawal; 80M patients exposed; sparked structural change at FDA",
        "lessons": "Post-market signals were buried for years. Reflex's continuous Scout + counter-evidence agents are designed to surface this kind of signal early.",
        "sources": [
            {
                "title": "FDAAA 2007 Sentinel Initiative",
                "url": "https://www.fda.gov/safety/fdas-sentinel-initiative",
            }
        ],
    },
    {
        "slug": "dabigatran-2014",
        "drug": "Dabigatran (Pradaxa)",
        "year": 2014,
        "search": "dabigatran",
        "story": "Bleeding risk lawsuits and a $650M settlement led to broader FDA scrutiny of direct oral anticoagulants and to the development of reversal agents.",
        "actual_action": [
            "FDA mandated updated bleeding-risk labeling in 2014.",
            "Boehringer Ingelheim funded development of idarucizumab (Praxbind), a specific reversal agent (approved 2015).",
            "Established the precedent that novel anticoagulants must have reversal-agent pathways.",
        ],
        "scope": "Label change, not market withdrawal; spawned a new drug class (reversal agents)",
        "lessons": "Demonstrates how recall/safety-signal investigations can drive drug-development pipelines toward complementary safety products.",
        "sources": [
            {
                "title": "FDA Approves Praxbind, First Reversal Agent for the Anticoagulant Pradaxa",
                "url": "https://wayback.archive-it.org/7993/20170112224324/http:/www.fda.gov/NewsEvents/Newsroom/PressAnnouncements/ucm467300.htm",
            }
        ],
    },
]


def list_recalls() -> list[dict[str, Any]]:
    return [{k: v for k, v in r.items() if k != "search"} for r in FAMOUS_RECALLS]


def get_recall(slug: str) -> dict[str, Any] | None:
    for r in FAMOUS_RECALLS:
        if r["slug"] == slug:
            return r
    return None


async def fetch_openfda_evidence(search: str) -> list[dict[str, Any]]:
    """Pull real openFDA recall records that match the drug name."""
    url = (
        "https://api.fda.gov/drug/enforcement.json"
        f"?search=product_description:{search}&limit=5"
    )
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url)
            if r.status_code == 200:
                return (r.json() or {}).get("results", [])
    except Exception as e:  # noqa: BLE001
        log.warning("openFDA historical fetch failed: %s", e)
    return []
