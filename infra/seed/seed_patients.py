"""Seed 50 synthetic patients with realistic drug overlap for demo.

Run with: `python -m infra.seed.seed_patients`

15+ are on metformin with lots APX5523 or APX5524 (the canonical demo recall).
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta
from uuid import uuid4

from apps.api.geo import SEED_ZIP3
from apps.api.tools import clickhouse_client

random.seed(20260523)


CONDITIONS = [
    ["Type 2 Diabetes"],
    ["Type 2 Diabetes", "Hypertension"],
    ["Type 2 Diabetes", "CKD Stage 3"],
    ["Type 2 Diabetes", "CKD Stage 3", "CHF"],
    ["Hypertension"],
    ["Hypertension", "Atrial Fibrillation"],
    ["Hyperlipidemia"],
    ["GERD"],
    ["Asthma"],
    ["Depression"],
    ["Migraine"],
    [],
]

DRUGS = [
    "Metformin Hcl",
    "Atorvastatin",
    "Lisinopril",
    "Levothyroxine",
    "Omeprazole",
    "Amlodipine",
    "Simvastatin",
    "Losartan",
    "Albuterol",
    "Sertraline",
    "Dabigatran",
    "Valsartan",
]


def _random_patient(force_metformin_lot: str | None = None) -> dict:
    age = random.choice([28, 34, 42, 48, 55, 60, 64, 68, 72, 76, 79, 82, 85, 88])
    sex = random.choice(["M", "F", "M", "F"])
    conditions = random.choice(CONDITIONS)
    if force_metformin_lot:
        drugs = ["Metformin Hcl"]
        lots = [force_metformin_lot]
    else:
        drugs = random.sample(DRUGS, k=random.randint(1, 4))
        lots = []
        for d in drugs:
            lots.append(f"{d[:3].upper()}{random.randint(1000, 9999)}")
    return {
        "patient_id": str(uuid4()),
        "age": age,
        "sex": sex,
        "zip_3": random.choice(SEED_ZIP3),
        "conditions": conditions,
        "drugs_taken": drugs,
        "lots_dispensed": lots,
        "last_seen": datetime.utcnow() - timedelta(days=random.randint(1, 90)),
    }


def main() -> None:
    rows: list[dict] = []
    # 18 on the recalled metformin lots (so the demo finds plenty).
    for i in range(18):
        rows.append(_random_patient(force_metformin_lot=("APX5523" if i % 2 == 0 else "APX5524")))
    # 32 random patients (some may also be on metformin via random sampling).
    for _ in range(32):
        rows.append(_random_patient())

    # Make ~6 of them clearly high-risk (>=75 or CKD).
    for p in rows[:6]:
        p["age"] = 78
        p["conditions"] = list(set(p["conditions"] + ["CKD Stage 3"]))

    print(f"Inserting {len(rows)} patients...")
    clickhouse_client.insert("patients", rows)
    print("Done.")


if __name__ == "__main__":
    main()
