'use client';

/**
 * AlphaFold protein structure viewer — predicted structures from EBI's
 * AlphaFold DB (CC-BY 4.0). Used when the LLM identifies a target the
 * Substitute agent ranked but RCSB doesn't have an experimental structure.
 *
 * Renders with 3Dmol.js colored by pLDDT (AlphaFold confidence):
 *   dark blue  = very high confidence (>90)
 *   light blue = confident (70-90)
 *   yellow     = low (50-70)
 *   orange     = very low (<50)
 */

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

type AFResp = {
  target: string;
  found: boolean;
  uniprot?: string;
  label?: string;
  pdb_url?: string;
  viewer_url?: string;
  organism?: string;
  gene?: string;
  description?: string;
  sequence_length?: number;
  version?: number;
  confidence_summary?: number; // mean pLDDT 0–100
};

declare global { interface Window { $3Dmol?: any; } }

let load3DmolPromise: Promise<any> | null = null;
function load3Dmol(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject('no window');
  if (window.$3Dmol) return Promise.resolve(window.$3Dmol);
  if (load3DmolPromise) return load3DmolPromise;
  load3DmolPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://3Dmol.org/build/3Dmol-min.js';
    s.async = true;
    s.onload = () => resolve(window.$3Dmol);
    s.onerror = () => reject(new Error('3Dmol failed'));
    document.head.appendChild(s);
  });
  return load3DmolPromise;
}

function plddtBadge(score?: number) {
  if (score == null) return { label: '—', color: 'var(--text-2)' };
  if (score >= 90) return { label: 'very high', color: '#0F62FE' };
  if (score >= 70) return { label: 'confident', color: '#5EEAD4' };
  if (score >= 50) return { label: 'low', color: '#F59E0B' };
  return { label: 'very low', color: '#EF4444' };
}

export default function AlphaFoldViewer({ target }: { target: string }) {
  const [data, setData] = useState<AFResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const [pdbLoaded, setPdbLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await api<AFResp>(`/api/v1/protein/alphafold?target=${encodeURIComponent(target)}`);
        if (mounted) setData(r);
      } catch (e: any) { if (mounted) setErr(e?.message || 'failed'); }
    })();
    return () => { mounted = false; };
  }, [target]);

  useEffect(() => {
    if (!data?.found || !data.pdb_url || !viewerRef.current) return;
    let cancelled = false;
    setPdbLoaded(false);

    (async () => {
      try {
        const $3Dmol = await load3Dmol();
        const pdbText = await fetch(data.pdb_url!).then((r) => r.text());
        if (cancelled || !viewerRef.current) return;
        viewerRef.current.innerHTML = '';
        const v = $3Dmol.createViewer(viewerRef.current, { backgroundColor: '#06101F' });
        v.addModel(pdbText, 'pdb');
        // AlphaFold stores pLDDT in the B-factor column → color by it
        v.setStyle({}, {
          cartoon: {
            colorfunc: (atom: any) => {
              const b = atom.b ?? 0;
              if (b >= 90) return '#0F62FE';
              if (b >= 70) return '#5EEAD4';
              if (b >= 50) return '#F59E0B';
              return '#EF4444';
            },
          },
        });
        v.zoomTo();
        v.render();
        v.spin('y', 0.4);
        setPdbLoaded(true);
      } catch (e: any) {
        setErr(e?.message || 'AlphaFold render failed');
      }
    })();
    return () => { cancelled = true; };
  }, [data?.pdb_url]);

  if (err) return <div className="card p-4 text-xs text-alert">AlphaFold: {err}</div>;
  if (!data) return <div className="card p-4 text-xs text-slate-light">Loading AlphaFold prediction…</div>;
  if (!data.found) {
    return (
      <div className="card p-4">
        <div className="text-xs uppercase tracking-widest text-slate-light mb-1">AlphaFold predicted structure</div>
        <div className="text-xs text-slate-light italic">
          No UniProt mapping for "{target}". Add it to apps/api/alphafold.py to enable.
        </div>
      </div>
    );
  }

  const conf = plddtBadge(data.confidence_summary);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-wrap gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-teal-glow">AlphaFold predicted · EBI</div>
          <div className="text-sm text-ice font-semibold mt-0.5">{data.label}</div>
          {data.description && (
            <div className="text-[11px] text-slate-light italic mt-0.5">{data.description}</div>
          )}
        </div>
        {data.viewer_url && (
          <a href={data.viewer_url} target="_blank" className="text-[11px] text-teal-glow hover:underline whitespace-nowrap">
            UniProt {data.uniprot} ↗
          </a>
        )}
      </div>
      <div ref={viewerRef} style={{ height: 320, width: '100%', background: '#06101F' }} className="relative">
        {!pdbLoaded && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-light">
            loading AlphaFold PDB…
          </div>
        )}
      </div>
      <div className="px-4 py-2 border-t border-teal/10 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div>
          <div className="text-slate-light text-[9px] uppercase tracking-widest">Organism</div>
          <div className="text-ice">{data.organism || '—'}</div>
        </div>
        <div>
          <div className="text-slate-light text-[9px] uppercase tracking-widest">Gene</div>
          <div className="text-ice">{data.gene || '—'}</div>
        </div>
        <div>
          <div className="text-slate-light text-[9px] uppercase tracking-widest">Length</div>
          <div className="text-ice tabular-nums">{data.sequence_length || '—'} aa</div>
        </div>
        <div>
          <div className="text-slate-light text-[9px] uppercase tracking-widest">Mean pLDDT</div>
          <div className="tabular-nums" style={{ color: conf.color }}>
            {data.confidence_summary?.toFixed(1) ?? '—'} <span className="text-[9px]">({conf.label})</span>
          </div>
        </div>
      </div>
      <div className="px-4 py-2 border-t border-teal/10 text-[10px] text-slate-light">
        Colored by AlphaFold pLDDT confidence per residue ·
        <span style={{ color: '#0F62FE' }}> very high</span> /
        <span style={{ color: '#5EEAD4' }}> confident</span> /
        <span style={{ color: '#F59E0B' }}> low</span> /
        <span style={{ color: '#EF4444' }}> very low</span>.
        Source: AlphaFold Protein Structure Database (EBI · CC-BY 4.0).
      </div>
    </div>
  );
}
