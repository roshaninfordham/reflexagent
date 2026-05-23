'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { API_BASE } from '../lib/api';

export default function SampleRecallButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onClick = async () => {
    setBusy(true); setErr(null);
    try {
      // Fetch the generated recall fax image
      const imgRes = await fetch(`${API_BASE}/api/v1/demo/sample-recall.png`);
      if (!imgRes.ok) throw new Error('sample image unavailable');
      const blob = await imgRes.blob();
      const file = new File([blob], 'recall-fax.png', { type: 'image/png' });
      // Upload to the vision endpoint
      const fd = new FormData();
      fd.append('file', file);
      const up = await fetch(`${API_BASE}/api/v1/ingest/vision`, { method: 'POST', body: fd });
      if (!up.ok) throw new Error(`vision ${up.status}`);
      const data = await up.json();
      if (data.workflow_id) router.push(`/ops?wf=${data.workflow_id}`);
      else router.push('/ops');
    } catch (e: any) {
      setErr(e?.message || 'failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-widest text-slate-light mb-2">
        Or: see the fax → vision → swarm path
      </div>
      <button onClick={onClick} disabled={busy} className="btn">
        {busy ? 'Fetching + extracting…' : 'Process sample recall fax (vision)'}
      </button>
      <div className="text-[10px] text-slate-light mt-2">
        Generates a sample faxed recall image server-side, POSTs it through the NIM vision endpoint
        for entity extraction, then routes to the live workflow on the Ops page.
      </div>
      {err && <div className="text-xs text-alert mt-2">{err}</div>}
    </div>
  );
}
