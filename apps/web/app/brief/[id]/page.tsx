'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import BriefActions from '../../../components/BriefActions';
import MoleculePreview from '../../../components/MoleculePreview';
import Narrator from '../../../components/Narrator';
import { api } from '../../../lib/api';

type Workflow = {
  workflow_id: string;
  brief?: {
    title: string;
    drug_name: string;
    summary: string;
    findings: string[];
    counter_evidence_summary: string;
    counter_evidence_found: boolean;
    recommendation: string;
    severity_score: number;
    citations: { title: string; url: string; accessed_at: string }[];
  } | null;
  cohort?: { patient_count: number; high_risk_count: number } | null;
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

export default function BriefPage({ params }: { params: { id: string } }) {
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
    const i = setInterval(load, 3000);
    return () => { mounted = false; clearInterval(i); };
  }, [id]);

  const b = wf?.brief;
  const narration = useMemo(() => {
    const out: string[] = [];
    if (b?.summary) out.push(b.summary);
    if (b?.findings?.length) {
      for (const f of b.findings.slice(0, 3)) out.push(f);
    }
    if (b?.recommendation) out.push('Recommendation. ' + b.recommendation);
    if (wf?.substitutes?.candidates?.length) {
      const top = wf.substitutes.candidates[0];
      out.push(
        `Top alternative: ${top.drug_name} targeting ${top.target_protein}, with similarity ${top.target_similarity.toFixed(2)}.`,
      );
    }
    return out;
  }, [b, wf?.substitutes]);

  return (
    <main className="grid-bg min-h-screen">
      <header className="px-6 md:px-10 pt-6 pb-4 flex items-center justify-between">
        <Link href={`/workflow/${id}`} className="text-xs uppercase tracking-widest text-slate-light hover:text-teal-glow">
          ← workflow
        </Link>
        <div className="flex items-center gap-3">
          <Narrator workflowId={id} lines={narration} />
          <Link href="/premium" className="btn btn-primary">
            Unlock premium sub-brief · $0.50
          </Link>
        </div>
      </header>

      <article className="max-w-3xl mx-auto px-6 md:px-10 py-6">
        <div className="text-[11px] uppercase tracking-widest text-slate-light">Reflex Safety Brief</div>
        <h1 className="font-serif text-3xl md:text-4xl leading-tight mt-1 text-ice">
          {b?.title || (wf ? 'Brief composing…' : 'Loading…')}
        </h1>

        {b && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-light">
            <Badge>{b.drug_name}</Badge>
            <Badge>Severity {b.severity_score.toFixed(1)} / 10</Badge>
            <Badge>{b.counter_evidence_found ? 'Counter-evidence' : 'No counter-evidence'}</Badge>
            {wf?.audit && <Badge>{wf.audit.citations_verified} citations verified</Badge>}
            {wf?.published && (
              <a href={wf.published.cited_md_url} target="_blank" className="text-teal-glow hover:underline">
                cited.md ↗
              </a>
            )}
          </div>
        )}

        {b && (
          <>
            <Section title="Recalled drug · target">
              <MoleculePreview drugName={b.drug_name} />
            </Section>

            <Section title="Summary">
              <p className="text-ice/90 leading-relaxed">{b.summary}</p>
            </Section>

            <Section title="Key findings">
              <ul className="list-disc list-inside space-y-1 text-ice/90">
                {b.findings.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </Section>

            <Section title="Counter-evidence considered">
              <p className="text-ice/90 leading-relaxed">{b.counter_evidence_summary}</p>
            </Section>

            {wf?.cohort && (
              <Section title="Affected population (demo fixture)">
                <p className="text-ice/90">
                  Patients identified: <strong>{wf.cohort.patient_count}</strong>{' '}
                  · High-risk (age ≥75 or CKD): <strong>{wf.cohort.high_risk_count}</strong>
                </p>
              </Section>
            )}

            <Section title="Recommendation">
              <p className="text-ice/90 leading-relaxed">{b.recommendation}</p>
            </Section>

            <BriefActions
              workflowId={id}
              brief={b}
              citedUrl={wf?.published?.cited_md_url}
            />

            {wf?.substitutes && wf.substitutes.candidates.length > 0 && (
              <Section title="Therapeutic alternatives · BioNeMo ESM2">
                <p className="text-xs text-slate-light mb-3">
                  Recalled target: <span className="text-ice">{wf.substitutes.recalled_target}</span>
                  {wf.substitutes.embedding_dim > 0 && (
                    <span> · ranked by cosine similarity over {wf.substitutes.embedding_dim}-d protein embeddings.</span>
                  )}
                </p>
                <ul className="space-y-4">
                  {wf.substitutes.candidates.map((c, i) => (
                    <li key={i} className="card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <div className="text-ice font-semibold">{c.drug_name}</div>
                          <div className="text-[11px] text-slate-light">
                            {c.drug_class}
                            {c.target_protein ? ` · ${c.target_protein}` : ''}
                          </div>
                        </div>
                        {c.target_similarity > 0 && (
                          <div className="text-teal-glow font-mono text-sm">
                            sim {c.target_similarity.toFixed(3)}
                          </div>
                        )}
                      </div>
                      {c.rationale && <p className="text-xs text-ice/80 mb-3">{c.rationale}</p>}
                      <MoleculePreview drugName={c.drug_name} size="small" />
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="Citations">
              <ol className="list-decimal list-inside space-y-1.5">
                {b.citations.map((c, i) => (
                  <li key={i} className="text-ice/90">
                    <a href={c.url} target="_blank" className="text-teal-glow hover:underline">{c.title}</a>
                    <span className="text-slate-light"> — {c.url}</span>
                  </li>
                ))}
              </ol>
            </Section>
          </>
        )}
      </article>

      <footer className="max-w-3xl mx-auto px-6 md:px-10 pb-12 text-[11px] text-slate-light">
        Reflex is an autonomous pharmacovigilance agent system. This brief is generated by
        an autonomous agent swarm and verified against primary sources. Not a substitute
        for FDA labeling or licensed medical advice.
      </footer>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-xs uppercase tracking-widest text-slate-light mb-2">{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="px-2 py-0.5 rounded-full border border-teal/20 bg-teal/10 text-teal-glow">{children}</span>;
}
