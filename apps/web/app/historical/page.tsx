'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import ThemeToggle from '../../components/ThemeToggle';
import { API_BASE, api } from '../../lib/api';

type Recall = {
  slug: string;
  drug: string;
  year: number;
  story: string;
  actual_action: string[];
  scope: string;
  lessons: string;
  sources: { title: string; url: string }[];
};

export default function HistoricalIndex() {
  const router = useRouter();
  const [items, setItems] = useState<Recall[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await api<{ items: Recall[] }>('/api/v1/historical/recalls');
        if (mounted) setItems(data.items);
      } catch (e: any) { if (mounted) setErr(e?.message || 'failed'); }
    })();
    return () => { mounted = false; };
  }, []);

  async function replay(slug: string) {
    setBusy(slug);
    try {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/api/v1/historical/replay/${slug}`, { method: 'POST' });
      } catch {
        res = await fetch(`/api/proxy/v1/historical/replay/${slug}`, { method: 'POST' });
      }
      const data = await res.json();
      if (data.workflow_id) router.push(`/historical/${slug}?wf=${data.workflow_id}`);
      else router.push(`/historical/${slug}`);
    } catch (e: any) {
      setErr(e?.message || 'replay failed');
    } finally { setBusy(null); }
  }

  return (
    <main className="grid-bg min-h-screen">
      <header className="px-6 md:px-10 pt-6 pb-4 flex items-center justify-between">
        <Link href="/" className="text-xs uppercase tracking-widest text-slate-light hover:text-teal-glow">← back</Link>
        <div className="flex items-center gap-3"><ThemeToggle /></div>
      </header>

      <section className="max-w-6xl mx-auto px-6 md:px-10 py-6">
        <div className="text-[11px] uppercase tracking-widest text-slate-light">Historical</div>
        <h1 className="font-serif text-3xl md:text-5xl text-ice glow-text mt-1">Famous past recalls · replayed through Reflex.</h1>
        <p className="text-slate-light mt-2 max-w-2xl">
          Click "Replay through Reflex" on any case. The 11-agent swarm runs against the recalled drug,
          BioNeMo ranks therapeutic alternatives, and the brief page shows a side-by-side comparison of
          Reflex's recommendation vs what the FDA actually did.
        </p>
        {err && <div className="text-xs text-alert mt-2">{err}</div>}

        <div className="mt-8 grid md:grid-cols-2 gap-4">
          {items.map((r) => (
            <div key={r.slug} className="card p-5 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-ice">{r.drug}</div>
                <span className="text-[10px] uppercase tracking-widest text-teal-glow border border-teal/30 rounded-full px-2 py-0.5">
                  {r.year}
                </span>
              </div>
              <p className="text-xs text-ice/90 leading-relaxed">{r.story}</p>
              <div className="text-[10px] text-slate-light mt-2 italic">{r.scope}</div>
              <div className="mt-auto flex gap-2 pt-4">
                <button
                  className="btn btn-primary text-xs"
                  disabled={busy !== null}
                  onClick={() => replay(r.slug)}
                >
                  {busy === r.slug ? 'Firing swarm…' : 'Replay through Reflex →'}
                </button>
                <Link href={`/historical/${r.slug}`} className="btn text-xs">View case</Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
