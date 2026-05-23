'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AgentTheater from '../../../components/AgentTheater';
import HotspotMap from '../../../components/HotspotMap';
import MoleculePreview, { isPreviewable } from '../../../components/MoleculePreview';
import VoiceAgent from '../../../components/VoiceAgent';
import { api } from '../../../lib/api';

type Workflow = {
  workflow_id: string;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at: string | null;
  payload: { drug_name?: string | null; source: string };
  normalized?: { normalized_drug: string } | null;
  triage?: { severity: string; urgency: string; severity_score: number } | null;
  cohort?: { patient_count: number; high_risk_count: number } | null;
  verification?: { verdict: string; conflict_summary: string | null } | null;
  brief?: { title: string; summary: string; citations: { title: string; url: string }[] } | null;
  audit?: { citations_verified: number; approved: boolean } | null;
  published?: { cited_md_url: string; fallback: boolean } | null;
  substitutes?: {
    recalled_drug: string;
    recalled_target: string;
    embedding_dim: number;
    notes: string;
    candidates: {
      drug_name: string;
      drug_class: string;
      target_protein: string;
      target_similarity: number;
      rationale: string;
    }[];
  } | null;
};

export default function WorkflowPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [wf, setWf] = useState<Workflow | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const w = await api<Workflow>(`/api/v1/workflow/${id}`);
        if (mounted) setWf(w);
      } catch {}
    };
    load();
    const i = setInterval(load, 1200);
    return () => { mounted = false; clearInterval(i); };
  }, [id]);

  return (
    <main className="grid-bg min-h-screen">
      <header className="px-6 md:px-10 pt-6 pb-4 flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs uppercase tracking-widest text-slate-light hover:text-teal-glow">
            ← back to live
          </Link>
          <h1 className="text-2xl font-semibold text-ice mt-1">
            {wf?.brief?.title || wf?.normalized?.normalized_drug || wf?.payload.drug_name || 'Workflow'}
          </h1>
        </div>
        <StatusPill status={wf?.status} />
      </header>

      <section className="px-6 md:px-10 pb-8 grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <AgentTheater workflowId={id} />
          {wf?.cohort && wf.cohort.patient_count > 0 && (
            <HotspotMap workflowId={id} />
          )}
          <VoiceAgent workflowId={id} />
        </div>

        <div className="space-y-4">
          <Card title="Triage">
            {wf?.triage ? (
              <>
                <Row label="FDA Class" value={wf.triage.severity} />
                <Row label="Urgency" value={wf.triage.urgency} />
                <Row label="Severity score" value={`${wf.triage.severity_score.toFixed(1)} / 10`} />
              </>
            ) : <Empty />}
          </Card>

          <Card title="Affected cohort">
            {wf?.cohort ? (
              <>
                <Row label="Patients" value={String(wf.cohort.patient_count)} accent />
                <Row label="High-risk" value={String(wf.cohort.high_risk_count)} />
              </>
            ) : <Empty />}
          </Card>

          <Card title="Verification">
            {wf?.verification ? (
              <>
                <Row label="Verdict" value={wf.verification.verdict} />
                {wf.verification.conflict_summary && (
                  <div className="mt-2 p-2 rounded bg-alert/10 border border-alert/30 text-xs text-alert">
                    {wf.verification.conflict_summary}
                  </div>
                )}
              </>
            ) : <Empty />}
          </Card>

          <Card title="Audit">
            {wf?.audit ? (
              <>
                <Row label="Citations verified" value={String(wf.audit.citations_verified)} />
                <Row label="Approved" value={wf.audit.approved ? 'yes' : 'no'} />
              </>
            ) : <Empty />}
          </Card>

          {wf?.substitutes && wf.substitutes.candidates.length > 0 && (
            <Card title="Substitutes · BioNeMo">
              <div className="text-[11px] text-slate-light mb-1.5">
                Target: <span className="text-ice">{wf.substitutes.recalled_target}</span>
              </div>
              <ul className="space-y-1.5">
                {wf.substitutes.candidates.map((c, i) => (
                  <li key={i} className="text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-ice font-medium">{c.drug_name}</span>
                      <span className="text-teal-glow tabular-nums text-xs">
                        {c.target_similarity > 0 ? `sim ${c.target_similarity.toFixed(3)}` : 'n/a'}
                      </span>
                    </div>
                    {c.target_protein && <div className="text-[10px] text-slate-light">target: {c.target_protein}</div>}
                  </li>
                ))}
              </ul>
              <div className="text-[10px] text-slate-light mt-2">
                {wf.substitutes.embedding_dim ? `ESM2 dim ${wf.substitutes.embedding_dim}` : 'embeddings unavailable'}
              </div>
            </Card>
          )}

          {/* Live drug + target preview — surfaces the moment Substitute completes */}
          {wf?.normalized?.normalized_drug && (isPreviewable(wf.normalized.normalized_drug) || wf.substitutes?.recalled_target) && (
            <Card title="Recalled drug · target preview">
              <MoleculePreview
                drugName={wf.normalized.normalized_drug}
                targetHint={wf.substitutes?.recalled_target}
                size="small"
              />
              <div className="text-[10px] text-slate-light mt-2">
                2D from PubChem · 3D protein cartoon from RCSB PDB (rotating)
              </div>
            </Card>
          )}

          {wf?.published && (
            <Card title="Published">
              <a
                href={wf.published.cited_md_url}
                target="_blank"
                className="block text-sm text-teal-glow hover:underline truncate"
              >
                {wf.published.cited_md_url}
              </a>
              {wf.published.fallback && (
                <div className="text-[10px] text-warn mt-1">via git/GitHub-raw fallback</div>
              )}
              <Link href={`/brief/${wf.brief?.title ? id : id}`} className="btn btn-primary mt-3 w-full">
                Open brief →
              </Link>
            </Card>
          )}
        </div>
      </section>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-widest text-slate-light mb-2">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm py-0.5">
      <span className="text-slate-light">{label}</span>
      <span className={accent ? 'text-teal-glow font-semibold' : 'text-ice'}>{value}</span>
    </div>
  );
}

function Empty() {
  return <div className="text-xs text-slate-light italic">pending…</div>;
}

function StatusPill({ status }: { status?: string }) {
  const s = status || 'running';
  const palette: Record<string, string> = {
    running: 'bg-warn/20 text-warn border-warn/30',
    completed: 'bg-ok/20 text-ok border-ok/30',
    failed: 'bg-alert/20 text-alert border-alert/30',
  };
  return (
    <span className={`text-[11px] uppercase tracking-widest px-2.5 py-1 rounded-full border ${palette[s] || palette.running}`}>
      {s}
    </span>
  );
}
