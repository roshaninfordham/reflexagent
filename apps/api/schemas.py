"""Pydantic schemas used by the orchestrator and agents."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


# ----- Trigger payload (from monitor / camera / PDF / manual) -----

TriggerSource = Literal[
    "monitor_openfda", "edge_camera", "pdf_upload", "manual"
]


class TriggerPayload(BaseModel):
    drug_name: str | None = None
    ndc: str | None = None
    lot_numbers: list[str] = Field(default_factory=list)
    recall_class: Literal["I", "II", "III"] | None = None
    reason: str | None = None
    manufacturer: str | None = None
    received_date: date | None = None
    confidence: float = 0.95
    source: TriggerSource = "manual"
    raw_image_hash: str | None = None
    external_id: str | None = None  # OpenFDA recall_number when from monitor


# ----- Per-agent outputs -----


class NormalizedRecall(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    drug_name: str
    normalized_drug: str
    drug_class: str = ""
    ndc: str | None = None
    lot_numbers: list[str] = Field(default_factory=list)
    recall_class: str | None = None
    reason: str | None = None
    manufacturer: str | None = None
    source: TriggerSource = "manual"
    faers_anchor: str = ""


class ScoutFinding(BaseModel):
    source: str
    title: str
    url: str
    snippet: str
    date: str | None = None


class ScoutFindings(BaseModel):
    faers: list[ScoutFinding] = Field(default_factory=list)
    ema: list[ScoutFinding] = Field(default_factory=list)
    pubmed: list[ScoutFinding] = Field(default_factory=list)
    confidence_per_source: dict[str, float] = Field(default_factory=dict)


class Triage(BaseModel):
    severity: Literal["I", "II", "III"]
    severity_score: float
    urgency: Literal["immediate", "24h", "7d"]
    affected_populations: list[str] = Field(default_factory=list)
    rationale: str = ""


class ReconAnalog(BaseModel):
    drug_name: str
    event_type: str
    severity: str
    distance: float
    snippet: str = ""
    source_url: str = ""


class ReconAnalogs(BaseModel):
    similar_past_events: list[ReconAnalog] = Field(default_factory=list)
    pattern_signals: str = ""


class CounterEvidence(BaseModel):
    source: str
    url: str
    refutation: str


class Verification(BaseModel):
    confirmed_claims: list[str] = Field(default_factory=list)
    disputed_claims: list[str] = Field(default_factory=list)
    counter_evidence: list[CounterEvidence] = Field(default_factory=list)
    verdict: Literal["confirmed", "disputed", "requires_human"] = "confirmed"
    confidence: float = 0.0
    conflict_summary: str | None = None


class CohortDemographics(BaseModel):
    by_age_band: dict[str, int] = Field(default_factory=dict)
    by_sex: dict[str, int] = Field(default_factory=dict)


class Cohort(BaseModel):
    patient_count: int
    high_risk_count: int
    demographics: CohortDemographics = Field(default_factory=CohortDemographics)
    sample_ids: list[str] = Field(default_factory=list)


class Comms(BaseModel):
    pharmacist_memo: str
    clinician_alert: str
    patient_letter: str
    routing_targets: list[str] = Field(default_factory=list)


class Citation(BaseModel):
    title: str
    url: str
    accessed_at: datetime = Field(default_factory=datetime.utcnow)


class Brief(BaseModel):
    brief_id: UUID = Field(default_factory=uuid4)
    drug_name: str
    title: str
    summary: str
    findings: list[str] = Field(default_factory=list)
    counter_evidence_summary: str = ""
    counter_evidence_found: bool = False
    recommendation: str = ""
    severity_score: float = 0.0
    citations: list[Citation] = Field(default_factory=list)


class CitationCheck(BaseModel):
    url: str
    status: int
    ok: bool


class Audit(BaseModel):
    citations_verified: int
    citations_failed: list[CitationCheck] = Field(default_factory=list)
    hallucination_score: float = 0.0
    approved: bool = True
    notes: str = ""


class Published(BaseModel):
    cited_md_url: str
    brief_id: UUID
    published_at: datetime = Field(default_factory=datetime.utcnow)
    fallback: bool = False


class WorkflowResult(BaseModel):
    workflow_id: UUID
    payload: TriggerPayload
    normalized: NormalizedRecall | None = None
    scout: ScoutFindings | None = None
    triage: Triage | None = None
    recon: ReconAnalogs | None = None
    verification: Verification | None = None
    cohort: Cohort | None = None
    comms: Comms | None = None
    brief: Brief | None = None
    audit: Audit | None = None
    published: Published | None = None
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None
    status: Literal["running", "completed", "failed"] = "running"
    error: str | None = None


# ----- Canvas / SSE events -----


class AgentEvent(BaseModel):
    workflow_id: UUID
    agent: str
    step: Literal["start", "tool_call", "tool_return", "end", "conflict"]
    target: str | None = None  # external source node id
    label: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    at: datetime = Field(default_factory=datetime.utcnow)
