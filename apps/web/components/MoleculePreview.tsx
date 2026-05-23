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

// Lookup tables: drug name → target protein PDB ID, AND target-protein keywords → PDB ID.
// The protein-keyword map lets us render structures even when the autonomous monitor
// catches a drug we don't recognize but the Substitute agent identifies a known target.
const TARGET_PDB: Record<string, { pdb: string; chain?: string; label: string }> = {
  // Diabetes / metabolic
  metformin: { pdb: '4CFE', chain: 'A', label: 'AMPK α1 (PRKAA1)' },
  sitagliptin: { pdb: '1X70', chain: 'A', label: 'DPP-4' },
  glipizide: { pdb: '6BAA', chain: 'A', label: 'KCNJ11 / SUR1' },
  glyburide: { pdb: '6BAA', chain: 'A', label: 'KCNJ11 / SUR1' },
  semaglutide: { pdb: '5VEW', chain: 'R', label: 'GLP-1 receptor' },
  liraglutide: { pdb: '5VEW', chain: 'R', label: 'GLP-1 receptor' },
  empagliflozin: { pdb: '7VSI', chain: 'A', label: 'SGLT2' },
  dapagliflozin: { pdb: '7VSI', chain: 'A', label: 'SGLT2' },
  pioglitazone: { pdb: '5Y2T', chain: 'A', label: 'PPARγ' },
  // Cardiovascular
  atorvastatin: { pdb: '1HW8', chain: 'A', label: 'HMG-CoA reductase' },
  simvastatin: { pdb: '1HW8', chain: 'A', label: 'HMG-CoA reductase' },
  rosuvastatin: { pdb: '1HW8', chain: 'A', label: 'HMG-CoA reductase' },
  valsartan: { pdb: '6OS0', chain: 'A', label: 'AT1 receptor' },
  losartan: { pdb: '6OS0', chain: 'A', label: 'AT1 receptor' },
  lisinopril: { pdb: '1O8A', chain: 'A', label: 'ACE' },
  amlodipine: { pdb: '5GJV', chain: 'A', label: 'L-type Ca²⁺ channel (CACNA1C)' },
  // GI
  ranitidine: { pdb: '7UL5', chain: 'A', label: 'H2 receptor' },
  omeprazole: { pdb: '5YLU', chain: 'A', label: 'H+/K+ ATPase' },
  // Anticoagulation
  dabigatran: { pdb: '1KTS', chain: 'H', label: 'Thrombin' },
  warfarin: { pdb: '2W6E', chain: 'A', label: 'VKORC1' },
  apixaban: { pdb: '2P16', chain: 'A', label: 'Factor Xa' },
  rivaroxaban: { pdb: '2P16', chain: 'A', label: 'Factor Xa' },
  // Hormones
  insulin: { pdb: '1MSO', chain: 'A', label: 'Insulin' },
  // Oncology (EGFR family — common cancer targets)
  erlotinib: { pdb: '1M17', chain: 'A', label: 'EGFR' },
  gefitinib: { pdb: '2ITY', chain: 'A', label: 'EGFR' },
  afatinib: { pdb: '4G5J', chain: 'A', label: 'EGFR' },
  osimertinib: { pdb: '4ZAU', chain: 'A', label: 'EGFR T790M' },
  imatinib: { pdb: '1IEP', chain: 'A', label: 'BCR-ABL kinase' },
  // SSRIs / psych
  sertraline: { pdb: '5I6X', chain: 'A', label: 'SERT (SLC6A4)' },
  fluoxetine: { pdb: '5I6X', chain: 'A', label: 'SERT (SLC6A4)' },
  // Pain
  ibuprofen: { pdb: '1EQG', chain: 'A', label: 'COX-1 (PTGS1)' },
  naproxen: { pdb: '3KK6', chain: 'A', label: 'COX-2 (PTGS2)' },
};

