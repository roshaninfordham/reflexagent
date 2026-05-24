'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import ThemeToggle from '../../components/ThemeToggle';
import TrustStrip from '../../components/TrustStrip';
import { api } from '../../lib/api';

type Tier = {
  name: string; price: string; cadence: string; for: string;
  includes: string[]; cta: string; popular?: boolean;
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

const CTA_HREF: Record<string, string> = {
  'Open cited.md': 'https://github.com/roshaninfordham/reflexagent/blob/main/cited.md',
  'Try Premium': '/premium',
  'Book a pilot': 'mailto:rsusny@gmail.com?subject=Reflex%20Hospital%20pilot',
  'Contact sales': 'mailto:rsusny@gmail.com?subject=Reflex%20Pharma%20engagement',
};

// Feature matrix — same vocabulary across all tiers so the buyer can compare
// at a glance. Order: Public · Solo · Hospital · Pharma.
const MATRIX: { label: string; values: (boolean | string)[] }[] = [
  { label: 'Public cited.md feed',                values: [true, true, true, true] },
  { label: 'Counter-evidence on every brief',     values: [true, true, true, true] },
  { label: 'Pay-per-sub-brief (x402)',            values: [false, true, true, true] },
  { label: 'Voice + chat copilot',                values: [false, true, true, true] },
  { label: 'Run on your inventory + EHR feed',    values: [false, false, true, true] },
  { label: 'Routing & comms auto-dispatch',       values: [false, false, true, true] },
  { label: 'BioNeMo substitute structures',       values: [false, false, true, true] },
  { label: 'ClickHouse audit trail',              values: ['read', 'read', 'tenant', 'tenant'] },
  { label: 'Datadog LLM Observability access',    values: [false, false, true, true] },
  { label: 'SOC2-ready logs',                     values: [false, false, true, true] },
  { label: 'Continuous SKU monitoring',           values: [false, false, false, true] },
  { label: 'Custom adversarial counter-agents',   values: [false, false, false, true] },
  { label: 'GEO publishing via Senso',            values: [false, false, false, true] },
  { label: 'Federal RFI-aligned (CRUSH, SaMD)',   values: [false, false, false, true] },
  { label: 'Dedicated org workspace + on-call',   values: [false, false, false, true] },
  { label: 'SLA',                                 values: ['best-effort', 'best-effort', '99.9% · 4h response', '99.99% · 1h response'] },
];

export default function PricingPage() {
  const [data, setData] = useState<CostResp | null>(null);
  const [showEng, setShowEng] = useState(false);
  useEffect(() => {
    let m = true;
    const load = async () => { try { const x = await api<CostResp>('/api/v1/cost'); if (m) setData(x); } catch {} };
    load(); const i = setInterval(load, 5000); return () => { m = false; clearInterval(i); };
  }, []);

  const tiers = data?.public_tiers || [];

  return (
    <main className="grid-bg min-h-screen">
      <header className="px-6 md:px-10 pt-6 pb-4 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md bg-[var(--bg-1)]/70 border-b border-teal/10">
        <Link href="/" className="text-xs uppercase tracking-widest text-slate-light hover:text-teal-glow">← Reflex</Link>
        <nav className="flex items-center gap-5 text-xs text-slate-light">
          <Link href="/ops" className="hover:text-teal-glow uppercase tracking-widest">Mission Control</Link>
          <Link href="/historical" className="hover:text-teal-glow uppercase tracking-widest">Historical</Link>
          <Link href="/premium" className="hover:text-teal-glow uppercase tracking-widest">Premium</Link>
          <Link href="/pricing" className="text-teal-glow uppercase tracking-widest">Pricing</Link>
          <ThemeToggle />
        </nav>
      </header>

      {/* HERO */}
      <section className="px-6 md:px-10 pt-12 pb-6 max-w-6xl mx-auto">
        <div className="text-[11px] uppercase tracking-widest text-teal-glow">Pricing</div>
        <h1 className="font-serif text-4xl md:text-5xl text-ice mt-2 leading-[1.05] glow-text">
          Verified safety, <em className="not-italic text-teal-glow">priced like utility.</em>
        </h1>
        <p className="text-base md:text-lg text-slate-light mt-4 max-w-3xl leading-relaxed">
          One free public feed. Pay-per-sub-brief for premium analyses via <strong className="text-ice">x402</strong>.
          Enterprise tiers for health systems and pharma. Real cloud costs disclosed below — no SaaS theater.
        </p>
      </section>

      {/* TRUST STRIP */}
      <TrustStrip />

      {/* TIER CARDS */}
      <section className="px-6 md:px-10 pt-2 pb-8 max-w-6xl mx-auto">
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          {tiers.map((t) => (
            <TierCard key={t.name} tier={t} />
          ))}
        </div>
        <div className="mt-3 text-[11px] text-slate-light italic text-center">
          All prices in USD · annual or monthly, your choice · 14-day pilot trial for Hospital and Pharma
        </div>
      </section>

      {/* PRICE ANCHOR */}
      <section className="px-6 md:px-10 py-8 max-w-6xl mx-auto">
        <div className="card p-6 md:p-7">
          <div className="text-[10px] uppercase tracking-widest text-slate-light">For comparison · what health systems pay today</div>
          <div className="grid md:grid-cols-4 gap-5 mt-3 items-end">
            <Anchor strike="$200–500k" sub="IBM Watson Health · annual per facility" />
            <Anchor strike="$50–300k" sub="UpToDate + Lexicomp · annual per facility (≈200 users)" />
            <Anchor strike="$500k+" sub="FTE pharmacovigilance team · 5 FTEs at $100k loaded" />
            <div className="border-l border-teal/30 pl-5">
              <div className="text-3xl md:text-4xl font-serif text-teal-glow">$75k</div>
              <div className="text-sm text-ice mt-1 font-semibold">Reflex Hospital · start</div>
              <div className="text-xs text-slate-light mt-0.5">
                Same coverage. 60-second response. <span className="text-teal-glow">Fraction of the cost.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURE MATRIX */}
      <section className="px-6 md:px-10 py-10 max-w-6xl mx-auto">
        <div className="text-[11px] uppercase tracking-widest text-slate-light">Compare plans</div>
        <h2 className="font-serif text-2xl md:text-3xl text-ice mt-1 mb-5">Side-by-side, no asterisks.</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-slate-light border-b border-teal/15">
                <th className="px-4 py-3 w-2/5">Feature</th>
                <th className="px-3 py-3 text-center">Public</th>
                <th className="px-3 py-3 text-center">Solo</th>
                <th className="px-3 py-3 text-center text-teal-glow">Hospital ★</th>
                <th className="px-3 py-3 text-center">Pharma</th>
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((row, i) => (
                <tr key={i} className="border-b border-teal/8 last:border-b-0">
                  <td className="px-4 py-2.5 text-ice/90">{row.label}</td>
                  {row.values.map((v, j) => (
                    <td key={j} className={`px-3 py-2.5 text-center text-xs ${j === 2 ? 'bg-teal/5' : ''}`}>
                      {v === true ? (
                        <span className="text-ok">✓</span>
                      ) : v === false ? (
                        <span className="text-slate-light/50">—</span>
                      ) : (
                        <span className="text-ice/80">{v}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* TRANSPARENCY · COST MATH */}
      <section className="px-6 md:px-10 py-10 max-w-6xl mx-auto">
        <div className="text-[11px] uppercase tracking-widest text-teal-glow">Radical transparency</div>
        <h2 className="font-serif text-2xl md:text-3xl text-ice mt-1">Here's exactly what it costs us.</h2>
        <p className="text-sm text-slate-light mt-2 max-w-3xl">
          Most SaaS pricing pages obscure unit economics. Ours doesn't. These are the real per-event costs
          when Reflex runs in production — every line item priced at the rate we actually pay.
        </p>
        <div className="grid md:grid-cols-2 gap-4 mt-5">
          <div className="card p-5">
            <div className="text-[10px] uppercase tracking-widest text-slate-light mb-3">Per full workflow · 11 agents fire end-to-end</div>
            <CostLine label="NVIDIA NIM Llama 3.3 70B" detail="~42k tokens mixed" cost="$0.025" />
            <CostLine label="NimbleWay SERP" detail="~3 calls @ $0.05" cost="$0.150" />
            <CostLine label="ClickHouse + Datadog spans" detail="cohort SQL + 11 spans" cost="$0.005" />
            <CostLine label="Senso publish" detail="cited.md update" cost="$0.005" />
            <CostLine label="Email + SMS dispatch" detail="Postmark + Twilio" cost="$0.005" />
            <div className="border-t border-teal/20 mt-2 pt-2 flex justify-between text-sm">
              <span className="text-ice font-semibold">Total variable cost</span>
              <span className="text-teal-glow font-mono font-semibold">~$0.19</span>
            </div>
          </div>
          <div className="card p-5">
            <div className="text-[10px] uppercase tracking-widest text-slate-light mb-3">Per premium sub-brief · pay-per-query</div>
            <CostLine label="NIM Llama 3.3 70B" detail="~7k tokens" cost="$0.005" />
            <CostLine label="Datadog spans + ClickHouse" detail="audit insert" cost="$0.0005" />
            <CostLine label="x402 settlement gas" detail="Base mainnet · testnet free" cost="$0.001" />
            <div className="border-t border-teal/20 mt-2 pt-2 flex justify-between text-sm">
              <span className="text-ice font-semibold">Total variable cost</span>
              <span className="text-teal-glow font-mono font-semibold">~$0.007</span>
            </div>
            <div className="mt-3 text-[11px] text-slate-light leading-relaxed">
              At <span className="text-ice">$0.50</span> charged: <span className="text-teal-glow font-semibold">~70× gross margin</span>{' '}
              (98.6%). Pure variable-revenue product, no per-customer fixed cost.
            </div>
          </div>
        </div>
        <div className="card p-5 mt-4">
          <div className="text-[10px] uppercase tracking-widest text-slate-light mb-3">Monthly fixed infra · production at ~50-facility scale</div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            <CostLine label="Fly.io / Render backend" detail="4 vCPU + 8GB · multi-region" cost="$200" compact />
            <CostLine label="Vercel Pro frontend" detail="ISR + edge" cost="$200" compact />
            <CostLine label="ClickHouse Cloud" detail="production · 1TB · 4 vCPU" cost="$400" compact />
            <CostLine label="Datadog LLM Obs + APM" detail="5 hosts" cost="$1,200" compact />
            <CostLine label="Senso (paid tier)" detail="GEO publishing" cost="$200" compact />
            <CostLine label="NimbleWay (base)" detail="subscription floor" cost="$500" compact />
            <CostLine label="Postmark + Twilio" detail="base + first 1k/mo" cost="$50" compact />
            <CostLine label="Domain · SSL · monitoring" detail="Cloudflare + Uptime" cost="$50" compact />
          </div>
          <div className="border-t border-teal/20 mt-3 pt-3 flex justify-between items-baseline">
            <div>
              <div className="text-ice font-semibold">~$2,800 / mo fixed · $33,600 / year</div>
              <div className="text-[11px] text-slate-light">Spread across 50 facilities = ~$670/facility/year fixed share + ~$130 variable = ~$800/facility/year fully loaded</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-serif text-teal-glow">~93×</div>
              <div className="text-[10px] uppercase tracking-widest text-slate-light">Hospital margin at $75k</div>
            </div>
          </div>
        </div>
      </section>

      {/* ENGINEERING TRANSPARENCY · COLLAPSED */}
      <section className="px-6 md:px-10 py-8 max-w-6xl mx-auto">
        <div className="card overflow-hidden">
          <button
            onClick={() => setShowEng((v) => !v)}
            className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-ink/40 transition-colors"
          >
            <div>
              <div className="text-[10px] uppercase tracking-widest text-teal-glow">Engineering transparency</div>
              <div className="text-sm text-ice mt-0.5">
                Live ops cost · rate-limit strategy · workflow uptime
                {data && (
                  <span className="text-slate-light ml-2">
                    · this process: <span className="text-ice tabular-nums">{data.usage.total_calls}</span> calls,{' '}
                    <span className="text-teal-glow tabular-nums">{fmtCents(data.usage.total_cost_cents)}</span> burned, up {fmtDur(data.usage.uptime_seconds)}
                  </span>
                )}
              </div>
            </div>
            <span className="text-[11px] text-teal-glow">{showEng ? 'hide ▴' : 'expand ▾'}</span>
          </button>
          {showEng && data && (
            <div className="border-t border-teal/15 px-5 py-5 grid lg:grid-cols-2 gap-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-widest text-slate-light">Live ops cost · this process</span>
                  {data.usage.rate_limited_now ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-warn/40 text-warn bg-warn/10">rate-limited backoff</span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-ok/40 text-ok bg-ok/10">healthy</span>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                  <Stat l="uptime" v={fmtDur(data.usage.uptime_seconds)} />
                  <Stat l="total calls" v={String(data.usage.total_calls)} />
                  <Stat l="tokens in/out" v={`${data.usage.total_tokens_in}/${data.usage.total_tokens_out}`} small />
                  <Stat l="est cost so far" v={fmtCents(data.usage.total_cost_cents)} accent />
                </div>
                {Object.keys(data.usage.per_provider).length > 0 && (
                  <table className="w-full mt-3 text-xs">
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
                )}
                {data.usage.rate_limit_hits > 0 && (
                  <div className="text-[11px] text-warn mt-3">
                    NIM rate-limit hits since start: {data.usage.rate_limit_hits} — agents fell back to deterministic outputs and workflows still completed.
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-light mb-2">Rate-limit strategy</div>
                <ul className="text-xs text-ice/90 space-y-1.5">
                  <li>· NIM in-flight cap: <strong className="text-teal-glow">{data.rate_limit_strategy.nim_semaphore_max_inflight}</strong> (semaphore-bounded)</li>
                  <li>· NIM key pool: <strong className="text-teal-glow">{data.rate_limit_strategy.nim_keys_pooled}</strong> rotated</li>
                  <li>· Autonomous monitor poll: every <strong className="text-teal-glow">{data.rate_limit_strategy.monitor_poll_seconds}s</strong></li>
                  <li>· NimbleWay retry budget: <strong className="text-teal-glow">{data.rate_limit_strategy.nimble_retries}</strong> attempts, exponential backoff</li>
                  <li>· OpenAI SDK auto-retries: <strong className="text-teal-glow">{data.rate_limit_strategy.openai_sdk_max_retries}</strong></li>
                  <li className="text-slate-light text-[11px] pt-1">{data.rate_limit_strategy.graceful_fallbacks}</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 md:px-10 py-10 max-w-6xl mx-auto">
        <div className="text-[11px] uppercase tracking-widest text-slate-light">FAQ</div>
        <h2 className="font-serif text-2xl md:text-3xl text-ice mt-1 mb-5">The questions we get on every call.</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <Faq q="Can I start free and upgrade later?">
            Yes. Every account starts at Public Feed. Solo unlocks the moment your first x402 payment
            settles — no account upgrade flow. Hospital and Pharma start with a 14-day pilot; you keep
            the audit trail even if you don't convert.
          </Faq>
          <Faq q="How is Hospital pricing actually scoped?">
            $75k covers one facility with up to ~500 base workflows and ~5,000 sub-briefs per year (well
            above peak observed pharmacy load). Multi-facility systems get volume pricing. EHR integration
            is included; custom destinations (Slack, MS Teams, Epic InBasket) are part of pilot scoping.
          </Faq>
          <Faq q="Why is Pharma per-SKU, not flat?">
            Continuous PV monitoring per branded SKU is the unit pharma compliance teams already budget
            against. $150k/SKU includes 24/7 swarm coverage, custom adversarial counter-evidence agents
            tuned to your portfolio, and federal-program-aligned deployments. Portfolio discounts apply.
          </Faq>
          <Faq q="Is the $0.50 sub-brief profitable?">
            Yes — variable cost is ~$0.007 (mostly NIM tokens + Datadog spans). 98.6% gross margin makes
            this a pure-variable-revenue product with no per-customer fixed cost. We could go lower; we
            don't because $0.50 is the right price point for agent-economy procurement.
          </Faq>
          <Faq q="What's the SLA?">
            Public/Solo: best-effort. Hospital: 99.9% with 4-hour incident response, dedicated Slack.
            Pharma: 99.99% with 1-hour incident response, on-call engineering, and a custom MSA covering
            data residency and incident reporting cadence.
          </Faq>
          <Faq q="Where does the data live?">
            Hospital tier: dedicated ClickHouse Cloud tenant, US-East by default (EU-West optional). All
            audit logs are tenant-isolated and Joint Commission-ready. Pharma tier: dedicated tenant plus
            SOC2-ready logs and customer-managed encryption keys (CMEK).
          </Faq>
        </div>
      </section>

      {/* BOTTOM CTA */}
      <section className="px-6 md:px-10 py-14 max-w-6xl mx-auto text-center">
        <h2 className="font-serif text-3xl md:text-4xl text-ice glow-text">
          Start with the free feed. <em className="not-italic text-teal-glow">Pilot Hospital in two weeks.</em>
        </h2>
        <p className="text-slate-light mt-3 max-w-2xl mx-auto">
          No procurement cycle. No SaaS contract gymnastics. Read the feed today; spin up a Hospital
          pilot the moment your team is ready.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
          <a
            href="https://github.com/roshaninfordham/reflexagent/blob/main/cited.md"
            target="_blank"
            className="btn"
          >
            Open cited.md →
          </a>
          <a
            href="mailto:rsusny@gmail.com?subject=Reflex%20Hospital%20pilot"
            className="btn btn-primary shadow-glow"
          >
            Book a Hospital pilot →
          </a>
        </div>
      </section>
    </main>
  );
}

function TierCard({ tier }: { tier: Tier }) {
  const popular = !!tier.popular;
  const href = CTA_HREF[tier.cta] || '#';
  const external = href.startsWith('mailto:') || href.startsWith('http');
  return (
    <div
      className={`card p-5 flex flex-col relative ${
        popular ? 'border-teal-glow shadow-glow ring-1 ring-teal-glow/40' : ''
      }`}
    >
      {popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-teal-glow text-ink text-[10px] uppercase tracking-widest font-bold rounded-full">
          Most popular
        </div>
      )}
      <div className="text-xs uppercase tracking-widest text-slate-light">{tier.name}</div>
      <div className="mt-2">
        <span className={`text-3xl font-serif ${popular ? 'text-teal-glow' : 'text-ice'}`}>{tier.price}</span>
      </div>
      <div className="text-[11px] text-slate-light mt-0.5">{tier.cadence}</div>
      <div className="text-xs text-ice/85 mt-3 leading-relaxed min-h-[36px]">{tier.for}</div>
      <ul className="mt-3 space-y-1.5 text-[12px] text-ice/90 flex-1">
        {tier.includes.map((it, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="text-teal-glow shrink-0 mt-0.5">·</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
      {external ? (
        <a
          href={href}
          target={href.startsWith('http') ? '_blank' : undefined}
          className={`mt-4 text-xs text-center py-2.5 rounded ${popular ? 'btn btn-primary' : 'btn'}`}
        >
          {tier.cta} →
        </a>
      ) : (
        <Link
          href={href}
          className={`mt-4 text-xs text-center py-2.5 rounded ${popular ? 'btn btn-primary' : 'btn'}`}
        >
          {tier.cta} →
        </Link>
      )}
    </div>
  );
}

function Anchor({ strike, sub }: { strike: string; sub: string }) {
  return (
    <div>
      <div className="text-2xl md:text-3xl font-serif text-ice/55 line-through">{strike}</div>
      <div className="text-xs text-slate-light mt-1 leading-relaxed">{sub}</div>
    </div>
  );
}

function CostLine({ label, detail, cost, compact }: { label: string; detail: string; cost: string; compact?: boolean }) {
  return (
    <div className={`flex justify-between items-baseline ${compact ? 'py-1' : 'py-1.5'}`}>
      <div className="min-w-0">
        <div className="text-xs text-ice/90 truncate">{label}</div>
        <div className="text-[10px] text-slate-light truncate">{detail}</div>
      </div>
      <div className="text-xs text-ice font-mono tabular-nums shrink-0 ml-3">{cost}</div>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-sm font-semibold text-ice mb-1.5">{q}</div>
      <div className="text-xs text-slate-light leading-relaxed">{children}</div>
    </div>
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
