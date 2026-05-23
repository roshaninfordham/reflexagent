'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { API_BASE, api } from '../lib/api';

export default function TriggerPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState<'pdf' | 'inject' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function uploadFile(file: File) {
    setBusy('pdf');
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/api/v1/ingest/vision`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (data.workflow_id) router.push(`/workflow/${data.workflow_id}`);
      else router.refresh();
    } catch (e: any) {
      setErr(e?.message || 'upload failed');
    } finally {
      setBusy(null);
    }
  }

  async function injectDemo() {
    setBusy('inject');
    setErr(null);
    try {
      const payload = {
        drug_name: 'Metformin HCl Extended-Release Tablets, 500 mg',
        manufacturer: 'Apotex Corp.',
        ndc: '60505-2657-0',
        lot_numbers: ['APX5523', 'APX5524'],
        recall_class: 'II',
        reason: 'NDMA detected above the FDA interim acceptable intake limit of 96 ng/day.',
        external_id: `DEMO-METFORMIN-${Date.now()}`,
      };
      await api('/api/v1/monitor/inject', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (e: any) {
      setErr(e?.message || 'inject failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest text-slate-light">Operator actions</span>
        <span className="text-[10px] text-slate-light">primary trigger is autonomous</span>
      </div>

      <div className="mt-4 grid md:grid-cols-2 gap-3">
        <label
          className="block border border-dashed border-teal/30 hover:border-teal-glow/60 rounded-lg p-5 text-center cursor-pointer transition bg-ink/40"
        >
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
          />
          <div className="text-sm font-medium text-ice">{busy === 'pdf' ? 'Extracting…' : 'Drop a faxed recall PDF or photo'}</div>
          <div className="text-[11px] text-slate-light mt-1">Server-side vision extracts NDC + lots</div>
        </label>

        <button
          className="btn-primary btn h-full min-h-[88px] flex-col"
          disabled={busy !== null}
          onClick={injectDemo}
        >
          {busy === 'inject' ? 'Queued…' : 'Inject demo signal'}
          <span className="block text-[10px] opacity-80 mt-1 normal-case font-normal">
            Apotex metformin recall · next monitor tick will fire the swarm
          </span>
        </button>
      </div>
      {err && <div className="mt-3 text-xs text-alert">{err}</div>}
    </div>
  );
}
