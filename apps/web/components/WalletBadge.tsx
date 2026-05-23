'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type WalletInfo = {
  address: string;
  address_url: string;
  eth_balance_wei: number;
  usdc_balance_micro: number;
};

export default function WalletBadge() {
  const [w, setW] = useState<WalletInfo | null>(null);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const x = await api<WalletInfo>('/api/v1/payments/wallet');
        if (mounted) setW(x);
      } catch {}
    };
    load();
    const i = setInterval(load, 8000);
    return () => { mounted = false; clearInterval(i); };
  }, []);
  const usdc = w ? w.usdc_balance_micro / 1_000_000 : 0;
  const eth = w ? w.eth_balance_wei / 1e18 : 0;
  return (
    <div className="card p-3 text-xs">
      <div className="flex items-center justify-between mb-2">
        <span className="uppercase tracking-widest text-slate-light">Burner wallet · Base Sepolia</span>
        {w && (
          <a href={w.address_url} target="_blank" className="text-teal-glow hover:underline">
            BaseScan ↗
          </a>
        )}
      </div>
      <div className="font-mono text-[10px] text-ice/80 truncate">{w?.address}</div>
      <div className="grid grid-cols-2 gap-2 mt-2 text-center">
        <div className="bg-ink/40 rounded p-2">
          <div className={`text-base tabular-nums ${usdc >= 0.5 ? 'text-ok' : 'text-warn'}`}>{usdc.toFixed(4)}</div>
          <div className="text-[9px] uppercase tracking-widest text-slate-light mt-0.5">USDC test</div>
        </div>
        <div className="bg-ink/40 rounded p-2">
          <div className={`text-base tabular-nums ${eth > 0 ? 'text-ok' : 'text-warn'}`}>{eth.toFixed(6)}</div>
          <div className="text-[9px] uppercase tracking-widest text-slate-light mt-0.5">ETH gas</div>
        </div>
      </div>
    </div>
  );
}
