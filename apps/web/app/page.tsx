import Link from 'next/link';
import ActivityFeed from '../components/ActivityFeed';
import MonitorStatus from '../components/MonitorStatus';
import RecentWorkflows from '../components/RecentWorkflows';
import TriggerPanel from '../components/TriggerPanel';

export default function HomePage() {
  return (
    <main className="grid-bg min-h-screen">
      <header className="px-6 md:px-10 pt-8 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Mark />
          <div>
            <div className="text-xl font-semibold tracking-tight text-ice">Reflex</div>
            <div className="text-[11px] uppercase tracking-widest text-slate-light">
              Autonomous Pharmacovigilance Agent
            </div>
          </div>
        </div>
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/" className="text-ice hover:text-teal-glow">Live</Link>
          <Link href="/ops" className="text-ice hover:text-teal-glow">Ops</Link>
          <Link href="/premium" className="text-ice hover:text-teal-glow">Premium</Link>
          <a
            href="https://github.com/roshaninfordham/reflexagent"
            target="_blank"
            className="text-slate-light hover:text-ice"
          >GitHub</a>
        </nav>
      </header>

      <section className="px-6 md:px-10 pt-2 pb-10">
        <h1 className="font-serif text-3xl md:text-5xl leading-tight max-w-3xl glow-text">
          FDA's missing nervous system.
        </h1>
        <p className="mt-3 text-slate-light max-w-2xl">
          Reflex watches the open web continuously. When a novel drug recall hits the wire,
          a 10-agent swarm verifies it across primary sources, runs an adversarial
          counter-evidence pass, identifies affected patients, drafts clinician
          communications, and publishes a cited brief — in seconds.
        </p>
      </section>

      <section className="px-6 md:px-10 pb-12 grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <MonitorStatus />
          <TriggerPanel />
        </div>
        <div className="space-y-5">
          <RecentWorkflows />
          <ActivityFeed limit={14} />
        </div>
      </section>

      <footer className="px-6 md:px-10 pb-10 text-[11px] text-slate-light">
        Reflex · sources: NimbleWay (web), Senso (publish), ClickHouse (state),
        x402 / Coinbase CDP (payments), agentic.market (discovery),
        Datadog LLM Observability (lapdog auto-instrumentation).
      </footer>
    </main>
  );
}

function Mark() {
  return (
    <div className="w-10 h-10 rounded-md bg-gradient-to-br from-teal to-teal-dark flex items-center justify-center shadow-glow">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M3 12 L8 12 L10 7 L14 17 L16 12 L21 12" stroke="#06101F" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}
