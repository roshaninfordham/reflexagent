'use client';

/** Sponsor / data-source trust strip. Brand-colored type instead of logos. */

const SOURCES = [
  { name: 'NVIDIA',     color: '#76B900' },
  { name: 'BioNeMo',    color: '#76B900' },
  { name: 'NimbleWay',  color: '#FF6B35' },
  { name: 'Senso',      color: '#FFD60A' },
  { name: 'ClickHouse', color: '#FAFF69' },
  { name: 'Datadog',    color: '#632CA6' },
  { name: 'Coinbase',   color: '#0052FF' },
  { name: 'openFDA',    color: '#5EEAD4' },
  { name: 'AlphaFold',  color: '#5EEAD4' },
  { name: 'PubChem',    color: '#5EEAD4' },
  { name: 'RDKit',      color: '#5EEAD4' },
];

export default function TrustStrip() {
  return (
    <div className="px-6 md:px-10 py-4 max-w-6xl mx-auto">
      <div className="text-[10px] uppercase tracking-widest text-slate-light mb-2">
        Live, verified, agent-discoverable — backed by
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {SOURCES.map((s) => (
          <span
            key={s.name}
            className="text-sm font-semibold tracking-tight"
            style={{ color: s.color }}
          >
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
