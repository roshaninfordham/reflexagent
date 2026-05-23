'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import ActivityFeed from '../../components/ActivityFeed';
import AgentTheater from '../../components/AgentTheater';
import GlobalHotspotMap from '../../components/GlobalHotspotMap';
import LaunchDemo from '../../components/LaunchDemo';
import MonitorStatus from '../../components/MonitorStatus';
import RecentWorkflows from '../../components/RecentWorkflows';
import ThemeToggle from '../../components/ThemeToggle';
import VoiceAgent from '../../components/VoiceAgent';
import WalletBadge from '../../components/WalletBadge';
import { api } from '../../lib/api';

type WF = {
  workflow_id: string;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  payload: { drug_name?: string | null };
  normalized?: { normalized_drug: string } | null;
  triage?: { severity: string; severity_score: number; urgency: string } | null;
  cohort?: { patient_count: number; high_risk_count: number } | null;
  brief?: { title: string } | null;
  published?: { cited_md_url: string } | null;
  substitutes?: { recalled_target: string; embedding_dim: number; candidates: { drug_name: string; target_similarity: number }[] } | null;
};

const DD_DASHBOARD = 'https://app.datadoghq.com/llm/applications?query=ml_app%3Areflex';

export default function OpsPage() {
  return (
    <Suspense fallback={<main className="grid-bg min-h-screen p-10 text-slate-light">loading…</main>}>
      <OpsInner />
    </Suspense>
  );
}

function OpsInner() {
  const params = useSearchParams();
  const preferred = params.get('wf');
  const [active, setActive] = useState<WF | null>(null);
  const [stack, setStack] = useState<WF[]>([]);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const xs = await api<WF[]>('/api/v1/workflows?limit=12');
        if (!mounted) return;
        setStack(xs);
        // If a workflow was requested via ?wf= and it appears in recents, prefer it.
        let pick = preferred ? xs.find((w) => w.workflow_id === preferred) : null;
        if (!pick) pick = xs.find((w) => w.status === 'running') || null;
        if (!pick) pick = xs.find((w) => w.status === 'completed') || null;
        if (!pick) pick = xs[0] || null;
        setActive((prev) => {
          // Always swap to the preferred one if it just appeared, but otherwise keep stable.
          if (preferred && pick && (!prev || prev.workflow_id !== preferred)) return pick;
          return prev || pick;
        });
      } catch {}
    };
    load();
    const i = setInterval(load, 2500);
    return () => { mounted = false; clearInterval(i); };
  }, [preferred]);

  return (
    <main className="grid-bg min-h-screen">
      <header className="px-6 md:px-10 pt-6 pb-3 flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs uppercase tracking-widest text-slate-light hover:text-teal-glow">
            ← landing
          </Link>
          <h1 className="text-2xl font-semibold text-ice mt-1">Ops · Mission Control</h1>
        </div>
        <div className="flex items-center gap-3">
          <a href={DD_DASHBOARD} target="_blank" className="btn text-xs py-1.5 px-3">
            Datadog LLM Obs ↗
          </a>
          <ThemeToggle />
          <LaunchDemo label="New demo workflow" className="text-xs py-1.5 px-3" />
          <Link href="/premium" className="btn btn-primary text-xs py-1.5 px-3">
            Pay $0.50 sub-brief
          </Link>
        </div>
      </header>

      <section className="px-6 md:px-10 pb-3">
        <MonitorStatus />
      </section>

      <section className="px-6 md:px-10 pb-6 grid xl:grid-cols-3 gap-5">
        {/* Left + middle: canvas + voice */}
        <div className="xl:col-span-2 space-y-4">
          {active ? (
            <>
              <div className="card p-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-slate-light">Active workflow</div>
                    <div className="text-ice font-semibold truncate max-w-md">
                      {active.brief?.title || active.normalized?.normalized_drug || active.payload.drug_name || active.workflow_id.slice(0, 8)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill status={active.status} />
                    <Link href={`/workflow/${active.workflow_id}`} className="text-xs text-teal-glow hover:underline">
                      detail →
                    </Link>
                    {active.brief && (
                      <Link href={`/brief/${active.workflow_id}`} className="text-xs text-teal-glow hover:underline">
                        brief →
                      </Link>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-center">
                  <Stat label="Triage" value={active.triage ? `${active.triage.severity} · ${active.triage.severity_score?.toFixed(1)}/10` : '…'} />
                  <Stat label="Cohort" value={active.cohort ? `${active.cohort.patient_count}` : '…'} sub={active.cohort ? `${active.cohort.high_risk_count} high-risk` : ''} />
                  <Stat label="Substitutes" value={active.substitutes?.candidates?.length ? `${active.substitutes.candidates.length}` : '…'} sub={active.substitutes?.recalled_target ? active.substitutes.recalled_target.split(' ')[0] : ''} />
                  <Stat label="Published" value={active.published ? 'live' : 'pending'} sub={active.published?.cited_md_url ? 'cited.md' : ''} />
                </div>
              </div>
              <AgentTheater workflowId={active.workflow_id} />
              <GlobalHotspotMap />
              <VoiceAgent workflowId={active.workflow_id} />
            </>
          ) : (
            <div className="card p-10 text-center text-slate-light text-sm">
              No workflows yet. Trigger one from the landing page (or wait for the autonomous monitor).
            </div>
          )}
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <WalletBadge />
          <ActivityFeed limit={10} />
          <RecentWorkflows />
          <div className="card p-4 text-[11px] text-slate-light leading-relaxed">
            <div className="text-xs uppercase tracking-widest text-slate-light mb-1.5">Sponsor stack</div>
            NimbleWay · Senso · ClickHouse · NVIDIA NIM (Llama 3.3 70B) · NVIDIA BioNeMo (ESM2-650M)
            · Datadog LLM Obs (ddtrace) · x402 / Coinbase CDP · agentic.market
            <div className="mt-2 text-[10px]">
              All triggers, agents, sub-agents, tool calls, payments and publications are visible on this page in real time.
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-ink/40 border border-teal/10 rounded p-2">
      <div className="text-sm text-ice font-semibold tabular-nums truncate">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-slate-light mt-0.5">{label}</div>
      {sub && <div className="text-[9px] text-teal-glow truncate">{sub}</div>}
    </div>
  );
}

function StatusPill({ status }: { status?: string }) {
  const s = status || 'running';
  const palette: Record<string, string> = {
    running: 'bg-warn/20 text-warn border-warn/30',
    completed: 'bg-ok/20 text-ok border-ok/30',
    failed: 'bg-alert/20 text-alert border-alert/30',
  };
  return (
    <span className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${palette[s] || palette.running}`}>
      {s}
    </span>
  );
}
