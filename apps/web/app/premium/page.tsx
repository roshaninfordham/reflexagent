'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { API_BASE, api } from '../../lib/api';

type RecentWF = {
  workflow_id: string;
  brief?: { title: string; drug_name: string } | null;
  status: string;
};

type WalletInfo = {
  address: string;
  address_url: string;
  chain: string;
  chain_id: number;
  eth_balance_wei: number;
  usdc_balance_micro: number;
  usdc_decimals: number;
  faucets: {
    eth_primary: string;
    eth_fallbacks: string[];
    usdc: string;
    instructions: string;
  };
};

type Settlement = {
  tx_hash: string;
  explorer_url: string;
  from: string;
  to: string;
  amount_usd: number;
  chain: string;
  receipt?: { block_number: number | null; status: number; gas_used: number } | null;
};

const QUICK_QUESTIONS = [
  { label: 'CKD subgroup', q: 'Slice the affected cohort by CKD stage (1–5) and recommend dose adjustments per KDIGO.' },
  { label: 'Pregnancy contraindications', q: 'Identify pregnancy-category risks for this drug and the formulary alternatives I should switch to.' },
  { label: 'Elderly dosing', q: 'Recommend geriatric dose ranges and monitoring frequency for patients ≥65 with comorbid heart failure.' },
  { label: 'DDI scan', q: 'Scan for drug–drug interactions against my top 10 dispensed medications; flag QT-prolongation risks.' },
  { label: 'Formulary swap', q: 'Rank therapeutic substitutes by target similarity, formulary availability, and per-pill cost differential.' },
];

const SAMPLE_BRIEF = `**Sub-brief — Valsartan recall · CKD subgroup analysis** ($0.50 settled · 8.4 s)

**Scope.** 124 patients in the affected cohort. 38 have CKD stage 3+ (eGFR <60).

**Key findings**

  · Patients with eGFR 30–59 on valsartan 160 mg: 19 individuals. ACE-inhibitor swap
    to lisinopril 10 mg is appropriate; dose reduction not required.
  · 7 patients with eGFR 15–29 are at elevated hyperkalemia risk on ACEi. Recommend
    olmesartan 20 mg (also ARB class, no contamination flagged) with K+ monitoring
    at 1 week.
  · 12 patients hold concurrent spironolactone — these should be switched to
    losartan, not olmesartan, to preserve combined ARB + MRA tolerability.

**Substitutes ranked by ESM2 target similarity to AT1 receptor**

  1. Losartan       (sim 0.98)  — same class, no nitrosamine recall to date
  2. Olmesartan     (sim 0.96)  — same class, clean supply chain
  3. Lisinopril     (sim 0.61)  — ACE inhibitor, different mechanism
  4. Spironolactone (sim 0.44)  — MRA, adjunct only

**Routing**

  · 38 patient letters drafted (CKD-stratified language).
  · 6 clinician alerts ready (one per attending on internal medicine service).
  · 1 pharmacy quarantine memo with NDC + lot range.

Cited 7 sources: openFDA enforcement report, KDIGO 2024 BP guideline,
PubMed pmid 35621444, …`;

const fmtUsdc = (micro: number) => (micro / 1_000_000).toFixed(4);
const fmtEth = (wei: number) => (wei / 1e18).toFixed(6);