// Match keywords (gene symbols + common protein nicknames) → fallback PDB when the
// LLM-identified target_protein is recognizable even if the drug name isn't in our map.
const PROTEIN_PDB: { match: RegExp; pdb: string; chain?: string; label: string }[] = [
  { match: /\b(EGFR|epidermal growth factor)\b/i, pdb: '1M17', chain: 'A', label: 'EGFR' },
  { match: /\b(BCR.?ABL|ABL1)\b/i, pdb: '1IEP', chain: 'A', label: 'BCR-ABL kinase' },
  { match: /\b(PRKAA1|AMP.?activated|AMPK)\b/i, pdb: '4CFE', chain: 'A', label: 'AMPK α1' },
  { match: /\b(DPP.?4|dipeptidyl peptidase)\b/i, pdb: '1X70', chain: 'A', label: 'DPP-4' },
  { match: /\b(GLP.?1R|glucagon.?like peptide)\b/i, pdb: '5VEW', chain: 'R', label: 'GLP-1R' },
  { match: /\b(SGLT2|SLC5A2)\b/i, pdb: '7VSI', chain: 'A', label: 'SGLT2' },
  { match: /\b(PPARG|PPAR.?gamma|PPARγ)\b/i, pdb: '5Y2T', chain: 'A', label: 'PPARγ' },
  { match: /\b(HMGCR|HMG.?CoA)\b/i, pdb: '1HW8', chain: 'A', label: 'HMG-CoA reductase' },
  { match: /\b(AGTR1|AT1 receptor|angiotensin)\b/i, pdb: '6OS0', chain: 'A', label: 'AT1 receptor' },
  { match: /\b(ACE\b|angiotensin.?converting)\b/i, pdb: '1O8A', chain: 'A', label: 'ACE' },
  { match: /\b(HRH2|histamine H2)\b/i, pdb: '7UL5', chain: 'A', label: 'H2 receptor' },
  { match: /\b(thrombin|F2 prothrombin)\b/i, pdb: '1KTS', chain: 'H', label: 'Thrombin' },
  { match: /\b(factor xa|F10)\b/i, pdb: '2P16', chain: 'A', label: 'Factor Xa' },
  { match: /\b(VKORC1|vitamin K)\b/i, pdb: '2W6E', chain: 'A', label: 'VKORC1' },
  { match: /\b(SERT|SLC6A4|serotonin transporter)\b/i, pdb: '5I6X', chain: 'A', label: 'SERT' },
  { match: /\b(COX.?1|PTGS1)\b/i, pdb: '1EQG', chain: 'A', label: 'COX-1' },
  { match: /\b(COX.?2|PTGS2)\b/i, pdb: '3KK6', chain: 'A', label: 'COX-2' },
  { match: /\b(KCNJ11|SUR1|ABCC8|sulfonylurea)\b/i, pdb: '6BAA', chain: 'A', label: 'KCNJ11 / SUR1' },
  { match: /\b(insulin\b)/i, pdb: '1MSO', chain: 'A', label: 'Insulin' },
];

function pdbFor(drug: string, targetProteinHint?: string) {
  const key = drug.toLowerCase().trim();
  for (const k of Object.keys(TARGET_PDB)) {
    if (key.includes(k) || k.includes(key.split(' ')[0])) return TARGET_PDB[k];
  }
  if (targetProteinHint) {
    for (const p of PROTEIN_PDB) {
      if (p.match.test(targetProteinHint)) return { pdb: p.pdb, chain: p.chain, label: p.label };
    }
  }
  return null;
}

const GENERIC_DRUG_HINTS = [
  'example drug', 'unknown', 'tbd', 'placeholder',
  'sodium chloride', 'tpn bag', 'compound', 'injection usp', 'irrigation',
];

export function isPreviewable(drug: string): boolean {
  if (!drug) return false;
  const k = drug.toLowerCase();
  if (GENERIC_DRUG_HINTS.some((g) => k.includes(g))) return false;
  // Long product-description names with measurement units rarely match PubChem either
  if (k.length > 80 || /\d+\s*(mg|ml|mcg|g|iu)\b/.test(k)) return false;
  return true;
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
  targetHint,
  size = 'normal',
}: {
  drugName: string;
  targetHint?: string;
  size?: 'normal' | 'small';
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [pdbLoaded, setPdbLoaded] = useState(false);
  const [pdbErr, setPdbErr] = useState<string | null>(null);
  const target = pdbFor(drugName, targetHint);
  const imgUrl = pubchemUrl(drugName);
  const [imgErr, setImgErr] = useState(false);

  useEffect(() => {
    if (!target || !hostRef.current) return;
    let cancelled = false;
    setPdbLoaded(false);
    setPdbErr(null);

    // React-owned host + library-owned inner — prevents removeChild errors
    // when MoleculePreview re-mounts with a different drug.
    const host = hostRef.current;
    const inner = document.createElement('div');
    inner.style.cssText = 'width:100%; height:100%; position:absolute; inset:0;';
    host.appendChild(inner);

    (async () => {
      try {
        const $3Dmol = await load3Dmol();
        const pdbText = await fetch(`https://files.rcsb.org/view/${target.pdb}.pdb`).then((r) => r.text());
        if (cancelled || !inner.isConnected) return;
        const viewer = $3Dmol.createViewer(inner, { backgroundColor: '#06101F' });
        viewer.addModel(pdbText, 'pdb');
        viewer.setStyle({}, { cartoon: { color: 'spectrum' } });
        if (target.chain) {
          viewer.setStyle({ chain: target.chain }, { cartoon: { colorscheme: 'cyanCarbon' } });
        }
        viewer.zoomTo();
        viewer.render();
        try { viewer.spin('y', 0.5); } catch {}
        setPdbLoaded(true);
      } catch (e: any) {
        if (!cancelled) setPdbErr(String(e?.message || e));
      }
    })();

    return () => {
      cancelled = true;
      try { if (inner.parentNode === host) host.removeChild(inner); } catch {}
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
          <div className="relative rounded bg-ink/60 overflow-hidden" style={{ height: dim.h }}>
            <div ref={hostRef} className="absolute inset-0" />
            {!pdbLoaded && !pdbErr && (
              <div className={`absolute inset-0 flex items-center justify-center text-slate-light pointer-events-none ${dim.t}`}>
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
