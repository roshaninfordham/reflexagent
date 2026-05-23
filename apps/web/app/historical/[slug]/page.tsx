'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import AlphaFoldViewer from '../../../components/AlphaFoldViewer';
import ChemistryPanel from '../../../components/ChemistryPanel';
import InteractionsPanel from '../../../components/InteractionsPanel';
import SimilarityPanel from '../../../components/SimilarityPanel';
import ThemeToggle from '../../../components/ThemeToggle';
import TrialsPanel from '../../../components/TrialsPanel';
import { API_BASE, api } from '../../../lib/api';

type Recall = {
  slug: string; drug: string; year: number; story: string;
  actual_action: string[]; scope: string; lessons: string;
  sources: { title: string; url: string }[];
  openfda_live_records?: { recall_number: string; status: string; classification: string; reason_for_recall: string }[];
};

type Compare = {
  reflex?: {
    triage_class: string | null; triage_urgency: string | null; severity_score: number | null;
    cohort_count: number; cohort_high_risk: number;
    verification_verdict: string | null; conflict_summary: string | null; counter_evidence_count: number;
    substitutes: { drug: string; target: string; similarity: number }[];
    brief_title: string | null; brief_recommendation: string | null; published_url: string | null;
  };
  historical?: any;
};

export default function HistoricalCase({ params }: { params: { slug: string } }) {
  return (
    <Suspense fallback={<main className="grid-bg min-h-screen p-10 text-slate-light">loading…</main>}>
      <Inner slug={params.slug} />
    </Suspense>
  );
}

