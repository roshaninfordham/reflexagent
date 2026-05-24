'use client';

import Link from 'next/link';

const SEGMENTS = [
  {
    label: 'Pharmacy directors & P&T chairs',
    role: 'For hospital pharmacy ops',
    pain: 'You receive faxed recalls and burn 1–3 FTEs per recall sorting lots and notifying patients. Reflex auto-drafts the pharmacist memo, clinician alert, and patient letter — and gives you the affected cohort by ZIP-3 in under a minute.',
    cta: 'See a hospital workflow',
    href: '/ops',
  },
  {
    label: 'Pharma compliance & MSLs',
    role: 'For biopharma pharmacovigilance',
    pain: 'You watch 47 tabs across FAERS, MAUDE, EMA EudraVigilance, MHRA, Health Canada. Reflex monitors them continuously, runs an adversarial counter-evidence pass on every signal, and publishes a verified daily brief per drug.',
    cta: 'See the counter-evidence demo',
    href: '/historical/valsartan-2018',
  },
  {
    label: 'Investigative journalists & researchers',
    role: 'For STAT / ProPublica / academic work',
    pain: 'You spend weeks reconstructing what the FDA missed and when. Reflex publishes every verified safety signal to cited.md with primary-source citations on the open web — pay $0.50 via x402 for any subgroup or formulary deep-dive.',
    cta: 'Browse historical recalls',
    href: '/historical',
  },
];

export default function WhoIsThisFor() {
  return (
    <section className="px-6 md:px-10 py-10 max-w-6xl mx-auto">
      <div className="text-xs uppercase tracking-widest text-slate-light">Who Reflex is for</div>
      <h2 className="font-serif text-2xl md:text-3xl text-ice mt-1 max-w-3xl">
        Built for the three people who get paged when a recall hits.
      </h2>
      <div className="mt-6 grid md:grid-cols-3 gap-4">
        {SEGMENTS.map((s) => (
          <div key={s.label} className="card p-5 flex flex-col">
            <div className="text-[10px] uppercase tracking-widest text-teal-glow">{s.role}</div>
            <div className="text-base font-semibold text-ice mt-1.5">{s.label}</div>
            <p className="text-xs text-ice/80 leading-relaxed mt-3 flex-1">{s.pain}</p>
            <Link href={s.href} className="btn text-xs mt-4 self-start">{s.cta} →</Link>
          </div>
        ))}
      </div>
    </section>
  );
}
