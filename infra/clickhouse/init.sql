-- Reflex ClickHouse schema. Idempotent (CREATE IF NOT EXISTS).

CREATE DATABASE IF NOT EXISTS reflex;
USE reflex;

-- ===== 1. Raw adverse-event / recall signal store =====
CREATE TABLE IF NOT EXISTS adverse_events
(
    event_id UUID DEFAULT generateUUIDv4(),
    drug_name LowCardinality(String),
    drug_class LowCardinality(String) DEFAULT '',
    ndc String DEFAULT '',
    lot_numbers Array(String) DEFAULT [],
    event_type LowCardinality(String),
    severity Enum8('mild'=1,'moderate'=2,'severe'=3,'fatal'=4) DEFAULT 'moderate',
    recall_class LowCardinality(String) DEFAULT '',
    source_url String DEFAULT '',
    external_id String DEFAULT '',
    reported_at DateTime,
    ingested_at DateTime DEFAULT now(),
    raw_text String,
    embedding Array(Float32) DEFAULT [],
    INDEX idx_drug drug_name TYPE bloom_filter GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(reported_at)
ORDER BY (drug_name, reported_at);

-- ===== 2. Agent decision audit log =====
CREATE TABLE IF NOT EXISTS agent_traces
(
    trace_id UUID DEFAULT generateUUIDv4(),
    workflow_id UUID,
    parent_trace_id Nullable(UUID),
    agent_name LowCardinality(String),
    step LowCardinality(String),
    drug_context String DEFAULT '',
    input_payload String DEFAULT '',
    output_payload String DEFAULT '',
    tool_calls Array(String) DEFAULT [],
    target String DEFAULT '',
    label String DEFAULT '',
    latency_ms UInt32 DEFAULT 0,
    tokens_in UInt32 DEFAULT 0,
    tokens_out UInt32 DEFAULT 0,
    cost_usd Float32 DEFAULT 0,
    status Enum8('ok'=1,'retry'=2,'failed'=3,'flagged'=4) DEFAULT 'ok',
    error_message Nullable(String),
    started_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(started_at)
ORDER BY (workflow_id, started_at);

-- ===== 3. Published briefs =====
CREATE TABLE IF NOT EXISTS published_briefs
(
    brief_id UUID,
    workflow_id UUID,
    drug_name LowCardinality(String),
    cited_md_url String,
    title String,
    summary String,
    severity_score Float32,
    citation_count UInt8,
    verifying_agents Array(String),
    counter_evidence_found Bool DEFAULT false,
    published_at DateTime DEFAULT now(),
    x402_revenue_usd Float32 DEFAULT 0
)
ENGINE = MergeTree
ORDER BY published_at;

-- ===== 4. Simulated EHR patient fixture =====
CREATE TABLE IF NOT EXISTS patients
(
    patient_id UUID DEFAULT generateUUIDv4(),
    age UInt8,
    sex Enum8('M'=1,'F'=2,'Other'=3),
    zip_3 FixedString(3),
    conditions Array(String) DEFAULT [],
    drugs_taken Array(String) DEFAULT [],
    lots_dispensed Array(String) DEFAULT [],
    last_seen DateTime
)
ENGINE = MergeTree
ORDER BY patient_id;

-- ===== 5. x402 transaction log =====
CREATE TABLE IF NOT EXISTS x402_transactions
(
    txn_id UUID DEFAULT generateUUIDv4(),
    brief_id UUID,
    payer_address String,
    settlement_tx String DEFAULT '',
    amount_usd Float32,
    endpoint String,
    paid_at DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY paid_at;

-- ===== 6. Workflow status (for monitor dedup + UI) =====
CREATE TABLE IF NOT EXISTS workflows
(
    workflow_id UUID,
    payload_json String,
    status Enum8('running'=1,'completed'=2,'failed'=3) DEFAULT 'running',
    started_at DateTime DEFAULT now(),
    completed_at Nullable(DateTime),
    drug_name LowCardinality(String) DEFAULT '',
    source LowCardinality(String) DEFAULT '',
    brief_id Nullable(UUID),
    error Nullable(String)
)
ENGINE = ReplacingMergeTree(started_at)
ORDER BY workflow_id;

-- ===== 7. Monitor seen-IDs (autonomous dedup) =====
CREATE TABLE IF NOT EXISTS monitor_seen
(
    external_id String,
    source LowCardinality(String),
    first_seen DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(first_seen)
ORDER BY (source, external_id);
