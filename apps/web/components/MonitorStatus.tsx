'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type Novel = {
  external_id: string;
  drug_name: string;
  manufacturer: string;
  at: string;
};

type Status = {
  running: boolean;
  last_poll_at: string | null;
  poll_count: number;
  signals_reviewed: number;
  novel_triggered: number;
  last_novel_id: string | null;
  recent_novels: Novel[];
};

function rel(ts: string | null): string {
  if (!ts) return 'never';
  const t = new Date(ts).getTime();
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export default function MonitorStatus() {
  const [st, setSt] = useState<Status | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const s = await api<Status>('/api/v1/monitor/status');
        if (mounted) setSt(s);
      } catch {}
    };
    load();
    const i = setInterval(load, 3000);
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => {
      mounted = false;
      clearInterval(i);
      clearInterval(t);
    };
  }, []);

  const dotColor = st?.running ? 'bg-ok' : 'bg-slate-light';
  const polledLabel = rel(st?.last_poll_at || null);
  void tick;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`relative inline-flex w-2.5 h-2.5 rounded-full ${dotColor}`}>
            {st?.running && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-ok opacity-60 animate-ping" />
            )}
          </span>
          <span className="text-xs uppercase tracking-widest text-slate-light">
            Autonomous monitor
          </span>
        </div>
        <span className="text-xs text-slate-light">OpenFDA · every 30s</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <Stat label="Last poll" value={polledLabel} />
        <Stat label="Signals reviewed" value={(st?.signals_reviewed ?? 0).toLocaleString()} />
        <Stat label="Novel · triggered" value={(st?.novel_triggered ?? 0).toLocaleString()} accent />
      </div>

      <div className="mt-5">
        <div className="text-[11px] uppercase tracking-widest text-slate-light mb-2">
          Recent autonomous triggers
        </div>
        {(!st?.recent_novels || st.recent_novels.length === 0) ? (
          <div className="text-sm text-slate-light italic">
            Waiting for the next novel signal to hit the wire…
          </div>
        ) : (
          <ul className="space-y-1.5">
            {st.recent_novels.slice(0, 5).map((n) => (
              <li key={n.external_id} className="flex items-center justify-between text-sm">
                <span className="truncate">{n.drug_name}</span>
                <span className="text-xs text-slate-light ml-2 whitespace-nowrap">
                  {rel(n.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className={`text-2xl font-semibold tabular-nums ${accent ? 'text-teal-glow glow-text' : 'text-ice'}`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-widest text-slate-light mt-0.5">{label}</div>
    </div>
  );
}
