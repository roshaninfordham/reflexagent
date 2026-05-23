'use client';

/**
 * Drug-drug interaction matrix — runs the recalled drug against each
 * Substitute candidate via the openFDA Drug Label endpoint and surfaces
 * any pairwise interaction warnings. Open source (openFDA = public US gov).
 */

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type Pair = {
  drug_a: string;
  drug_b: string;
  severity: 'none' | 'moderate' | 'severe';
  hits_in_a_label: string[];
  hits_in_b_label: string[];
  label_a: { found: boolean; manufacturer?: string };
  label_b: { found: boolean; manufacturer?: string };
};

const SEV_COLOR: Record<string, string> = {
  none: 'text-ok',
  moderate: 'text-warn',
  severe: 'text-alert',
};
const SEV_LABEL: Record<string, string> = {
  none: 'no warning surfaced',
  moderate: 'moderate',
  severe: 'severe',
};

export default function InteractionsPanel({
  recalledDrug,
  substitutes,
}: {
  recalledDrug: string;
  substitutes: { drug: string }[];
}) {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPairs([]);
    (async () => {
      const top = substitutes.slice(0, 3);
      const results: Pair[] = [];
      for (const s of top) {
        try {
          const p = await api<Pair>(
            `/api/v1/interactions/check?drug_a=${encodeURIComponent(recalledDrug)}&drug_b=${encodeURIComponent(s.drug)}`
          );
          if (cancelled) return;
          results.push(p);
          setPairs([...results]);
        } catch {}
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [recalledDrug, substitutes]);

  if (!substitutes.length) return null;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-widest text-slate-light">
          Drug-drug interactions · openFDA labels
        </div>
        <div className="text-[10px] text-slate-light">
          recalled drug × each substitute
        </div>
      </div>
      {loading && pairs.length === 0 && (
        <div className="text-xs text-slate-light italic">Querying FDA Structured Product Labels…</div>
      )}
      <ul className="space-y-3">
        {pairs.map((p, i) => (
          <li key={i} className="border-l-2 pl-3 py-1" style={{ borderColor: SEV_COLOR[p.severity] === 'text-ok' ? '#10B981' : SEV_COLOR[p.severity] === 'text-warn' ? '#F59E0B' : '#EF4444' }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-ice">
                <span className="text-slate-light">{recalledDrug}</span> ×{' '}
                <span className="text-teal-glow">{p.drug_b}</span>
              </span>
              <span className={`text-[10px] uppercase tracking-widest ${SEV_COLOR[p.severity]}`}>
                {SEV_LABEL[p.severity]}
              </span>
            </div>
            {p.hits_in_a_label.length > 0 && (
              <div className="text-[11px] text-ice/85 mb-1">
                <span className="text-slate-light text-[9px] uppercase tracking-widest">From {recalledDrug} label:</span>
                <ul className="ml-3 list-disc">
                  {p.hits_in_a_label.slice(0, 2).map((h, j) => <li key={j}>{h}</li>)}
                </ul>
              </div>
            )}
            {p.hits_in_b_label.length > 0 && (
              <div className="text-[11px] text-ice/85">
                <span className="text-slate-light text-[9px] uppercase tracking-widest">From {p.drug_b} label:</span>
                <ul className="ml-3 list-disc">
                  {p.hits_in_b_label.slice(0, 2).map((h, j) => <li key={j}>{h}</li>)}
                </ul>
              </div>
            )}
            {p.severity === 'none' && (
              <div className="text-[11px] text-slate-light italic">
                No pairwise warning surfaced in either SPL drug_interactions or warnings sections.
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="text-[10px] text-slate-light mt-3">
        Cross-references the FDA Structured Product Label for each drug pair via openFDA.
        Severity is a heuristic over keywords like "contraindicated", "avoid",
        "fatal", "hypoglycemia", "increase risk".
      </div>
    </div>
  );
}
