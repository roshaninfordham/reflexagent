'use client';

import LaunchDemo from './LaunchDemo';
import Link from 'next/link';

export default function ClosingCTA() {
  return (
    <section className="px-6 md:px-10 py-16 max-w-5xl mx-auto text-center">
      <div className="card p-10 relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none opacity-30"
          style={{ background: 'radial-gradient(circle at 50% 0%, rgba(20,184,166,0.35), transparent 65%)' }}
        />
        <div className="relative">
          <div className="text-[10px] uppercase tracking-widest text-teal-glow">No installs · No signup · Live data</div>
          <h2 className="font-serif text-3xl md:text-5xl text-ice mt-3 glow-text leading-tight">
            Watch an autonomous swarm verify, route, and publish a real FDA recall — right now.
          </h2>
          <p className="text-sm md:text-base text-slate-light mt-4 max-w-2xl mx-auto">
            One click fires the curated metformin demo. Eleven agents traverse the canvas in front of you,
            counter-evidence flashes red when surfaced, the cohort lights up on the map, and a cited brief
            ships to GitHub-published cited.md in under 60 seconds.
          </p>
          <div className="mt-7 flex items-center justify-center gap-3 flex-wrap">
            <LaunchDemo label="Launch live demo →" />
            <Link href="/historical" className="btn">Browse historical recalls</Link>
            <a href="https://github.com/roshaninfordham/reflexagent" target="_blank" className="btn">Source on GitHub</a>
          </div>
          <div className="mt-6 text-[10px] text-slate-light">
            MIT licensed · Open source · Every reference traceable to a primary FDA / EMA / PubMed source
          </div>
        </div>
      </div>
    </section>
  );
}
