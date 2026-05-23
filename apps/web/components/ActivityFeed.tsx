'use client';

/**
 * ActivityFeed — live ticker of agent-triggered actions (memos sent, briefs
 * published, payments settled). Polls /api/v1/outbox/recent every 2.5s.
 * New rows slide in at the top.
 */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';

type Item = {
  sent_id: string;
  workflow_id: string;
  drug_name: string;
  channel: string;
  recipient_count: number;
  body_preview: string;
  triggered_by: string;
  sent_at: string;
};

const CHANNEL_LABEL: Record<string, { label: string; color: string; verb: string }> = {
  pharmacist_memo: { label: 'Pharmacist memo', color: 'text-teal-glow', verb: 'dispatched' },
  clinician_alert: { label: 'Clinician alert', color: 'text-warn', verb: 'pushed' },
  patient_letter: { label: 'Patient letter', color: 'text-ice', verb: 'mailed' },
  publish: { label: 'Brief publish', color: 'text-ok', verb: 'pushed to cited.md' },
  payment: { label: 'Payment', color: 'text-teal-glow', verb: 'settled' },
};

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleString();
}

export default function ActivityFeed({ limit = 12 }: { limit?: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const [flashId, setFlashId] = useState<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const [, setTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await api<{ items: Item[] }>(`/api/v1/outbox/recent?limit=${limit}`);
        if (!mounted) return;
        const next = data.items || [];
        // Flash the newest item if it's new since last fetch.
        const newest = next[0];
        if (newest && !seenIdsRef.current.has(newest.sent_id)) {
          setFlashId(newest.sent_id);
          setTimeout(() => setFlashId(null), 1800);
        }
        seenIdsRef.current = new Set(next.map((x) => x.sent_id));
        setItems(next);
      } catch {}
    };
    load();
    const i = setInterval(load, 2500);
    const t = setInterval(() => setTick((x) => x + 1), 1000); // re-render rel times
    return () => {
      mounted = false;
      clearInterval(i);
      clearInterval(t);
    };
  }, [limit]);

  const grouped = useMemo(() => items, [items]);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-teal">
            <span className="absolute inline-flex h-full w-full rounded-full bg-teal opacity-60 animate-ping" />
          </span>
          <span className="text-xs uppercase tracking-widest text-slate-light">
            Live activity · agent actions
          </span>
        </div>
        <span className="text-[10px] text-slate-light">
          {items.length} recent
        </span>
      </div>

      {grouped.length === 0 ? (
        <div className="text-xs text-slate-light italic">
          No agent actions yet. Trigger a workflow and ask the voice agent to "take next steps".
        </div>
      ) : (
        <ul className="space-y-2 max-h-80 overflow-y-auto scrollbar-thin pr-1">
          {grouped.map((it) => {
            const meta = CHANNEL_LABEL[it.channel] || {
              label: it.channel,
              color: 'text-ice',
              verb: 'executed',
            };
            const flashing = flashId === it.sent_id;
            return (
              <li
                key={it.sent_id}
                className={`text-[11px] border-l-2 pl-3 py-1 transition-all duration-700 ${
                  flashing
                    ? 'border-ok bg-ok/10'
                    : 'border-teal/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className={`font-semibold ${meta.color}`}>{meta.label}</span>
                    <span className="text-slate-light">{meta.verb}</span>
                    {it.recipient_count > 0 && (
                      <span className="text-ice/80">· {it.recipient_count} recipient{it.recipient_count !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <span className="text-slate-light whitespace-nowrap ml-2">
                    {relTime(it.sent_at)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-light mt-0.5">
                  <span className="truncate">
                    {it.drug_name ? (
                      <Link
                        href={`/workflow/${it.workflow_id}`}
                        className="text-teal-glow hover:underline"
                      >
                        {it.drug_name}
                      </Link>
                    ) : (
                      <span>workflow {it.workflow_id.slice(0, 8)}</span>
                    )}
                    {it.body_preview && <span className="ml-1.5 text-ice/60">· {it.body_preview}</span>}
                  </span>
                  <span className="text-[9px] uppercase tracking-widest ml-2 whitespace-nowrap">
                    {it.triggered_by}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
