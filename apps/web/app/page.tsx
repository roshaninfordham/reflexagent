import Link from 'next/link';
import ActivityFeed from '../components/ActivityFeed';
import LaunchDemo from '../components/LaunchDemo';
import MonitorStatus from '../components/MonitorStatus';
import RecentWorkflows from '../components/RecentWorkflows';
import SampleRecallButton from '../components/SampleRecallButton';
import ThemeToggle from '../components/ThemeToggle';
import TriggerPanel from '../components/TriggerPanel';

const SPONSORS = [
  { name: 'NimbleWay', role: 'Web search agents' },
  { name: 'Senso', role: 'Publish to cited.md' },
  { name: 'ClickHouse', role: 'State + traces + audit' },
  { name: 'NVIDIA NIM', role: 'Llama 3.3 70B reasoning' },
  { name: 'NVIDIA BioNeMo', role: 'ESM2 protein embeddings' },
  { name: 'Datadog', role: 'LLM Observability (ddtrace)' },
  { name: 'x402 · Coinbase CDP', role: 'On-chain micropayments' },
];

const STATS = [
  { v: '44–98k', l: 'Americans dying per year from preventable medication errors', src: 'IOM "To Err Is Human" / StatPearls 2024' },
  { v: '456', l: 'non-compounded recalls / U.S. pharmacy / year', src: 'TraceLink 2024' },
  { v: '22 M+', l: 'FAERS adverse-event reports submitted 2012–2024', src: 'FDA FAERS Public Dashboard' },
  { v: '$13.7B', l: 'global pharmacovigilance market today, 16.3% CAGR', src: 'Research and Markets, April 2026' },
];

const AGENTS = [
  { tier: 'Ingest', items: ['Inbound · normalize + dedup', 'Scout · 3× NimbleWay parallel', 'Recon · ClickHouse analogs'] },
  { tier: 'Decide', items: ['Triage · FDA 21 CFR §7.3 rubric', 'Verify + Counter · adversarial', 'Cohort · ClickHouse SQL', 'Substitute · BioNeMo ESM2', 'Routing + Comms · 3 drafts'] },
  { tier: 'Synthesize', items: ['Writer · canonical brief', 'Auditor · HEAD-check citations', 'Publisher · Senso + git mirror'] },
];

