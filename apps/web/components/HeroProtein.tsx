'use client';

import { useEffect, useRef, useState } from 'react';

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
    s.onerror = () => reject(new Error('3Dmol failed to load'));
    document.head.appendChild(s);
  });
  return load3DmolPromise;
}

const FEATURES = [
  { pdb: '4CFE', label: 'AMPK α1 — metformin target' },
  { pdb: '1X70', label: 'DPP-4 — sitagliptin target' },
  { pdb: '5VEW', label: 'GLP-1 receptor — semaglutide target' },
  { pdb: '1HW8', label: 'HMG-CoA reductase — statin target' },
];

export default function HeroProtein() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(false);
    if (!hostRef.current) return;

    const host = hostRef.current;
    const inner = document.createElement('div');
    inner.style.cssText = 'width:100%; height:100%; position:absolute; inset:0;';
    host.appendChild(inner);

    (async () => {
      try {
        const $3Dmol = await load3Dmol();
        const target = FEATURES[idx];
        const pdbText = await fetch(`https://files.rcsb.org/view/${target.pdb}.pdb`).then((r) => r.text());
        if (cancelled || !inner.isConnected) return;
        const viewer = $3Dmol.createViewer(inner, { backgroundColor: 'rgba(0,0,0,0)' });
        viewer.addModel(pdbText, 'pdb');
        viewer.setStyle({}, { cartoon: { color: 'spectrum' } });
        viewer.zoomTo();
        viewer.render();
        try { viewer.spin('y', 0.6); } catch {}
        setLoading(false);
      } catch (e) { if (!cancelled) { setErr(true); setLoading(false); } }
    })();

    return () => {
      cancelled = true;
      try { if (inner.parentNode === host) host.removeChild(inner); } catch {}
    };
  }, [idx]);

  // Cycle every 12 seconds
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % FEATURES.length), 12000);
    return () => clearInterval(t);
  }, []);

  const target = FEATURES[idx];
  return (
    <div className="card relative w-full overflow-hidden" style={{ aspectRatio: '1 / 1', minHeight: 280 }}>
      <div ref={hostRef} className="absolute inset-0" />
      {loading && !err && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-light">loading {target.pdb}…</div>
      )}
      {err && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-light text-center px-3">protein viewer unavailable offline</div>
      )}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between text-[10px] uppercase tracking-widest">
        <span className="text-teal-glow">3D · live · RCSB PDB</span>
        <a href={`https://www.rcsb.org/structure/${target.pdb}`} target="_blank" className="text-slate-light hover:text-teal-glow">PDB {target.pdb} ↗</a>
      </div>
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
        <span className="text-xs text-ice/90 truncate">{target.label}</span>
        <div className="flex gap-1">
          {FEATURES.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className={`w-1.5 h-1.5 rounded-full transition ${i === idx ? 'bg-teal-glow' : 'bg-slate-light/40 hover:bg-slate-light'}`}
              aria-label={`Show protein ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
