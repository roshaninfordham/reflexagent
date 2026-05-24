'use client';

const STEPS = [
  {
    n: '01',
    title: 'Signal arrives',
    body: 'A recall hits the OpenFDA wire (or a fax / email / RSS feed). Reflex sees it within 60 seconds — no human action required.',
  },
  {
    n: '02',
    title: 'Swarm fires',
    body: '11 specialized agents run in parallel: web search across FDA / EMA / PubMed, FDA-class triage, ClickHouse cohort SQL, BioNeMo protein-similarity ranking of substitutes.',
  },
  {
    n: '03',
    title: 'Counter-evidence pass',
    body: 'An adversarial agent hunts manufacturer rebuttals + regulator clarifications. Conflicts surface as red events — never silently broadcast.',
  },
  {
    n: '04',
    title: 'Routed & published',
    body: 'Three role-specific drafts (pharmacist / clinician / patient) ready for review. Cited brief shipped to cited.md. Every action audit-logged in ClickHouse.',
  },
];

export default function HowItWorks() {
  return (
    <section className="px-6 md:px-10 py-10 max-w-6xl mx-auto">
      <div className="text-xs uppercase tracking-widest text-slate-light">How it works · 60 seconds, autonomously</div>
      <h2 className="font-serif text-2xl md:text-3xl text-ice mt-1 max-w-3xl">
        From fax to verified clinical workflow, while you're refilling coffee.
      </h2>
      <div className="mt-6 grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        {STEPS.map((s) => (
          <div key={s.n} className="card p-5">
            <div className="text-[10px] font-mono text-teal-glow">{s.n}</div>
            <div className="text-base font-semibold text-ice mt-1.5">{s.title}</div>
            <p className="text-xs text-ice/80 leading-relaxed mt-2.5">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
