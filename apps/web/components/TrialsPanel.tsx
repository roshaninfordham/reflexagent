'use client';

/** Live ClinicalTrials.gov v2 cross-reference. Free open data, no API key. */

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type Trial = {
  nct_id: string;
  title: string;
  status: string;
  phases: string[];
  conditions: string[];
  interventions: string[];
  start_date?: string;
  completion_date?: string;
  sponsor?: string;
  url: string;
};

const STATUS_COLOR: Record<string, string> = {
  'RECRUITING': 'text-ok border-ok/40',
  'ACTIVE_NOT_RECRUITING': 'text-teal-glow border-teal/40',
  'COMPLETED': 'text-slate-light border-teal/20',
  'TERMINATED': 'text-alert border-alert/40',
  'WITHDRAWN': 'text-alert border-alert/40',
  'SUSPENDED': 'text-warn border-warn/40',
  'NOT_YET_RECRUITING': 'text-warn border-warn/40',
};

export default function TrialsPanel({ drugName }: { drugName: string }) {
  const [items, setItems] = useState<Trial[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true); setErr(null); setItems([]);
    (async () => {
      try {
        const r = await api<{ count: number; items: Trial[] }>(`/api/v1/trials?term=${encodeURIComponent(drugName)}&limit=8`);
        if (mounted) { setItems(r.items || []); setLoading(false); }
      } catch (e: any) {
        if (mounted) { setErr(e?.message || 'failed'); setLoading(false); }
      }
    })();
    return () => { mounted = false; };
  }, [drugName]);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-xs uppercase tracking-widest text-slate-light">ClinicalTrials.gov · active studies</div>
        <span className="text-[11px] text-slate-light">{items.length} trial{items.length !== 1 ? 's' : ''} matching "{drugName}"</span>
      </div>
      {loading && <div className="text-xs text-slate-light italic">Searching ClinicalTrials.gov…</div>}
      {err && <div className="text-xs text-alert">{err}</div>}
      {!loading && items.length === 0 && !err && (
        <div className="text-xs text-slate-light italic">No active or recent trials for this drug name.</div>
      )}
      <ul className="space-y-2.5">
        {items.map((t) => (
          <li key={t.nct_id} className="border-l-2 border-teal/30 pl-3 py-1">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <a href={t.url} target="_blank" className="text-sm text-teal-glow hover:underline font-medium">
                {t.title}
              </a>
              <div className="flex items-center gap-1.5 shrink-0">
                {t.phases.slice(0, 2).map((p) => (
                  <span key={p} className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full border border-teal/20 text-ice/80">
                    {p.replace('PHASE', 'P')}
                  </span>
                ))}
                <span className={`text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${STATUS_COLOR[t.status] || 'border-teal/20 text-ice/80'}`}>
                  {t.status?.replaceAll('_', ' ')}
                </span>
              </div>
            </div>
            <div className="text-[10px] text-slate-light mt-1">
              <span className="font-mono text-ice/60">{t.nct_id}</span>
              {t.sponsor && <> · {t.sponsor}</>}
              {t.start_date && <> · start {t.start_date}</>}
            </div>
            {t.conditions.length > 0 && (
              <div className="text-[11px] text-ice/75 mt-1">
                <span className="text-slate-light text-[9px] uppercase tracking-widest mr-1">conditions:</span>
                {t.conditions.slice(0, 3).join(', ')}
              </div>
            )}
            {t.interventions.length > 0 && (
              <div className="text-[11px] text-ice/75">
                <span className="text-slate-light text-[9px] uppercase tracking-widest mr-1">interventions:</span>
                {t.interventions.slice(0, 3).join(', ')}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="text-[10px] text-slate-light mt-3">
        Live from clinicaltrials.gov v2 API (free, no key). Click any title to open the study on ClinicalTrials.gov.
      </div>
    </div>
  );
}