function Inner({ slug }: { slug: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const wf = params.get('wf');
  const [detail, setDetail] = useState<Recall | null>(null);
  const [compare, setCompare] = useState<Compare | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoReplayed, setAutoReplayed] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await api<Recall>(`/api/v1/historical/recalls/${slug}`);
        if (mounted) setDetail(r);
      } catch {}
    })();
    return () => { mounted = false; };
  }, [slug]);

  // Auto-fire the Reflex swarm once when the page loads with no workflow yet
  useEffect(() => {
    if (wf || busy || autoReplayed) return;
    setAutoReplayed(true);
    const t = setTimeout(() => replay(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wf, autoReplayed]);

  useEffect(() => {
    if (!wf) return;
    let mounted = true;
    const load = async () => {
      try {
        const c = await api<Compare>(`/api/v1/historical/compare/${slug}/${wf}`);
        if (mounted) setCompare(c);
      } catch {}
    };
    load();
    const i = setInterval(load, 3000);
    return () => { mounted = false; clearInterval(i); };
  }, [slug, wf]);

  async function replay() {
    setBusy(true);
    try {
      let res: Response;
      try { res = await fetch(`${API_BASE}/api/v1/historical/replay/${slug}`, { method: 'POST' }); }
      catch { res = await fetch(`/api/proxy/v1/historical/replay/${slug}`, { method: 'POST' }); }
      const data = await res.json();
      if (data.workflow_id) router.push(`/historical/${slug}?wf=${data.workflow_id}`);
    } finally { setBusy(false); }
  }

  if (!detail) return <main className="grid-bg min-h-screen p-10 text-slate-light">loading…</main>;

  return (
    <main className="grid-bg min-h-screen">
      <header className="px-6 md:px-10 pt-6 pb-4 flex items-center justify-between">
        <Link href="/historical" className="text-xs uppercase tracking-widest text-slate-light hover:text-teal-glow">← all cases</Link>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {!wf && (
            <button className="btn btn-primary text-xs" disabled={busy} onClick={replay}>
              {busy ? 'Firing swarm…' : 'Replay through Reflex →'}
            </button>
          )}
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-6 md:px-10 py-6">
        <div className="text-[11px] uppercase tracking-widest text-slate-light">Historical · {detail.year}</div>
        <h1 className="font-serif text-3xl md:text-5xl text-ice glow-text mt-1">{detail.drug}</h1>
        <p className="text-slate-light mt-3 leading-relaxed">{detail.story}</p>
        <div className="mt-2 text-[11px] text-slate-light italic">{detail.scope}</div>

        <div className="mt-6 grid lg:grid-cols-2 gap-5">
          <ChemistryPanel drugName={detail.drug} />
          {/* AlphaFold prediction — uses the Reflex Substitute output if available, else the drug name as hint */}
          <AlphaFoldViewer target={compare?.reflex?.substitutes?.[0]?.target || detail.drug} />
        </div>

        {compare?.reflex?.substitutes && compare.reflex.substitutes.length > 0 && (
          <div className="mt-5">
            <InteractionsPanel
              recalledDrug={detail.drug}
              substitutes={compare.reflex.substitutes.map((s) => ({ drug: s.drug }))}
            />
          </div>
        )}

        <div className="mt-5 grid lg:grid-cols-2 gap-5">
          <SimilarityPanel drugName={detail.drug} />
          <TrialsPanel drugName={detail.drug} />
        </div>

        <div className="mt-6 grid lg:grid-cols-2 gap-5">
          <div className="card p-5 border-warn/30">
            <div className="text-[10px] uppercase tracking-widest text-warn mb-2">What actually happened</div>
            <ul className="text-sm text-ice/90 space-y-2 list-disc list-inside">
              {detail.actual_action.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
            <div className="text-xs text-slate-light italic mt-3">{detail.lessons}</div>
            {detail.sources.length > 0 && (
              <div className="mt-3 text-[11px]">
                Sources: {detail.sources.map((s, i) => (
                  <a key={i} href={s.url} target="_blank" className="text-teal-glow hover:underline mr-2">{s.title} ↗</a>
                ))}
              </div>
            )}
          </div>

          <div className="card p-5 border-teal/30">
            <div className="text-[10px] uppercase tracking-widest text-teal-glow mb-2">What Reflex recommends</div>
            {!wf ? (
              <div className="text-sm text-slate-light italic">{busy ? 'Firing the swarm automatically…' : 'Auto-replaying through Reflex…'}</div>
            ) : !compare?.reflex ? (
              <div className="text-sm text-slate-light italic">Swarm running… brief will appear here when ready.</div>
            ) : (
              <div className="space-y-2 text-sm">
                <Row k="Triage" v={`Class ${compare.reflex.triage_class || '?'} · ${compare.reflex.triage_urgency || ''} · ${compare.reflex.severity_score?.toFixed(1) || '?'}/10`} />
                <Row k="Verdict" v={compare.reflex.verification_verdict || '—'} />
                {compare.reflex.conflict_summary && (
                  <div className="text-xs text-alert bg-alert/10 border border-alert/30 rounded p-2 my-2">
                    Counter-evidence: {compare.reflex.conflict_summary}
                  </div>
                )}
                <Row k="Affected cohort (fixture)" v={`${compare.reflex.cohort_count} patients · ${compare.reflex.cohort_high_risk} high-risk`} />
                {compare.reflex.substitutes && compare.reflex.substitutes.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-slate-light mt-2 mb-1">BioNeMo ranked alternatives</div>
                    <ul className="text-xs space-y-0.5">
                      {compare.reflex.substitutes.map((s, i) => (
                        <li key={i} className="flex items-center justify-between">
                          <span className="text-ice">{s.drug}</span>
                          <span className="text-teal-glow tabular-nums">{s.similarity > 0 ? `sim ${s.similarity.toFixed(3)}` : 'n/a'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {compare.reflex.brief_recommendation && (
                  <div className="mt-3">
                    <div className="text-[10px] uppercase tracking-widest text-slate-light mb-1">Recommendation</div>
                    <p className="text-xs text-ice/90 leading-relaxed">{compare.reflex.brief_recommendation}</p>
                  </div>
                )}
                {wf && (
                  <Link href={`/workflow/${wf}`} className="btn text-xs mt-3 inline-block">
                    Open the live workflow →
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>

        {detail.openfda_live_records && detail.openfda_live_records.length > 0 && (
          <div className="card p-5 mt-5">
            <div className="text-[10px] uppercase tracking-widest text-slate-light mb-2">Live openFDA records (matched on drug name)</div>
            <ul className="text-xs text-ice/90 space-y-1.5">
              {detail.openfda_live_records.map((r) => (
                <li key={r.recall_number}>
                  <span className="text-teal-glow font-mono">{r.recall_number}</span> · {r.classification} · {r.status}
                  <div className="text-slate-light text-[11px] mt-0.5">{r.reason_for_recall}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-light">{k}</span>
      <span className="text-ice">{v}</span>
    </div>
  );
}
