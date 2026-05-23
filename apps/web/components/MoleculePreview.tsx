'use client';

/**
 * Drug + target preview pane.
 *
 * - Left: PubChem 2D structure image of the small-molecule drug (free, no auth).
 * - Right: 3Dmol.js cartoon render of the target protein from RCSB PDB
 *   (loads 3Dmol from a CDN once; renders into a ref-managed div).
 *
 * Everything runs client-side. The component degrades to text when network
 * fetches fail.
 */

import { useEffect, useRef, useState } from 'react';

// Lookup table: drug → target protein PDB ID. Curated from RCSB.
const TARGET_PDB: Record<string, { pdb: string; chain?: string; label: string }> = {
  metformin: { pdb: '4CFE', chain: 'A', label: 'AMPK α1 (PRKAA1)' },
  sitagliptin: { pdb: '1X70', chain: 'A', label: 'DPP-4' },
  glipizide: { pdb: '6BAA', chain: 'A', label: 'KCNJ11 / SUR1' },
  semaglutide: { pdb: '5VEW', chain: 'R', label: 'GLP-1 receptor' },
  empagliflozin: { pdb: '7VSI', chain: 'A', label: 'SGLT2' },
  pioglitazone: { pdb: '5Y2T', chain: 'A', label: 'PPARγ' },
  atorvastatin: { pdb: '1HW8', chain: 'A', label: 'HMG-CoA reductase' },
  valsartan: { pdb: '6OS0', chain: 'A', label: 'AT1 receptor' },
  ranitidine: { pdb: '7UL5', chain: 'A', label: 'H2 receptor' },
  dabigatran: { pdb: '1KTS', chain: 'H', label: 'Thrombin' },
  insulin: { pdb: '1MSO', chain: 'A', label: 'Insulin' },
};

function pdbFor(drug: string) {
  const key = drug.toLowerCase().trim();
  for (const k of Object.keys(TARGET_PDB)) {
    if (key.includes(k) || k.includes(key.split(' ')[0])) return TARGET_PDB[k];
  }
  return null;
}

function pubchemUrl(name: string): string {
  // PubChem PUG REST. Returns PNG of the 2D structure.
  const q = encodeURIComponent(name.replace(/\s+/g, ' ').trim());
  return `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${q}/PNG?image_size=large`;
}

declare global {
  interface Window { $3Dmol?: any; }
}

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

export default function MoleculePreview({
  drugName,
  size = 'normal',
}: {
  drugName: string;
  size?: 'normal' | 'small';
}) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const [pdbLoaded, setPdbLoaded] = useState(false);
  const [pdbErr, setPdbErr] = useState<string | null>(null);
  const target = pdbFor(drugName);
  const imgUrl = pubchemUrl(drugName);
  const [imgErr, setImgErr] = useState(false);

  useEffect(() => {
    if (!target || !viewerRef.current) return;
    let cancelled = false;
    setPdbLoaded(false);
    setPdbErr(null);

    (async () => {
      try {
        const $3Dmol = await load3Dmol();
        const pdbText = await fetch(`https://files.rcsb.org/view/${target.pdb}.pdb`).then((r) => r.text());
        if (cancelled || !viewerRef.current) return;
        viewerRef.current.innerHTML = '';
        const viewer = $3Dmol.createViewer(viewerRef.current, {
          backgroundColor: '#06101F',
        });
        viewer.addModel(pdbText, 'pdb');
        viewer.setStyle({}, { cartoon: { color: 'spectrum' } });
        if (target.chain) {
          viewer.setStyle({ chain: target.chain }, { cartoon: { colorscheme: 'cyanCarbon' } });
        }
        viewer.setHoverable(
          {},
          true,
          (atom: any, _viewer: any) => atom && (atom.resn || ''),
          (_atom: any, _viewer: any) => {}
        );
        viewer.zoomTo();
        viewer.render();
        viewer.spin('y', 0.5);
        setPdbLoaded(true);
      } catch (e: any) {
        if (!cancelled) setPdbErr(String(e?.message || e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target?.pdb, target?.chain]);

  const dim = size === 'small' ? { h: 180, t: 'text-xs' } : { h: 260, t: 'text-sm' };

  return (
    <div className="card p-3 grid sm:grid-cols-2 gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-slate-light mb-2">
          2D structure · PubChem
        </div>
        <div className="bg-paper rounded p-2 flex items-center justify-center" style={{ height: dim.h }}>
          {!imgErr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`${drugName} structure`}
              src={imgUrl}
              onError={() => setImgErr(true)}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <div className={`${dim.t} text-slate text-center px-2`}>
              No PubChem record found for "{drugName}".
            </div>
          )}
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-slate-light mb-2">
          3D target protein · RCSB PDB
        </div>
        {target ? (
          <div className="relative rounded bg-ink/60" style={{ height: dim.h }}>
            <div ref={viewerRef} className="absolute inset-0 rounded overflow-hidden" />
            {!pdbLoaded && !pdbErr && (
              <div className={`absolute inset-0 flex items-center justify-center text-slate-light ${dim.t}`}>
                loading {target.pdb}…
              </div>
            )}
            {pdbErr && (
              <div className={`absolute inset-0 flex items-center justify-center text-alert ${dim.t} px-3 text-center`}>
                {pdbErr}
              </div>
            )}
            <div className="absolute bottom-1 left-2 right-2 flex items-center justify-between text-[10px] text-teal-glow/80">
              <span>{target.label}</span>
              <a
                href={`https://www.rcsb.org/structure/${target.pdb}`}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-teal-glow"
              >
                PDB {target.pdb} ↗
              </a>
            </div>
          </div>
        ) : (
          <div className="bg-ink/40 rounded flex items-center justify-center text-slate-light text-xs px-3 text-center" style={{ height: dim.h }}>
            No PDB structure mapped for "{drugName}".
          </div>
        )}
      </div>
    </div>
  );
}
