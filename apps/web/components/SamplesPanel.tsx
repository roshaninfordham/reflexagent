'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { API_BASE, api } from '../lib/api';

type Sample = {
  slug: string;
  title: string;
  drug: string;
  manufacturer: string;
  class: string;
  image_url: string;
};

export default function SamplesPanel() {
  const router = useRouter();
  const [items, setItems] = useState<Sample[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await api<{ items: Sample[] }>('/api/v1/demo/samples');
        if (mounted) setItems(data.items);
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  async function launch(slug: string) {
    setBusy(`launch-${slug}`); setErr(null);
    try {
      const tryFetch = (url: string) => fetch(`${url}?slug=${slug}`, { method: 'POST' });
      let res: Response;
      try { res = await tryFetch(`${API_BASE}/api/v1/demo/launch`); }
      catch { res = await tryFetch(`/api/proxy/v1/demo/launch`); }
      const data = await res.json();
      router.push(data.workflow_id ? `/ops?wf=${data.workflow_id}` : '/ops');
    } catch (e: any) {
      setErr(e?.message || 'launch failed');
    } finally { setBusy(null); }
  }

  async function visionLaunch(slug: string) {
    setBusy(`vision-${slug}`); setErr(null);
    try {
      const imgRes = await fetch(`${API_BASE}/api/v1/demo/sample/${slug}.png`).catch(() =>
        fetch(`/api/proxy/v1/demo/sample/${slug}.png`)
      );
      const blob = await imgRes.blob();
      const file = new File([blob], `${slug}-fax.png`, { type: 'image/png' });
      const fd = new FormData();
      fd.append('file', file);
      const up = await fetch(`${API_BASE}/api/v1/ingest/vision`, { method: 'POST', body: fd }).catch(() =>
        fetch(`/api/proxy/v1/ingest/vision`, { method: 'POST', body: fd })
      );
      const data = await up.json();
      router.push(data.workflow_id ? `/ops?wf=${data.workflow_id}` : '/ops');
    } catch (e: any) {
      setErr(e?.message || 'vision failed');
    } finally { setBusy(null); }
  }

  if (!items.length) return null;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-widest text-slate-light">Sample recall files · test the swarm</span>
        <span className="text-[10px] text-slate-light">{items.length} samples</span>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((s) => (
          <div key={s.slug} className="card p-3 flex flex-col">
            <div className="bg-paper rounded mb-2 flex items-center justify-center" style={{ aspectRatio: '3/4', overflow: 'hidden' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={s.title}
                src={`${API_BASE}${s.image_url}`}
                className="max-h-full max-w-full object-contain"
                onError={(e) => { (e.target as HTMLImageElement).src = `/api/proxy${s.image_url.replace(/^\/api/, '')}`; }}
              />
            </div>
            <div className="text-sm font-semibold text-ice truncate">{s.title}</div>
            <div className="text-[10px] text-slate-light mb-2">Class {s.class} · {s.manufacturer}</div>
            <div className="mt-auto flex gap-1.5 flex-wrap">
              <button
                className="btn btn-primary text-[11px] py-1 px-2"
                disabled={busy !== null}
                onClick={() => launch(s.slug)}
                title="Trigger this recall workflow directly"
              >
                {busy === `launch-${s.slug}` ? '…' : 'Launch'}
              </button>
              <button
                className="btn text-[11px] py-1 px-2"
                disabled={busy !== null}
                onClick={() => visionLaunch(s.slug)}
                title="Upload this image through the NIM vision pipeline first"
              >
                {busy === `vision-${s.slug}` ? '…' : 'Vision'}
              </button>
              <a
                href={`${API_BASE}${s.image_url}`}
                download={`recall-${s.slug}.png`}
                className="btn text-[11px] py-1 px-2"
                title="Download PNG"
              >⬇</a>
            </div>
          </div>
        ))}
      </div>
      {err && <div className="mt-3 text-xs text-alert">{err}</div>}
      <div className="text-[10px] text-slate-light mt-3 leading-relaxed">
        Launch fires the workflow directly. Vision uploads the same image through the
        NIM Llama 3.2 90B vision endpoint first to extract NDC + lots from a faxed recall — proves
        the multimodal path. ⬇ downloads the PNG so you can drag it onto the dropzone above.
      </div>
    </div>
  );
}
