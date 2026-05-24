'use client';

/** Inline brief summary — the LLM-generated output, visible the moment Writer completes. */

import Link from 'next/link';

type Brief = {
  title?: string;
  summary?: string;
  findings?: string[];
  recommendation?: string;
  severity_score?: number;
  citations?: { title: string; url: string }[];
};

export default function BriefSummaryCard({
  workflowId,
  brief,
  citedUrl,
  counterEvidenceCount = 0,
}: {
  workflowId: string;
  brief: Brief | null;
  citedUrl?: string | null;
  counterEvidenceCount?: number;
}) {
  if (!brief?.summary) return null;
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-[10px] uppercase tracking-widest text-teal-glow">Reflex brief · live</div>
        <div className="flex items-center gap-2">
          {citedUrl && (
            <a href={citedUrl} target="_blank" className="text-[11px] text-teal-glow hover:underline">
              cited.md ↗
            </a>
          )}
          <Link href={`/brief/${workflowId}`} className="btn text-xs py-1 px-2.5">Open full brief →</Link>
        </div>
      </div>
      {brief.title && <div className="text-sm font-semibold text-ice mb-2">{brief.title}</div>}
      <p className="text-sm text-ice/90 leading-relaxed">{brief.summary}</p>
      {brief.findings && brief.findings.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-ice/85 list-disc list-inside">
          {brief.findings.slice(0, 3).map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}
      <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-light">
        {brief.severity_score !== undefined && (
          <span>Severity <span className="text-ice tabular-nums">{brief.severity_score?.toFixed(1)}/10</span></span>
        )}
        {brief.citations && (
          <span>Citations <span className="text-ice tabular-nums">{brief.citations.length}</span></span>
        )}
        {counterEvidenceCount > 0 && (
          <span className="text-alert">Counter-evidence <span className="tabular-nums">{counterEvidenceCount}</span></span>
        )}
      </div>
    </div>
  );
}
