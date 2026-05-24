import Link from 'next/link';
import ClosingCTA from '../components/ClosingCTA';
import HowItWorks from '../components/HowItWorks';
import LaunchDemo from '../components/LaunchDemo';
import MiniSwarmAnimation from '../components/MiniSwarmAnimation';
import MonitorStatus from '../components/MonitorStatus';
import ThemeToggle from '../components/ThemeToggle';
import TrustStrip from '../components/TrustStrip';
import WhoIsThisFor from '../components/WhoIsThisFor';

const STATS = [
  { v: '44–98k',  l: 'Americans dying per year from preventable medication errors', src: 'IOM "To Err Is Human" · StatPearls 2024' },
  { v: '456',     l: 'non-compounded recalls per U.S. pharmacy per year',           src: 'TraceLink 2024' },
  { v: '22 M+',   l: 'FAERS adverse-event reports submitted 2012–2024',             src: 'FDA FAERS Public Dashboard' },
  { v: '$13.7B',  l: 'global pharmacovigilance market today · 16.3% CAGR',         src: 'Research and Markets, April 2026' },
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
              Autonomous pharmacovigilance
            </div>
          </div>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/ops"        className="text-ice hover:text-teal-glow hidden sm:inline">Ops</Link>
          <Link href="/historical" className="text-ice hover:text-teal-glow hidden md:inline">Historical</Link>
          <Link href="/premium"    className="text-ice hover:text-teal-glow hidden sm:inline">Premium</Link>
          <Link href="/pricing"    className="text-ice hover:text-teal-glow hidden sm:inline">Pricing</Link>
          <a href="/docs/pitch/deck.html" target="_blank" className="text-ice hover:text-teal-glow hidden md:inline">Deck</a>
          <a href="https://github.com/roshaninfordham/reflexagent" target="_blank" className="text-slate-light hover:text-ice hidden sm:inline">GitHub</a>
          <ThemeToggle />
          <LaunchDemo label="Launch demo →" className="text-xs" />
        </nav>
      </header>

      {/* HERO — outcome-led headline, animated swarm right of fold */}
      <section className="px-6 md:px-10 pt-12 pb-6 max-w-6xl mx-auto grid lg:grid-cols-5 gap-10 items-center">
        <div className="lg:col-span-3">
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest text-teal-glow border border-teal/30 rounded-full px-2.5 py-1">
            <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-ok">
              <span className="absolute inline-flex h-full w-full rounded-full bg-ok opacity-60 animate-ping" />
            </span>
            Live — autonomous monitor active right now
          </div>
          <h1 className="font-serif text-4xl md:text-6xl lg:text-[68px] leading-[1.02] mt-5 max-w-4xl glow-text tracking-tight">
            Verified drug recalls in <em className="not-italic text-teal-glow">60 seconds</em>, not 60 days.
          </h1>
          <p className="mt-5 text-base md:text-lg text-slate-light max-w-2xl leading-relaxed">
            Reflex is FDA's missing nervous system — an always-on agent swarm that verifies every recall across
            primary sources, runs an <strong className="text-ice">adversarial counter-evidence pass</strong>, identifies
            affected patients, drafts clinician communications, and ranks therapeutic substitutes by molecular target
            similarity. All before the first fax is even read.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <LaunchDemo label="Launch live demo →" />
            <a href="/docs/pitch/deck.html" target="_blank" className="btn">3-min pitch deck</a>
            <Link href="/historical" className="btn">Replay a famous past recall</Link>
            <a href="https://github.com/roshaninfordham/reflexagent" target="_blank" className="btn">Source on GitHub</a>
          </div>
        </div>
        <div className="lg:col-span-2">
          <MiniSwarmAnimation />
          <div className="text-[10px] text-slate-light mt-2 text-center">
            Live animated preview · the real Canvas Agent Theater is one click away
          </div>
        </div>
      </section>

      <TrustStrip />

      {/* Monitor strip — the proof that something is happening RIGHT NOW */}
      <section className="px-6 md:px-10 pt-4 pb-6 max-w-6xl mx-auto">
        <MonitorStatus />
      </section>

      {/* Problem */}
      <section className="px-6 md:px-10 py-10 max-w-6xl mx-auto">
        <div className="text-xs uppercase tracking-widest text-slate-light">The problem</div>
        <h2 className="font-serif text-3xl md:text-4xl text-ice mt-2 max-w-3xl">
          Verification — not detection — is the unsolved problem.
        </h2>
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
          <div className="text-xs text-slate-light mt-1">
            — Mass General Brigham, on why they abandoned automated recall notifications in 2024. <span className="text-teal-glow">medRxiv 2024.09.18</span>
          </div>
        </div>
      </section>

      <WhoIsThisFor />

      <HowItWorks />

      <ClosingCTA />

      <footer className="px-6 md:px-10 pb-10 max-w-6xl mx-auto text-[11px] text-slate-light flex flex-wrap items-center justify-between gap-3">
        <span>Reflex · open source · MIT</span>
        <span>
          <Link href="/pricing" className="hover:text-teal-glow">Pricing & live cost telemetry</Link>{' · '}
          <a href="/docs/pitch/deck.html" target="_blank" className="hover:text-teal-glow">3-min pitch deck</a>{' · '}
          <a href="https://github.com/roshaninfordham/reflexagent" target="_blank" className="hover:text-teal-glow">GitHub</a>
        </span>
      </footer>
    </main>
  );
}

function Mark() {
  return (
    <div className="w-10 h-10 rounded-md bg-gradient-to-br from-teal to-teal-dark flex items-center justify-center" style={{ boxShadow: '0 0 24px rgba(20,184,166,0.4)' }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M3 12 L8 12 L10 7 L14 17 L16 12 L21 12" stroke="#06101F" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}