export default function PremiumPage() {
  const [workflows, setWorkflows] = useState<RecentWF[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [question, setQuestion] = useState(QUICK_QUESTIONS[0].q);
  const [paying, setPaying] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showWallet, setShowWallet] = useState(false);
  const [showFaucet, setShowFaucet] = useState(false);
  const [onChain, setOnChain] = useState(false);

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
    const i = setInterval(load, 4000);
    return () => { mounted = false; clearInterval(i); };
  }, [chosen]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const w = await api<WalletInfo>('/api/v1/payments/wallet');
        if (mounted) setWallet(w);
      } catch {}
    };
    load();
    const i = setInterval(load, 7000);
    return () => { mounted = false; clearInterval(i); };
  }, []);

  async function copyAddress() {
    if (!wallet?.address) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const usdcBal = wallet ? wallet.usdc_balance_micro / 1_000_000 : 0;
  const ethBal = wallet ? wallet.eth_balance_wei / 1e18 : 0;
  const canSettle = usdcBal >= 0.5 && ethBal > 0;

  async function pay() {
    setPaying(true); setErr(null); setAnswer(null); setSettlement(null);
    try {
      if (onChain) {
        if (!canSettle) {
          setShowWallet(true);
          setShowFaucet(true);
          throw new Error('Wallet not funded — see Funding panel below.');
        }
        const res = await fetch(`${API_BASE}/api/v1/premium-subbrief`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflow_id: chosen, question }),
        });
        if (res.status === 402) {
          const body = await res.json();
          throw new Error(`Wallet not funded yet. Send USDC + ETH to ${body.fund_burner?.address || wallet?.address}.`);
        }
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        const data = await res.json();
        setAnswer(data.answer || '(empty)');
        setSettlement(data.settlement || null);
      } else {
        const tok = await api<{ x_payment_header: string }>('/api/v1/payments/dev-token');
        const res = await fetch(`${API_BASE}/api/v1/premium-subbrief`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-PAYMENT': tok.x_payment_header },
          body: JSON.stringify({ workflow_id: chosen, question }),
        });
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        const data = await res.json();
        setAnswer(data.answer || '(empty)');
        setSettlement(data.settlement || null);
      }
    } catch (e: any) { setErr(e?.message || 'payment failed'); }
    finally { setPaying(false); }
  }

  return (
    <main className="grid-bg min-h-screen">
      <header className="px-6 md:px-10 pt-6 pb-4 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md bg-[var(--bg-1)]/70 border-b border-teal/10">
        <Link href="/" className="text-xs uppercase tracking-widest text-slate-light hover:text-teal-glow">← back</Link>
        <span className="text-[11px] uppercase tracking-widest text-teal-glow">
          x402 · agent-native · base sepolia testnet
        </span>
      </header>

      {/* HERO */}
      <section className="px-6 md:px-10 pt-12 pb-8 max-w-5xl mx-auto">
        <div className="text-[11px] uppercase tracking-widest text-teal-glow">Pricing · Pay-per-question</div>
        <h1 className="font-serif text-4xl md:text-5xl text-ice mt-2 leading-[1.05] glow-text">
          <span className="text-teal-glow">$0.50</span> per verified sub-brief.<br />
          Settled in seconds. <em className="not-italic text-ice/70">No contract. No invoice.</em>
        </h1>
        <p className="text-base md:text-lg text-slate-light mt-5 max-w-2xl leading-relaxed">
          Reflex sub-briefs are deeper analyses layered on a published brief — subgroup
          slicing, formulary alternatives, ESM2-ranked substitutes — generated in
          ~10 seconds and paid via <strong className="text-ice">x402 over USDC</strong>.
          Built for AI agents to call autonomously. Usable by humans too.
        </p>
      </section>

      {/* TRUST STRIP */}
      <section className="px-6 md:px-10 pb-8 max-w-5xl mx-auto">
        <div className="grid md:grid-cols-3 gap-3">
          <div className="card p-4">
            <div className="text-[10px] uppercase tracking-widest text-teal-glow">Real settlement</div>
            <div className="text-sm text-ice mt-1.5 font-semibold">Coinbase CDP + Base Sepolia</div>
            <div className="text-xs text-slate-light mt-1">
              Every payment leaves an on-chain tx + BaseScan receipt. Signed-proof variant
              for instant demos. Same x402 protocol; switch with one toggle.
            </div>
          </div>
          <div className="card p-4">
            <div className="text-[10px] uppercase tracking-widest text-teal-glow">Verified by the swarm</div>
            <div className="text-sm text-ice mt-1.5 font-semibold">11 agents · NIM Llama 3.3 70B</div>
            <div className="text-xs text-slate-light mt-1">
              Pulls from your existing brief's evidence pack — openFDA, PubMed, KDIGO —
              and runs adversarial counter-evidence before answering.
            </div>
          </div>
          <div className="card p-4">
            <div className="text-[10px] uppercase tracking-widest text-teal-glow">Audit-logged</div>
            <div className="text-sm text-ice mt-1.5 font-semibold">ClickHouse + Datadog LLM Obs</div>
            <div className="text-xs text-slate-light mt-1">
              Question, payer wallet, tx hash, model latency, token cost — every sub-brief
              is fully traceable for compliance and chargeback.
            </div>
          </div>
        </div>
      </section>

      {/* WHAT YOU GET */}
      <section className="px-6 md:px-10 py-10 max-w-5xl mx-auto">
        <div className="text-[11px] uppercase tracking-widest text-slate-light">What you get for fifty cents</div>
        <h2 className="font-serif text-2xl md:text-3xl text-ice mt-1">
          A pharmacist-grade analysis your team can act on, in the time it takes to refill coffee.
        </h2>
        <div className="grid md:grid-cols-5 gap-5 mt-6">
          <div className="md:col-span-2 space-y-3">
            <Bullet title="Cohort slicing">
              SQL run live against your ClickHouse patient cohort — by CKD stage, age band,
              pregnancy status, concurrent therapy.
            </Bullet>
            <Bullet title="ESM2-ranked substitutes">
              BioNeMo protein embedding similarity over your formulary, weighted by
              availability and per-pill cost.
            </Bullet>
            <Bullet title="Subgroup risk math">
              Hyperkalemia, QT, hepatotoxicity, pregnancy-class breakdown per affected
              subcohort with KDIGO / AHA citations.
            </Bullet>
            <Bullet title="Routing-ready drafts">
              Pharmacist memo + clinician alert + patient letter — each tailored to the
              subgroup, ready to dispatch from /ops.
            </Bullet>
            <Bullet title="Cited & traceable">
              Every claim links a primary source. Question + answer + payer + tx hash
              landed in ClickHouse for audit.
            </Bullet>
          </div>
          <div className="md:col-span-3">
            <div className="card p-4 bg-ink/40">
              <div className="text-[10px] uppercase tracking-widest text-teal-glow mb-2">Sample sub-brief output</div>
              <pre className="text-[11px] md:text-xs text-ice/90 whitespace-pre-wrap leading-relaxed font-mono overflow-hidden">
{SAMPLE_BRIEF}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* PRICE ANCHOR */}
      <section className="px-6 md:px-10 py-8 max-w-5xl mx-auto">
        <div className="card p-6 md:p-7">
          <div className="text-[10px] uppercase tracking-widest text-slate-light">For comparison</div>
          <div className="grid md:grid-cols-3 gap-5 mt-3 items-end">
            <div>
              <div className="text-3xl md:text-4xl font-serif text-ice/60 line-through">$500/hr</div>
              <div className="text-sm text-slate-light mt-1">External pharmacy benefits consultant. 30 min turnaround if you're lucky.</div>
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-serif text-ice/60 line-through">$200</div>
              <div className="text-sm text-slate-light mt-1">A custom PubMed deep-dive from your medical librarian. 2-day turnaround.</div>
            </div>
            <div className="border-l border-teal/30 pl-5">
              <div className="text-4xl md:text-5xl font-serif text-teal-glow">$0.50</div>
              <div className="text-sm text-ice mt-1 font-semibold">One Reflex sub-brief.</div>
              <div className="text-xs text-slate-light mt-0.5">~10 seconds. Cited. Audit-logged. <span className="text-teal-glow">1000× cheaper.</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* TRY IT */}
      <section className="px-6 md:px-10 py-10 max-w-5xl mx-auto">
        <div className="text-[11px] uppercase tracking-widest text-teal-glow">Try it now · live demo</div>
        <h2 className="font-serif text-2xl md:text-3xl text-ice mt-1">Pay $0.50, get a sub-brief back in ten seconds.</h2>
        <div className="card p-5 md:p-6 mt-5 space-y-4">
          {/* Brief selector */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-slate-light">1 · pick a base brief</label>
            <select
              className="mt-1.5 w-full bg-ink/60 border border-teal/20 rounded px-3 py-2.5 text-ice text-sm focus:border-teal-glow focus:outline-none"
              value={chosen || ''}
              onChange={(e) => setChosen(e.target.value)}
            >
              {workflows.length === 0 && (
                <option value="">No completed workflows yet — fire one from /ops or the landing page</option>
              )}
              {workflows.map((w) => (
                <option key={w.workflow_id} value={w.workflow_id}>
                  {w.brief?.title || w.brief?.drug_name || w.workflow_id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>

          {/* Quick questions */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-slate-light">2 · pick a question (or write your own)</label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {QUICK_QUESTIONS.map((q) => {
                const active = question === q.q;
                return (
                  <button
                    key={q.label}
                    onClick={() => setQuestion(q.q)}
                    className={`text-[11px] px-2.5 py-1 rounded border transition-colors ${
                      active
                        ? 'bg-teal/15 border-teal-glow text-teal-glow'
                        : 'bg-ink/40 border-teal/15 text-ice/85 hover:border-teal-glow hover:text-teal-glow'
                    }`}
                  >
                    {q.label}
                  </button>
                );
              })}
            </div>
            <textarea
              className="mt-2 w-full bg-ink/60 border border-teal/20 rounded px-3 py-2 text-ice text-sm min-h-[80px] focus:border-teal-glow focus:outline-none scrollbar-thin"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>

          {/* Pay row */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button
              className="btn btn-primary text-base py-3 px-6 shadow-glow"
              disabled={paying || !chosen}
              onClick={pay}
            >
              {paying ? (onChain ? 'Settling on-chain…' : 'Paying & generating…') : `Pay $0.50 · get sub-brief`}
            </button>
            <label className="flex items-center gap-2 text-[11px] text-slate-light cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onChain}
                onChange={(e) => setOnChain(e.target.checked)}
                className="accent-teal"
              />
              Settle on-chain instead{' '}
              <span className={onChain && !canSettle ? 'text-warn' : 'text-slate-light'}>
                {onChain ? (canSettle ? '· wallet funded ✓' : '· needs test ETH first') : ''}
              </span>
            </label>
          </div>
          {err && <div className="text-xs text-alert bg-alert/10 border border-alert/30 rounded p-2">{err}</div>}
        </div>

        {/* Settlement receipt */}
        {settlement && (
          <div className="card p-5 mt-4 bg-ok/5 border-ok/30">
            <div className="text-[10px] uppercase tracking-widest text-ok mb-2">On-chain settlement · Base Sepolia</div>
            <div className="grid sm:grid-cols-4 gap-2 text-xs">
              <Field label="From" value={settlement.from} mono />
              <Field label="To" value={settlement.to} mono />
              <Field label="Amount" value={`${settlement.amount_usd.toFixed(2)} USDC`} />
              <Field label="Block" value={String(settlement.receipt?.block_number ?? 'pending…')} />
            </div>
            <a
              href={settlement.explorer_url}
              target="_blank"
              className="inline-block mt-2 text-teal-glow hover:underline text-xs break-all font-mono"
            >
              {settlement.tx_hash} ↗
            </a>
          </div>
        )}

        {/* Sub-brief output */}
        {answer && (
          <div className="card p-5 mt-4">
            <div className="text-[10px] uppercase tracking-widest text-teal-glow mb-2">Your sub-brief</div>
            <div className="whitespace-pre-wrap text-ice/95 leading-relaxed text-sm">{answer}</div>
          </div>
        )}

        {/* Collapsed wallet — only shown when expanded or after an error */}
        <div className="card mt-4 overflow-hidden">
          <button
            onClick={() => setShowWallet((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-ink/40 transition-colors"
          >
            <div className="text-[11px] text-slate-light">
              <span className="uppercase tracking-widest mr-2">Reflex burner</span>
              {wallet ? (
                <span className="font-mono text-ice">
                  {wallet.address.slice(0, 10)}…{wallet.address.slice(-6)}
                </span>
              ) : (
                <span>loading…</span>
              )}
              {wallet && (
                <span className={`ml-3 ${canSettle ? 'text-ok' : 'text-slate-light'}`}>
                  · {usdcBal.toFixed(2)} USDC · {ethBal.toFixed(4)} ETH
                </span>
              )}
            </div>
            <span className="text-[11px] text-teal-glow">{showWallet ? 'hide ▴' : 'show ▾'}</span>
          </button>
          {showWallet && wallet && (
            <div className="px-4 pb-4 border-t border-teal/10 pt-3 space-y-3">
              <div className="flex items-center gap-2 font-mono text-xs bg-ink/60 border border-teal/15 rounded px-3 py-2">
                <span className="truncate flex-1 text-ice">{wallet.address}</span>
                <button onClick={copyAddress} className="text-[10px] text-teal-glow hover:underline">
                  {copied ? 'copied' : 'copy'}
                </button>
                <a href={wallet.address_url} target="_blank" className="text-[10px] text-teal-glow hover:underline">
                  BaseScan ↗
                </a>
              </div>
              <button
                onClick={() => setShowFaucet((v) => !v)}
                className="text-[11px] text-teal-glow hover:underline"
              >
                {showFaucet ? 'Hide funding instructions' : 'Need test funds for on-chain mode? ▾'}
              </button>
              {showFaucet && (
                <div className="text-xs bg-warn/10 border border-warn/30 rounded p-3 space-y-2">
                  <ol className="text-ice/90 space-y-2 ml-4 list-decimal">
                    <li>
                      <a href={wallet.faucets.usdc} target="_blank" className="text-teal-glow hover:underline">
                        Circle USDC faucet ↗
                      </a>{' '}
                      → paste the address → choose <strong>Base Sepolia</strong> → request 10 USDC.
                    </li>
                    <li>
                      <span>Get test ETH for gas — pick any one:</span>
                      <ul className="mt-1 ml-3 space-y-0.5 list-disc text-ice/80">
                        <li>
                          <a href={wallet.faucets.eth_primary} target="_blank" className="text-teal-glow hover:underline">
                            Coinbase CDP faucet ↗
                          </a>{' '}
                          (official, needs Coinbase login)
                        </li>
                        {wallet.faucets.eth_fallbacks?.map((url) => (
                          <li key={url}>
                            <a href={url} target="_blank" className="text-teal-glow hover:underline">
                              {url.replace(/^https?:\/\//, '').replace(/\/$/, '')} ↗
                            </a>
                          </li>
                        ))}
                      </ul>
                    </li>
                  </ol>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* FOR AGENTS */}
      <section className="px-6 md:px-10 py-10 max-w-5xl mx-auto">
        <div className="text-[11px] uppercase tracking-widest text-teal-glow">For other agents · the differentiator</div>
        <h2 className="font-serif text-2xl md:text-3xl text-ice mt-1">
          Your agents pay mine autonomously. No keys. No contracts. No procurement.
        </h2>
        <p className="text-sm text-slate-light mt-3 max-w-3xl">
          x402 is HTTP-native — your agent hits Reflex, gets back <code className="text-ice bg-ink/60 px-1 rounded">402 Payment Required</code>,
          signs a settlement, retries. Total elapsed: ~1.2 s for the payment + ~8 s for the sub-brief. No
          API key, no SaaS account, no purchase order.
        </p>
        <div className="card p-5 mt-5 bg-ink/40">
          <pre className="text-xs md:text-sm text-ice/95 leading-relaxed font-mono overflow-x-auto">
{`// Any agent. Any framework. One HTTP call.
const result = await fetch('https://reflex.health/api/v1/premium-subbrief', {
  method: 'POST',
  headers: { 'X-PAYMENT': await x402.sign({ amount: '0.50 USDC', chain: 'base' }) },
  body: JSON.stringify({
    workflow_id: 'd4277488-…',
    question:    'CKD subgroup formulary swap for valsartan recall',
  }),
}).then(r => r.json());

result.answer       // → cited sub-brief markdown
result.settlement   // → { tx_hash, explorer_url, block }`}
          </pre>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 md:px-10 py-10 max-w-5xl mx-auto">
        <div className="text-[11px] uppercase tracking-widest text-slate-light">FAQ</div>
        <div className="grid md:grid-cols-2 gap-4 mt-3">
          <Faq q="Is this real money?">
            No — Reflex demos on <strong>Base Sepolia testnet</strong> with test USDC and test ETH. The
            settlement is a real on-chain transaction with a BaseScan receipt, but the tokens have zero
            cash value. Production flips one config flag to Base mainnet.
          </Faq>
          <Faq q="Who can pay me?">
            Anyone — human or agent — that can sign an x402 payment proof. We accept both signed-HMAC
            (instant, off-chain) and on-chain USDC transfers. Both satisfy the same protocol; your agent
            picks based on cost vs. provenance.
          </Faq>
          <Faq q="How fast is a sub-brief?">
            Median <strong>8.4 seconds</strong> from settle to first token. The deep-analysis pass uses
            NIM Llama 3.3 70B with the base brief's full evidence pack pre-loaded — no re-fetching from
            openFDA or PubMed.
          </Faq>
          <Faq q="What if the answer is wrong?">
            Every sub-brief lands in ClickHouse with the question, answer, payer wallet, and tx hash.
            Operators can flag bad outputs — and because the payment was on-chain, refunds are settled
            the same way. Full audit trail.
          </Faq>
        </div>
      </section>

      {/* BOTTOM CTA */}
      <section className="px-6 md:px-10 py-14 max-w-5xl mx-auto text-center">
        <h2 className="font-serif text-3xl md:text-4xl text-ice glow-text">
          Try it. The fifty cents is on us — literally.
        </h2>
        <p className="text-slate-light mt-3 max-w-xl mx-auto">
          Pick a base brief, pick a question, click pay. You'll see a real BaseScan transaction
          and a cited sub-brief inside ten seconds.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
          <a href="#try" onClick={(e) => { e.preventDefault(); document.querySelector('.btn-primary')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
             className="btn btn-primary text-base py-3 px-6 shadow-glow">
            Pay $0.50 now →
          </a>
          <Link href="/ops" className="btn">See the swarm running →</Link>
        </div>
      </section>
    </main>
  );
}

function Bullet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <div className="text-teal-glow font-mono mt-0.5 shrink-0">▸</div>
      <div className="text-xs md:text-sm">
        <div className="text-ice font-semibold">{title}</div>
        <div className="text-slate-light leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-slate-light">{label}</div>
      <div className={`${mono ? 'font-mono' : ''} text-ice truncate`} title={value}>{value}</div>
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
