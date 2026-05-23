'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type WF = {
  workflow_id: string;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  payload: { drug_name?: string | null; source: string };
  brief?: { title: string } | null;
  published?: { cited_md_url: string } | null;
};

export default function RecentWorkflows() {
  const [items, setItems] = useState<WF[]>([]);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const xs = await api<WF[]>('/api/v1/workflows?limit=12');
        if (mounted) setItems(xs);
      } catch {}
    };
    load();
    const i = setInterval(load, 2000);
    return () => { mounted = false; clearInterval(i); };
  }, []);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-widest text-slate-light">Workflows</span>
        <span className="text-xs text-slate-light">{items.length} recent</span>
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-slate-light italic">No workflows yet.</div>
      ) : (
        <ul className="divide-y divide-teal/10">
          {items.map((w) => (
            <li key={w.workflow_id} className="py-2.5 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <Link href={`/workflow/${w.workflow_id}`} className="text-sm text-ice hover:text-teal-glow truncate block">
                  {w.brief?.title || w.payload.drug_name || w.workflow_id.slice(0, 8)}
                </Link>
                <div className="text-[10px] text-slate-light uppercase tracking-widest mt-0.5">
                  {w.payload.source.replace('_', ' ')} · {new Date(w.started_at).toLocaleTimeString()}
                </div>
              </div>
              <StatusPill status={w.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: WF['status'] }) {
  const palette: Record<WF['status'], string> = {
    running: 'bg-warn/20 text-warn border-warn/30',
    completed: 'bg-ok/20 text-ok border-ok/30',
    failed: 'bg-alert/20 text-alert border-alert/30',
  };
  return (
    <span className={`ml-3 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${palette[status]}`}>
      {status}
    </span>
  );
}
