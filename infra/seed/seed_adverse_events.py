"""Seed historical adverse events for the Recon agent's analog search.

Run with: `python -m infra.seed.seed_adverse_events`

We intentionally EXCLUDE the canonical demo recall (Apotex metformin lots
APX5523/APX5524) so that when the autonomous monitor's next OpenFDA poll
surfaces it, it counts as "novel" and the swarm fires unprompted on stage.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta
from uuid import uuid4

from apps.api.tools import clickhouse_client

random.seed(20260523)


DRUGS = [
    "Metformin Hcl",
    "Atorvastatin",
    "Lisinopril",
    "Valsartan",
    "Ranitidine",
    "Dabigatran",
    "Losartan",
    "Omeprazole",
    "Simvastatin",
    "Sertraline",
    "Amlodipine",
    "Albuterol",
]

EVENT_TEMPLATES = [
    ("FAERS", "moderate", "https://fis.fda.gov/sense/app/dashboard/faers",
     "Patient reports persistent GI upset and metallic taste following dose increase."),
    ("FAERS", "severe", "https://fis.fda.gov/sense/app/dashboard/faers",
     "Hospitalization for hypoglycemia in elderly patient on multiple antihyperglycemics."),
    ("MAUDE", "moderate", "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfMAUDE/Search.cfm",
     "Device malfunction reported during routine self-test, no patient harm."),
    ("EMA", "severe", "https://www.ema.europa.eu/en/medicines/human/EPAR",
     "PRAC reviewed signals of hepatic injury; advised label update."),
    ("PubMed", "moderate", "https://pubmed.ncbi.nlm.nih.gov/",
     "Retrospective cohort study identified association with elevated transaminases at high dose."),
    ("Press", "mild", "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts",
     "Voluntary firm-initiated recall for packaging defect; product quality maintained."),
    ("FAERS", "fatal", "https://fis.fda.gov/sense/app/dashboard/faers",
     "Fatal outcome reported in patient with CKD stage 4; concomitant medications noted."),
]


def main() -> None:
    rows = []
    for _ in range(220):
        drug = random.choice(DRUGS)
        evt = random.choice(EVENT_TEMPLATES)
        days_ago = random.randint(7, 3500)
        reported = datetime.utcnow() - timedelta(days=days_ago)
        rows.append(
            {
                "event_id": str(uuid4()),
                "drug_name": drug,
                "drug_class": "",
                "ndc": f"60505-{random.randint(2000, 7000)}-{random.randint(0, 9)}",
                "lot_numbers": [
                    f"{drug[:3].upper()}{random.randint(1000, 9999)}",
                ],
                "event_type": evt[0],
                "severity": evt[1],
                "recall_class": random.choice(["", "II", "II", "III", "I"]),
                "source_url": evt[2],
                "external_id": f"hist-{uuid4().hex[:10]}",
                "reported_at": reported,
                "raw_text": evt[3],
                "embedding": [],
            }
        )
    print(f"Inserting {len(rows)} historical adverse events (demo recall intentionally excluded)...")
    clickhouse_client.insert("adverse_events", rows)
    print("Done.")


if __name__ == "__main__":
    main()
