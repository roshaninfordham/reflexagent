'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import ThemeToggle from '../../components/ThemeToggle';
import { api } from '../../lib/api';

type Tier = {
  name: string; price: string; cadence: string; for: string;
  includes: string[]; cta: string;
};
type Usage = {
  uptime_seconds: number;
  total_calls: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost_cents: number;
  per_provider: Record<string, { calls: number; tokens_in: number; tokens_out: number; cost_cents: number }>;
  rate_limit_hits: number;
  rate_limited_now: boolean;
};
type CostResp = {
  usage: Usage;
  prices_internal_cents: Record<string, number>;
  public_tiers: Tier[];
  rate_limit_strategy: Record<string, any>;
  infra_costs_per_month_estimate_cents: Record<string, any>;
};

function fmtCents(c: number) { return c < 100 ? `${c.toFixed(2)}¢` : `$${(c/100).toFixed(2)}`; }
function fmtDur(s: number) { const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); return h ? `${h}h ${m}m` : `${m}m`; }

export default function PricingPage() {
  const [data, setData] = useState<CostResp | null>(null);
  useEffect(() => {
    let m = true;
    const load = async () => { try { const x = await api<CostResp>('/api/v1/cost'); if (m) setData(x); } catch {} };
    load(); const i = setInterval(load, 5000); return () => { m = false; clearInterval(i); };
  }, []);

  return (
    <main className="grid-bg min-h-screen">
      <header className="px-6 md:px-10 pt-6 pb-4 flex items-center justify-between">
        <Link href="/" className="text-xs uppercase tracking-widest text-slate-light hover:text-teal-glow">← back</Link>
        <div className="flex items-center gap-3"><ThemeToggle /></div>
      </header>

      <section className="max-w-6xl mx-auto px-6 md:px-10 py-6">
        <div className="text-[11px] uppercase tracking-widest text-slate-light">Pricing</div>
        <h1 className="font-serif text-3xl md:text-5xl text-ice glow-text mt-1">Verified safety, priced like utility.</h1>
        <p className="text-slate-light mt-2 max-w-2xl">
          One free public feed. Pay-per-query for premium analyses via x402. Enterprise tiers for health systems and pharma compliance.
        </p>

        <div className="mt-8 grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          {(data?.public_tiers || []).map((t) => (
            <div key={t.name} className="card p-5 flex flex-col">
              <div className="text-xs uppercase tracking-widest text-slate-light">{t.name}</div>
              <div className="text-2xl font-semibold text-ice mt-2">{t.price}<span className="text-xs text-slate-light"> · {t.cadence}</span></div>
              <div className="text-xs text-slate-light mt-1">{t.for}</div>
              <ul className="mt-4 space-y-1.5 text-[12px] text-ice/90 flex-1">
                {t.includes.map((it, i) => <li key={i}>· {it}</li>)}
              </ul>
              <Link href={t.name === 'Solo' ? '/premium' : '/'} className="btn btn-primary mt-4 text-xs">{t.cta}</Link>
            </div>
          ))}
        </div>

        <div className="mt-10 grid lg:grid-cols-2 gap-5">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-widest text-slate-light">Live ops cost · this process</span>
              {data?.usage.rate_limited_now ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-warn/40 text-warn bg-warn/10">rate-limited backoff</span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-ok/40 text-ok bg-ok/10">healthy</span>
              )}
            </div>
            {data ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                  <Stat l="uptime" v={fmtDur(data.usage.uptime_seconds)} />
                  <Stat l="total calls" v={String(data.usage.total_calls)} />
                  <Stat l="tokens in/out" v={`${data.usage.total_tokens_in}/${data.usage.total_tokens_out}`} small />
                  <Stat l="est cost so far" v={fmtCents(data.usage.total_cost_cents)} accent />
                </div>
                <table className="w-full mt-4 text-xs">
                  <thead>
                    <tr className="text-slate-light text-left text-[10px] uppercase tracking-widest">
                      <th className="py-1.5">provider</th><th>calls</th><th>tokens</th><th className="text-right">cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.usage.per_provider).map(([k, v]) => (
                      <tr key={k} className="border-t border-teal/10">
                        <td className="py-1.5 text-ice">{k}</td>
                        <td className="text-ice/80">{v.calls}</td>
                        <td className="text-ice/80">{(v.tokens_in + v.tokens_out) || '—'}</td>
                        <td className="text-right text-teal-glow">{fmtCents(v.cost_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.usage.rate_limit_hits > 0 && (
                  <div className="text-[11px] text-warn mt-3">
                    NIM rate-limit hits since start: {data.usage.rate_limit_hits} — agents fell back to deterministic outputs and workflows still completed.
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-slate-light italic">loading…</div>
            )}
          </div>

          <div className="card p-5">
            <div className="text-xs uppercase tracking-widest text-slate-light mb-3">Rate-limit strategy</div>
            {data && (
              <ul className="text-sm text-ice/90 space-y-2">
                <li>· NIM in-flight cap: <strong className="text-teal-glow">{data.rate_limit_strategy.nim_semaphore_max_inflight}</strong> (semaphore-bounded)</li>
                <li>· NIM key pool: <strong className="text-teal-glow">{data.rate_limit_strategy.nim_keys_pooled}</strong> rotated</li>
                <li>· Autonomous monitor poll: every <strong className="text-teal-glow">{data.rate_limit_strategy.monitor_poll_seconds}s</strong></li>
                <li>· NimbleWay retry budget: <strong className="text-teal-glow">{data.rate_limit_strategy.nimble_retries}</strong> attempts with exponential backoff</li>
                <li>· OpenAI SDK auto-retries: <strong className="text-teal-glow">{data.rate_limit_strategy.openai_sdk_max_retries}</strong></li>
                <li className="text-slate-light text-xs pt-2">{data.rate_limit_strategy.graceful_fallbacks}</li>
              </ul>
            )}
            <div className="mt-5 text-xs uppercase tracking-widest text-slate-light mb-2">Infra cost · monthly est</div>
            {data && (
              <ul className="text-[11px] text-ice/80 space-y-1">
                <li>· ClickHouse Cloud — free tier</li>
                <li>· Senso — free tier</li>
                <li>· NVIDIA BioNeMo health endpoint — free</li>
                <li>· Datadog LLM Observability — free tier</li>
                <li>· NimbleWay — metered (≈$0.10 / SERP call)</li>
                <li>· NVIDIA NIM Llama 3.3 70B — metered (≈$0.40 / 1M tokens)</li>
              </ul>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ l, v, accent, small }: { l: string; v: string; accent?: boolean; small?: boolean }) {
  return (
    <div className="bg-ink/40 border border-teal/10 rounded p-2.5">
      <div className={`${small ? 'text-sm' : 'text-xl'} font-semibold tabular-nums ${accent ? 'text-teal-glow' : 'text-ice'}`}>{v}</div>
      <div className="text-[9px] uppercase tracking-widest text-slate-light mt-0.5">{l}</div>
    </div>
  );
}
