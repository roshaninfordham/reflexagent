'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { API_BASE } from '../lib/api';

export default function LaunchDemo({
  label = 'Launch demo →',
  primary = true,
  className = '',
}: { label?: string; primary?: boolean; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/api/v1/demo/launch`, { method: 'POST' });
      } catch {
        res = await fetch(`/api/proxy/v1/demo/launch`, { method: 'POST' });
      }
      const data = await res.json().catch(() => ({}));
      const wf = data.workflow_id || '';
      router.push(wf ? `/ops?wf=${wf}` : '/ops');
    } catch {
      router.push('/ops');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`btn ${primary ? 'btn-primary' : ''} ${className}`}
      title="Fires a curated metformin recall workflow + opens the Ops dashboard"
    >
      {busy ? 'Firing swarm…' : label}
    </button>
  );
}
