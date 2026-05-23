'use client';

/** RDKit Tanimoto similarity over a curated corpus of approved drugs. */

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type Match = { drug: string; drug_class: string; smiles: string; tanimoto: number };
type Resp = {
  drug: string;
  found: boolean;
  corpus_size?: number;
  method?: string;
  matches: Match[];
};

function tanimotoColor(t: number): string {
  if (t >= 0.85) return 'text-ok';
  if (t >= 0.5) return 'text-teal-glow';
  if (t >= 0.3) return 'text-warn';
  return 'text-slate-light';
}

export default function SimilarityPanel({ drugName }: { drugName: string }) {
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setData(null); setErr(null);
    (async () => {
      try {
        const r = await api<Resp>(`/api/v1/similar?drug=${encodeURIComponent(drugName)}&limit=6`);
        if (mounted) setData(r);
      } catch (e: any) { if (mounted) setErr(e?.message || 'failed'); }
    })();
    return () => { mounted = false; };
  }, [drugName]);

  if (err) return <div className="card p-4 text-xs text-alert">Similarity: {err}</div>;
  if (!data) return <div className="card p-4 text-xs text-slate-light">Computing Tanimoto similarity…</div>;
  if (!data.found || data.matches.length === 0) {
    return (
      <div className="card p-4">
        <div className="text-xs uppercase tracking-widest text-slate-light">Structural similarity · RDKit Tanimoto</div>
        <div className="text-xs text-slate-light italic mt-2">No SMILES resolved for "{drugName}" — similarity search skipped.</div>
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-xs uppercase tracking-widest text-slate-light">Structural similarity · RDKit Tanimoto</div>
        <span className="text-[11px] text-slate-light">vs {data.corpus_size} approved drugs</span>
      </div>
      <ul className="space-y-2">
        {data.matches.map((m, i) => (
          <li key={i} className="flex items-center justify-between gap-3 border-l-2 border-teal/20 pl-3 py-1">
            <div className="min-w-0">
              <div className="text-sm text-ice font-medium">{m.drug}</div>
              <div className="text-[10px] text-slate-light">{m.drug_class}</div>
            </div>
            <div className={`text-sm tabular-nums font-mono ${tanimotoColor(m.tanimoto)}`}>
              {m.tanimoto.toFixed(3)}
            </div>
          </li>
        ))}
      </ul>
      <div className="text-[10px] text-slate-light mt-3">
        {data.method}. Higher Tanimoto = more structurally similar.
        Use ≥0.85 as the high-confidence threshold for pharmacological repurposing.
      </div>
    </div>
  );
}
