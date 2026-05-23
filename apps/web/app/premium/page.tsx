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

const fmtUsdc = (micro: number) => (micro / 1_000_000).toFixed(4);
const fmtEth = (wei: number) => (wei / 1e18).toFixed(6);

export default function PremiumPage() {
  const [workflows, setWorkflows] = useState<RecentWF[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [question, setQuestion] = useState('Slice the cohort by CKD stage and pregnancy status; recommend formulary substitutes.');
  const [paying, setPaying] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'chain' | 'jwt'>('chain');

  // Workflows
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

  // Wallet polling
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

  async function payViaChain() {
    setPaying(true); setErr(null); setAnswer(null); setSettlement(null);
    try {
      // Backend will auto-settle from the burner if X-PAYMENT is absent
      // (provided the wallet has USDC + ETH for gas). It returns the
      // sub-brief + the settlement object including the BaseScan tx hash.
      const res = await fetch(`${API_BASE}/api/v1/premium-subbrief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow_id: chosen, question }),
      });
      if (res.status === 402) {
        const body = await res.json();
        throw new Error(
          `Wallet not funded yet. Send USDC + ETH to ${body.fund_burner?.address || wallet?.address} on Base Sepolia.`,
        );
      }
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const data = await res.json();
      setAnswer(data.answer || '(empty)');
      setSettlement(data.settlement || null);
    } catch (e: any) { setErr(e?.message || 'payment failed'); }
    finally { setPaying(false); }
  }

  async function payViaJwt() {
    setPaying(true); setErr(null); setAnswer(null); setSettlement(null);
    try {
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
    } catch (e: any) { setErr(e?.message || 'payment failed'); }
    finally { setPaying(false); }
  }

  const usdcBal = wallet ? wallet.usdc_balance_micro / 1_000_000 : 0;
  const ethBal = wallet ? wallet.eth_balance_wei / 1e18 : 0;
  const canSettle = usdcBal >= 0.5 && ethBal > 0;

  return (
    <main className="grid-bg min-h-screen">
      <header className="px-6 md:px-10 pt-6 pb-4 flex items-center justify-between">
        <Link href="/" className="text-xs uppercase tracking-widest text-slate-light hover:text-teal-glow">← back</Link>
        <span className="text-[11px] uppercase tracking-widest text-slate-light">Premium sub-brief · x402 · Base Sepolia testnet</span>
      </header>

      <section className="max-w-3xl mx-auto px-6 md:px-10 py-6 space-y-6">
        <div>
          <h1 className="font-serif text-3xl md:text-4xl text-ice glow-text">$0.50 per query.</h1>
          <p className="text-slate-light mt-2">
            Pay-per-question premium analysis layered on any published brief. Settled on Base Sepolia testnet
            via Coinbase CDP — <span className="text-teal-glow">zero real money, real on-chain receipts</span>.
          </p>
        </div>

        {/* Wallet panel */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-widest text-slate-light">Reflex burner wallet · Base Sepolia</span>
            {wallet && (
              <a href={wallet.address_url} target="_blank" className="text-[10px] text-teal-glow hover:underline">
                view on BaseScan ↗
              </a>
            )}
          </div>
          {wallet ? (
            <>
              <div className="flex items-center gap-2 font-mono text-sm bg-ink/60 border border-teal/15 rounded px-3 py-2">
                <span className="truncate flex-1 text-ice">{wallet.address}</span>
                <button onClick={copyAddress} className="text-[10px] text-teal-glow hover:underline">
                  {copied ? 'copied' : 'copy'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3 text-center">
                <div className="bg-ink/40 border border-teal/10 rounded p-2.5">
                  <div className={`text-xl font-semibold tabular-nums ${usdcBal >= 0.5 ? 'text-ok' : 'text-warn'}`}>
                    {usdcBal.toFixed(4)}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-light mt-0.5">USDC (test)</div>
                </div>
                <div className="bg-ink/40 border border-teal/10 rounded p-2.5">
                  <div className={`text-xl font-semibold tabular-nums ${ethBal > 0 ? 'text-ok' : 'text-warn'}`}>
                    {ethBal.toFixed(6)}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-light mt-0.5">ETH for gas</div>
                </div>
              </div>
              {!canSettle && (
                <div className="mt-3 text-xs bg-warn/10 border border-warn/30 rounded p-3">
                  <div className="text-warn font-semibold mb-1.5">Fund the burner once (free, takes ~30 seconds)</div>
                  <ol className="text-ice/90 space-y-2 ml-4 list-decimal">
                    <li>
                      <a href={wallet.faucets.usdc} target="_blank" className="text-teal-glow hover:underline">
                        Circle USDC faucet ↗
                      </a>{' '}
                      → paste the address → choose <strong>Base Sepolia</strong> → request 10 USDC.
                    </li>
                    <li>
                      <span className="font-medium">Get test ETH for gas — pick any one:</span>
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
            </>
          ) : (
            <div className="text-sm text-slate-light italic">loading wallet…</div>
          )}
        </div>

        {/* Query form */}
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

          <div className="flex gap-2">
            <button
              className="btn btn-primary flex-1"
              disabled={paying || !chosen || !canSettle}
              onClick={payViaChain}
              title={canSettle ? 'Send 0.50 USDC on Base Sepolia and unlock the sub-brief' : 'Fund the wallet first'}
            >
              {paying ? 'Settling on-chain…' : 'Pay $0.50 on-chain · Settle on Base Sepolia'}
            </button>
            <button
              className="btn"
              disabled={paying || !chosen}
              onClick={payViaJwt}
              title="Skip chain settlement — use the JWT-stub path"
            >
              Dev pay (JWT)
            </button>
          </div>
          {err && <div className="text-xs text-alert">{err}</div>}
        </div>

        {/* Settlement receipt */}
        {settlement && (
          <div className="card p-5 bg-ok/5 border-ok/30">
            <div className="text-[11px] uppercase tracking-widest text-ok mb-2">On-chain settlement</div>
            <div className="grid sm:grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-slate-light">From</div>
                <div className="font-mono text-ice truncate">{settlement.from}</div>
              </div>
              <div>
                <div className="text-slate-light">To</div>
                <div className="font-mono text-ice truncate">{settlement.to}</div>
              </div>
              <div>
                <div className="text-slate-light">Amount</div>
                <div className="text-ice">{settlement.amount_usd.toFixed(2)} USDC</div>
              </div>
              <div>
                <div className="text-slate-light">Block</div>
                <div className="text-ice">{settlement.receipt?.block_number ?? 'pending…'}</div>
              </div>
            </div>
            <a
              href={settlement.explorer_url}
              target="_blank"
              className="inline-block mt-3 text-teal-glow hover:underline text-sm break-all"
            >
              {settlement.tx_hash} ↗
            </a>
          </div>
        )}

        {/* Sub-brief output */}
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
