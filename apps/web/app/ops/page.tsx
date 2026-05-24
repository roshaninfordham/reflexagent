'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import ActivityFeed from '../../components/ActivityFeed';
import AgentTheater from '../../components/AgentTheater';
import BriefSummaryCard from '../../components/BriefSummaryCard';
import FloatingVoiceAgent from '../../components/FloatingVoiceAgent';
import GlobalHotspotMap from '../../components/GlobalHotspotMap';
import LaunchDemo from '../../components/LaunchDemo';
import MonitorStatus from '../../components/MonitorStatus';
import RecentWorkflows from '../../components/RecentWorkflows';
import ThemeToggle from '../../components/ThemeToggle';
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
  verification?: { verdict: string; counter_evidence?: any[]; conflict_summary?: string | null } | null;
  brief?: { title: string; summary?: string; findings?: string[]; severity_score?: number; citations?: { title: string; url: string }[] } | null;
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
        let pick = preferred ? xs.find((w) => w.workflow_id === preferred) : null;
        if (!pick) pick = xs.find((w) => w.status === 'running') || null;
        if (!pick) pick = xs.find((w) => w.status === 'completed') || null;
        if (!pick) pick = xs[0] || null;
        setActive((prev) => {
          if (preferred && pick && (!prev || prev.workflow_id !== preferred)) return pick;
          return prev || pick;
        });
      } catch {}
    };
    load();
    const i = setInterval(load, 2500);
    return () => { mounted = false; clearInterval(i); };
  }, [preferred]);

  // Live counts for the page title
  const counts = useMemo(() => {
    const running = stack.filter((w) => w.status === 'running').length;
    const completed = stack.filter((w) => w.status === 'completed').length;
    const failed = stack.filter((w) => w.status === 'failed').length;
    const watchPatients = stack.reduce((acc, w) => acc + (w.cohort?.patient_count || 0), 0);
    return { running, completed, failed, watchPatients };
  }, [stack]);

  const conflictBanner =
    active?.verification?.verdict === 'requires_human' && active.verification?.conflict_summary
      ? active.verification.conflict_summary
      : null;

  return (
    <main className="grid-bg min-h-screen">
      <header className="px-6 md:px-10 pt-6 pb-3 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md bg-[var(--bg-1)]/70 border-b border-teal/10">
        <div>
          <Link href="/" className="text-[10px] uppercase tracking-widest text-slate-light hover:text-teal-glow">← landing</Link>
          <h1 className="text-xl font-semibold text-ice mt-0.5 leading-tight">Mission Control</h1>
          <div className="text-[11px] text-slate-light mt-0.5">
            <span className="text-teal-glow tabular-nums font-semibold">{counts.running}</span> running ·{' '}
            <span className="text-teal-glow tabular-nums font-semibold">{counts.completed}</span> verified ·{' '}
            <span className="text-ice tabular-nums font-semibold">{counts.watchPatients}</span> patients on watch
            {counts.failed > 0 && <> · <span className="text-alert tabular-nums">{counts.failed}</span> failed</>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href={DD_DASHBOARD} target="_blank" className="btn text-xs py-1.5 px-3">Datadog LLM Obs ↗</a>
          <ThemeToggle />
          <LaunchDemo label="New demo workflow" className="text-xs py-1.5 px-3" />
          <Link href="/premium" className="btn btn-primary text-xs py-1.5 px-3">Pay $0.50 sub-brief</Link>
        </div>
      </header>

      {/* Conflict banner — appears when Verify+Counter surfaces a contradiction */}
      {conflictBanner && (
        <section className="px-6 md:px-10 pt-4">
          <div className="max-w-6xl mx-auto card border-alert/40 bg-alert/10 p-4 flex items-start gap-3">
            <div className="text-alert text-lg leading-none mt-0.5">⚠</div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-alert font-semibold">Counter-evidence surfaced — held for human review</div>
              <div className="text-sm text-ice/95 mt-1">{conflictBanner}</div>
            </div>
            {active && (
              <Link href={`/workflow/${active.workflow_id}`} className="btn text-xs whitespace-nowrap shrink-0">Review →</Link>
            )}
          </div>
        </section>
      )}

      <section className="px-6 md:px-10 pb-3 pt-4 max-w-6xl mx-auto">
        <MonitorStatus />
      </section>

      <section className="px-6 md:px-10 pb-6 max-w-6xl mx-auto grid xl:grid-cols-3 gap-5">
        {/* Left + middle: canvas + brief */}
        <div className="xl:col-span-2 space-y-4">
          {active ? (
            <>
              <ActiveWorkflowHeader active={active} />
              <BriefSummaryCard
                workflowId={active.workflow_id}
                brief={active.brief || null}
                citedUrl={active.published?.cited_md_url}
                counterEvidenceCount={active.verification?.counter_evidence?.length || 0}
              />
              <AgentTheater workflowId={active.workflow_id} />
              <GlobalHotspotMap />
            </>
          ) : (
            <EmptyState />
          )}
        </div>

        {/* Right rail — reordered: map → activity → workflows → wallet */}
        <div className="space-y-4">
          <ActivityFeed limit={10} />
          <RecentWorkflows />
          <WalletBadge />
          <div className="card p-4 text-[11px] text-slate-light leading-relaxed">
            <div className="text-[10px] uppercase tracking-widest text-slate-light mb-1.5">Keyboard</div>
            Press <kbd className="px-1.5 py-0.5 rounded bg-ink/60 border border-teal/20 text-ice font-mono text-[10px]">V</kbd> to talk to the voice agent · <kbd className="px-1.5 py-0.5 rounded bg-ink/60 border border-teal/20 text-ice font-mono text-[10px]">Esc</kbd> to close.
          </div>
        </div>
      </section>

      {/* Floating voice agent — always reachable */}
      <FloatingVoiceAgent workflowId={active?.workflow_id} />
    </main>
  );
}

