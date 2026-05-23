'use client';

import { useState } from 'react';
import { API_BASE } from '../lib/api';

type Brief = {
  title: string;
  drug_name: string;
  summary: string;
  findings: string[];
  counter_evidence_summary: string;
  recommendation: string;
  severity_score: number;
  citations: { title: string; url: string; accessed_at: string }[];
};

export default function BriefActions({
  workflowId,
  brief,
  citedUrl,
}: {
  workflowId: string;
  brief: Brief | null;
  citedUrl?: string | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function chatAction(message: string, label: string) {
    setBusy(label); setMsg(null);
    try {
      const tryFetch = (url: string) =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflow_id: workflowId, message, history: [] }),
        });
      let res: Response;
      try { res = await tryFetch(`${API_BASE}/api/v1/chat`); }
      catch { res = await tryFetch(`/api/proxy/v1/chat`); }
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const count = (data.actions || []).length;
      setMsg(count ? `${label} — ${count} action${count !== 1 ? 's' : ''} executed` : (data.answer || 'done'));
    } catch (e: any) {
      setMsg(`Error: ${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  }

  function downloadMarkdown() {
    if (!brief) return;
    const md = renderMarkdown(brief, citedUrl || '');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(brief.drug_name)}-${workflowId.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadJson() {
    const url = `${API_BASE}/api/v1/workflow/${workflowId}`;
    window.open(url, '_blank');
  }

  return (
    <div className="card p-4 mt-6">
      <div className="text-xs uppercase tracking-widest text-slate-light mb-3">Reviewer actions</div>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-primary text-sm"
          disabled={busy !== null || !brief}
          onClick={() => chatAction('Send the pharmacist memo, alert the clinicians, and notify the patients for this workflow.', 'Approve & dispatch all')}
        >
          {busy === 'Approve & dispatch all' ? 'Dispatching…' : '✓ Approve & dispatch all'}
        </button>
        <button
          className="btn text-sm"
          disabled={busy !== null || !brief}
          onClick={() => chatAction('Send the pharmacist memo for this workflow.', 'Send pharmacist memo')}
        >
          Send pharmacist memo
        </button>
        <button
          className="btn text-sm"
          disabled={busy !== null || !brief}
          onClick={() => chatAction('Alert the clinicians for this workflow.', 'Alert clinicians')}
        >
          Alert clinicians
        </button>
        <button
          className="btn text-sm"
          disabled={busy !== null || !brief}
          onClick={() => chatAction('Send patient letters for this workflow.', 'Notify patients')}
        >
          Notify patients
        </button>
        <button
          className="btn text-sm"
          disabled={busy !== null || !brief}
          onClick={() => chatAction('Publish this brief.', 'Publish to cited.md')}
        >
          Re-publish
        </button>
        <button className="btn text-sm" disabled={!brief} onClick={downloadMarkdown}>
          ⬇ Download brief (.md)
        </button>
        <button className="btn text-sm" onClick={downloadJson}>
          ⬇ Download workflow JSON
        </button>
        {citedUrl && (
          <a className="btn text-sm" href={citedUrl} target="_blank">
            View live URL ↗
          </a>
        )}
      </div>
      {msg && <div className="mt-3 text-xs text-teal-glow">{msg}</div>}
      <div className="text-[10px] text-slate-light mt-3">
        Reviewer actions route through the same agent toolkit the voice agent uses — every dispatch
        appears in the live Activity Feed and the ClickHouse outbox audit log.
      </div>
    </div>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function renderMarkdown(b: Brief, citedUrl: string): string {
  const findings = b.findings.map((f) => `- ${f}`).join('\n');
  const cits = b.citations.map((c, i) => `[^${i + 1}]: [${c.title}](${c.url})`).join('\n');
  return `# ${b.title}

**Drug:** ${b.drug_name}
**Severity:** ${b.severity_score.toFixed(1)} / 10
${citedUrl ? `**Published:** ${citedUrl}\n` : ''}

## Summary
${b.summary}

## Key findings
${findings}

## Counter-evidence considered
${b.counter_evidence_summary}

## Recommendation
${b.recommendation}

## Citations
${cits}
`;
}
