'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { API_BASE, api } from '../../lib/api';

type RecentWF = {
  workflow_id: string;
  brief?: { title: string; drug_name: string } | null;
  status: string;
};

export default function PremiumPage() {
  const [workflows, setWorkflows] = useState<RecentWF[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [question, setQuestion] = useState('Slice the cohort by CKD stage and pregnancy status; recommend formulary substitutes.');
  const [paying, setPaying] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const xs = await api<RecentWF[]>('/api/v1/workflows?limit=10');
        if (mounted) {
          const completed = xs.filter((w) => w.status === 'completed' && w.brief);
          setWorkflows(completed);
          if (!chosen && completed[0]) setChosen(completed[0].workflow_id);
        }
      } catch {}
    };
    load();
    const i = setInterval(load, 3000);
    return () => { mounted = false; clearInterval(i); };
  }, [chosen]);

  async function pay() {
    setPaying(true);
    setErr(null);
    setAnswer(null);
    try {
      // 1. Probe the endpoint to get the 402 challenge.
      const probe = await fetch(`${API_BASE}/api/v1/premium-subbrief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow_id: chosen, question }),
      });
      // 2. Get a dev x402 token.
      const tok = await api<{ x_payment_header: string }>('/api/v1/payments/dev-token');
      // 3. Retry with X-PAYMENT.
      const res = await fetch(`${API_BASE}/api/v1/premium-subbrief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-PAYMENT': tok.x_payment_header },
        body: JSON.stringify({ workflow_id: chosen, question }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const data = await res.json();
      setAnswer(data.answer || '(empty response)');
      void probe;
    } catch (e: any) {
      setErr(e?.message || 'payment failed');
    } finally {
      setPaying(false);
    }
  }

  return (
    <main className="grid-bg min-h-screen">
      <header className="px-6 md:px-10 pt-6 pb-4 flex items-center justify-between">
        <Link href="/" className="text-xs uppercase tracking-widest text-slate-light hover:text-teal-glow">← back</Link>
        <span className="text-[11px] uppercase tracking-widest text-slate-light">Premium sub-brief · x402</span>
      </header>

      <section className="max-w-2xl mx-auto px-6 md:px-10 py-8 space-y-6">
        <div>
          <h1 className="font-serif text-3xl md:text-4xl text-ice glow-text">$0.50 per query.</h1>
          <p className="text-slate-light mt-2">
            Pay-per-question premium analysis on top of any published brief. Settled on Base Sepolia via Coinbase CDP. JWT fallback for local dev.
          </p>
        </div>

        <div className="card p-5 space-y-3">
          <div>
            <label className="text-xs uppercase tracking-widest text-slate-light">Base brief</label>
            <select
              className="mt-1 w-full bg-ink/60 border border-teal/20 rounded px-3 py-2 text-ice"
              value={chosen || ''}
              onChange={(e) => setChosen(e.target.value)}
            >
              {workflows.length === 0 && <option value="">(no completed workflows yet — trigger one from /)</option>}
              {workflows.map((w) => (
                <option key={w.workflow_id} value={w.workflow_id}>
                  {w.brief?.title || w.brief?.drug_name || w.workflow_id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-slate-light">Your question</label>
            <textarea
              className="mt-1 w-full bg-ink/60 border border-teal/20 rounded px-3 py-2 text-ice min-h-[100px]"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>
          <button className="btn-primary btn w-full" disabled={paying || !chosen} onClick={pay}>
            {paying ? 'Settling on Base Sepolia…' : 'Pay $0.50 · run sub-brief'}
          </button>
          {err && <div className="text-xs text-alert">{err}</div>}
        </div>

        {answer && (
          <div className="card p-5">
            <div className="text-[11px] uppercase tracking-widest text-slate-light mb-2">Sub-brief</div>
            <div className="whitespace-pre-wrap text-ice/90 leading-relaxed">{answer}</div>
          </div>
        )}
      </section>
    </main>
  );
}
