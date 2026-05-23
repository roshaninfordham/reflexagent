'use client';

/**
 * Sources & Documents panel — every reference the agents gathered for a
 * workflow, grouped by source. Lets the user go back to original FDA / EMA /
 * PubMed / manufacturer documents to verify every claim in the brief.
 */

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type DocItem = {
  title: string; url: string; snippet?: string;
  date?: string; accessed_at?: string; source?: string; type?: string;
};
type Resp = {
  workflow_id: string;
  drug: string | null;
  grouped: Record<string, DocItem[]>;
  total: number;
};

const GROUP_META: Record<string, { label: string; color: string; icon: string }> = {
  fda: { label: 'FDA', color: 'text-teal-glow', icon: '◆' },
  ema: { label: 'EMA', color: 'text-warn', icon: '◆' },
  pubmed: { label: 'PubMed', color: 'text-ice', icon: '◆' },
  counter: { label: 'Counter-evidence', color: 'text-alert', icon: '◆' },
  audit_verified: { label: 'Audit-verified citations', color: 'text-ok', icon: '✓' },
  published: { label: 'Reflex published brief', color: 'text-teal-glow', icon: '↗' },
};

export default function DocumentsPanel({ workflowId }: { workflowId: string }) {
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const r = await api<Resp>(`/api/v1/workflow/${workflowId}/documents`);
        if (mounted) setData(r);
      } catch (e: any) { if (mounted) setErr(e?.message || 'failed'); }
    };
    load();
    const i = setInterval(load, 5000);
    return () => { mounted = false; clearInterval(i); };
  }, [workflowId]);

  if (err) return <div className="text-xs text-alert">Documents: {err}</div>;
  if (!data) return <div className="card p-4 text-xs text-slate-light">Loading sources…</div>;

  const groups = Object.entries(data.grouped).filter(([_, v]) => (v || []).length > 0);
  if (groups.length === 0) {
    return (
      <div className="card p-4">
        <div className="text-xs uppercase tracking-widest text-slate-light mb-1">Sources & documents</div>
        <div className="text-xs text-slate-light italic">No agent-gathered documents yet — Scout + Verify will populate this as the workflow runs.</div>
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-xs uppercase tracking-widest text-slate-light">Sources & documents · agent-gathered</div>
        <div className="text-[11px] text-slate-light tabular-nums">
          <span className="text-teal-glow font-semibold">{data.total}</span> reference{data.total !== 1 ? 's' : ''}
        </div>
      </div>
      <div className="space-y-4">
        {groups.map(([key, items]) => {
          const meta = GROUP_META[key] || { label: key, color: 'text-ice', icon: '◆' };
          return (
            <div key={key}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`text-[10px] uppercase tracking-widest font-semibold ${meta.color}`}>
                  {meta.icon} {meta.label}
                </span>
                <span className="text-[10px] text-slate-light">({items.length})</span>
              </div>
              <ul className="space-y-1.5 ml-3">
                {items.map((d, i) => (
                  <li key={i} className="text-xs leading-relaxed">
                    <a href={d.url} target="_blank" className="text-teal-glow hover:underline">
                      {d.title || d.url}
                    </a>
                    {d.snippet && <div className="text-[11px] text-ice/75 mt-0.5">{d.snippet.slice(0, 220)}{d.snippet.length > 220 ? '…' : ''}</div>}
                    {(d.date || d.accessed_at) && (
                      <div className="text-[10px] text-slate-light mt-0.5">
                        {d.date && <>retrieved: {d.date}</>}
                        {d.accessed_at && <>accessed: {new Date(d.accessed_at).toLocaleString()}</>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-slate-light mt-4">
        Every brief claim links back to a primary source the Scout, Verify, or Counter agent retrieved.
        Auditor HEAD-checks every URL — only resolving citations make it into the published brief.
      </div>
    </div>
  );
}