function ActiveWorkflowHeader({ active }: { active: WF }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-slate-light">Active workflow</div>
          <div className="text-ice font-semibold truncate max-w-2xl text-base">
            {active.brief?.title || active.normalized?.normalized_drug || active.payload.drug_name || active.workflow_id.slice(0, 8)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={active.status} />
          <Link href={`/workflow/${active.workflow_id}`} className="text-xs text-teal-glow hover:underline">detail →</Link>
          {active.brief && (
            <Link href={`/brief/${active.workflow_id}`} className="text-xs text-teal-glow hover:underline">brief →</Link>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat
          label="Triage"
          value={active.triage ? `Class ${active.triage.severity}` : '—'}
          sub={active.triage ? `${active.triage.severity_score?.toFixed(1)}/10 · ${active.triage.urgency}` : ''}
        />
        <Stat
          label="Cohort"
          value={active.cohort ? `${active.cohort.patient_count} patients` : '—'}
          sub={active.cohort ? `${active.cohort.high_risk_count} high-risk` : ''}
        />
        <Stat
          label="Substitutes"
          value={active.substitutes?.candidates?.length ? `${active.substitutes.candidates.length} ranked` : '—'}
          sub={active.substitutes?.recalled_target ? active.substitutes.recalled_target.split(' ')[0] : ''}
        />
        <Stat
          label="Published"
          value={active.published ? 'live' : 'pending'}
          sub={active.published?.cited_md_url ? 'cited.md' : ''}
          accent={!!active.published}
        />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card p-10 text-center">
      <div className="text-5xl mb-4 opacity-30">⌬</div>
      <h2 className="font-serif text-2xl text-ice">No active workflow yet.</h2>
      <p className="text-sm text-slate-light mt-2 max-w-md mx-auto">
        Reflex's autonomous monitor is polling OpenFDA every 60 seconds. Or fire a curated demo now —
        the 11-agent swarm completes a full verified brief in about a minute.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <LaunchDemo label="Launch demo workflow →" />
        <Link href="/historical" className="btn">Replay a famous past recall</Link>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-ink/40 border border-teal/10 rounded p-2.5">
      <div className="text-[9px] uppercase tracking-widest text-slate-light">{label}</div>
      <div className={`text-sm font-semibold tabular-nums mt-0.5 ${accent ? 'text-teal-glow' : 'text-ice'}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-light truncate">{sub}</div>}
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