export default function HomePage() {
  return (
    <main className="grid-bg min-h-screen">
      <header className="px-6 md:px-10 pt-6 pb-3 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md bg-[var(--bg-1)]/70 border-b border-teal/10">
        <div className="flex items-center gap-3">
          <Mark />
          <div>
            <div className="text-base font-semibold tracking-tight text-ice">Reflex</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-light">
              Autonomous pharmacovigilance agent
            </div>
          </div>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/ops" className="text-ice hover:text-teal-glow hidden sm:inline">Ops</Link>
          <Link href="/premium" className="text-ice hover:text-teal-glow hidden sm:inline">Premium</Link>
          <Link href="/pricing" className="text-ice hover:text-teal-glow hidden sm:inline">Pricing</Link>
          <a href="/docs/pitch/deck.html" target="_blank" className="text-ice hover:text-teal-glow hidden md:inline">Deck</a>
          <a href="https://github.com/roshaninfordham/reflexagent" target="_blank" className="text-slate-light hover:text-ice hidden sm:inline">GitHub</a>
          <ThemeToggle />
          <LaunchDemo label="Launch demo →" className="text-xs" />
        </nav>
      </header>

      {/* Hero */}
      <section className="px-6 md:px-10 pt-10 pb-8 max-w-6xl mx-auto">
        <div className="inline-block text-[10px] uppercase tracking-widest text-teal-glow border border-teal/30 rounded-full px-2.5 py-1">
          Live · 11 agents · 7 sponsors · 0 manual triggers required
        </div>
        <h1 className="font-serif text-4xl md:text-6xl lg:text-7xl leading-[1.02] mt-4 max-w-4xl glow-text">
          FDA's missing nervous system.
        </h1>
        <p className="mt-5 text-base md:text-lg text-slate-light max-w-2xl leading-relaxed">
          Drug recalls in the U.S. still run on faxes. Reflex watches the open web continuously. When a novel recall hits the wire, an 11-agent swarm verifies it across primary sources, runs an <strong className="text-ice">adversarial counter-evidence pass</strong>, identifies affected patients, drafts clinician communications, and ranks therapeutic alternatives using <strong className="text-ice">NVIDIA BioNeMo protein embeddings</strong> — in seconds.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <LaunchDemo label="Launch live demo" />
          <a href="/docs/pitch/deck.html" target="_blank" className="btn">View 3-min pitch deck</a>
          <Link href="/pricing" className="btn">See pricing & cost</Link>
          <a href="https://github.com/roshaninfordham/reflexagent" target="_blank" className="btn">Source on GitHub</a>
        </div>
      </section>

      {/* Live metrics strip */}
      <section className="px-6 md:px-10 pb-8 max-w-6xl mx-auto">
        <MonitorStatus />
      </section>

      {/* Problem */}
      <section className="px-6 md:px-10 py-10 max-w-6xl mx-auto">
        <div className="text-xs uppercase tracking-widest text-slate-light">The problem</div>
        <h2 className="font-serif text-3xl md:text-4xl text-ice mt-2 max-w-3xl">Verification — not detection — is the unsolved problem.</h2>
        <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STATS.map((s) => (
            <div key={s.l} className="card p-5">
              <div className="text-3xl font-semibold text-teal-glow tabular-nums">{s.v}</div>
              <div className="text-sm text-ice/90 mt-1.5 leading-snug">{s.l}</div>
              <div className="text-[10px] text-slate-light mt-3">Source: {s.src}</div>
            </div>
          ))}
        </div>
        <div className="card p-5 mt-5 border-alert/30 bg-alert/5">
          <div className="text-[10px] uppercase tracking-widest text-alert">Why nobody has solved it</div>
          <div className="mt-2 text-base text-ice/95 leading-relaxed italic">
            "Unnecessary and unacceptable patient anxiety generated by false-positive notifications."
          </div>
          <div className="text-xs text-slate-light mt-1">— Mass General Brigham, on why they abandoned automated recall notifications in 2024. <span className="text-teal-glow">medRxiv 2024.09.18</span></div>
        </div>
      </section>

      {/* Solution / how it works */}
      <section className="px-6 md:px-10 py-10 max-w-6xl mx-auto">
        <div className="text-xs uppercase tracking-widest text-slate-light">The solution</div>
        <h2 className="font-serif text-3xl md:text-4xl text-ice mt-2 max-w-3xl">An 11-agent swarm with an adversarial counter-evidence pass.</h2>
        <div className="mt-6 grid md:grid-cols-3 gap-4">
          {AGENTS.map((tier) => (
            <div key={tier.tier} className="card p-5">
              <div className="text-[11px] uppercase tracking-widest text-teal-glow mb-2">{tier.tier}</div>
              <ul className="space-y-2 text-sm text-ice/90">
                {tier.items.map((it) => <li key={it}>· {it}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-5 text-xs text-slate-light">
          Phases run with <code className="text-teal-glow">asyncio.gather</code> where independent. Every step writes a span to ClickHouse <code>agent_traces</code> AND streams via SSE to the Canvas Agent Theater — so every action is auditable and visible in real time.
        </div>
      </section>

      {/* Sponsors */}
      <section className="px-6 md:px-10 py-10 max-w-6xl mx-auto">
        <div className="text-xs uppercase tracking-widest text-slate-light">Sponsor stack · every one doing real work</div>
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {SPONSORS.map((s) => (
            <div key={s.name} className="card p-4">
              <div className="text-sm font-semibold text-ice">{s.name}</div>
              <div className="text-[11px] text-slate-light mt-0.5">{s.role}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Live status: ops link + activity */}
      <section className="px-6 md:px-10 py-10 max-w-6xl mx-auto grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <TriggerPanel />
          <SampleRecallButton />
        </div>
        <div className="space-y-5">
          <RecentWorkflows />
          <ActivityFeed limit={10} />
        </div>
      </section>

      <footer className="px-6 md:px-10 pb-10 max-w-6xl mx-auto text-[11px] text-slate-light flex flex-wrap items-center justify-between gap-3">
        <span>Reflex · open source · MIT</span>
        <span><Link href="/pricing" className="hover:text-teal-glow">Pricing & live cost telemetry</Link> · <a href="/docs/pitch/deck.html" target="_blank" className="hover:text-teal-glow">3-min pitch deck</a> · <a href="https://github.com/roshaninfordham/reflexagent" target="_blank" className="hover:text-teal-glow">GitHub</a></span>
      </footer>
    </main>
  );
}

function Mark() {
  return (
    <div className="w-10 h-10 rounded-md bg-gradient-to-br from-teal to-teal-dark flex items-center justify-center" style={{boxShadow:'0 0 24px rgba(20,184,166,0.4)'}}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M3 12 L8 12 L10 7 L14 17 L16 12 L21 12" stroke="#06101F" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}
