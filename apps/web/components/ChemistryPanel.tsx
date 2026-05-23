'use client';

/**
 * Real-time chemistry dossier — PubChem REST + RDKit local rendering.
 * Open source: rdkit (BSD-3), PubChem (US gov, public).
 *
 * Includes an EDITABLE SMILES input that re-renders the 2D structure live
 * via RDKit so a scientist can paste a variant SMILES and immediately
 * see the structure + recomputed descriptors.
 */

import { useEffect, useState } from 'react';
import { API_BASE, api } from '../lib/api';

type Compound = {
  cid?: number;
  name: string;
  found: boolean;
  iupac?: string;
  smiles?: string;
  inchi?: string;
  inchikey?: string;
  formula?: string;
  mw?: number;
  xlogp?: number;
  h_donor?: number;
  h_acceptor?: number;
  rotatable?: number;
  pubchem_url?: string;
  structure_2d_url?: string;
  structure_2d_svg?: string;
};

type Descriptors = {
  mw?: number; logp?: number; h_donor?: number; h_acceptor?: number;
  rotatable?: number; tpsa?: number; heavy_atoms?: number; rings?: number;
  lipinski_ro5_violations?: number;
};

type Resp = { compound: Compound; descriptors_local: Descriptors };

export default function ChemistryPanel({ drugName }: { drugName: string }) {
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editSmiles, setEditSmiles] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [editPreview, setEditPreview] = useState<{ svg?: string; desc?: Descriptors } | null>(null);

  useEffect(() => {
    let mounted = true;
    setErr(null); setData(null); setEditPreview(null); setEditing(false);
    (async () => {
      try {
        const r = await api<Resp>(`/api/v1/chemistry/${encodeURIComponent(drugName)}`);
        if (mounted) {
          setData(r);
          if (r.compound.smiles) setEditSmiles(r.compound.smiles);
        }
      } catch (e: any) { if (mounted) setErr(e?.message || 'failed'); }
    })();
    return () => { mounted = false; };
  }, [drugName]);

  // Debounced live RDKit re-render when user edits SMILES
  useEffect(() => {
    if (!editing || !editSmiles) { setEditPreview(null); return; }
    const t = setTimeout(async () => {
      try {
        // Reuse the /chemistry endpoint with a 'smiles:' prefix? Cheaper:
        // hit /chemistry/{smiles} since PubChem-by-name will likely 404 but
        // RDKit will still render. For a cleaner flow we call a dedicated
        // endpoint that JUST takes SMILES — fall back to PubChem name lookup
        // when both fail.
        const url = `${API_BASE}/api/v1/chemistry/${encodeURIComponent(editSmiles)}`;
        const r = await fetch(url).then((x) => x.json());
        setEditPreview({
          svg: r?.compound?.structure_2d_svg,
          desc: r?.descriptors_local,
        });
      } catch {}
    }, 350);
    return () => clearTimeout(t);
  }, [editSmiles, editing]);

  if (err) return <div className="text-xs text-alert">Chemistry lookup: {err}</div>;
  if (!data) return <div className="card p-4 text-xs text-slate-light">Loading chemistry dossier…</div>;
  const { compound: c, descriptors_local: d } = data;
  if (!c.found) {
    return (
      <div className="card p-4">
        <div className="text-xs uppercase tracking-widest text-slate-light mb-1">Chemistry intelligence</div>
        <div className="text-xs text-slate-light italic mb-3">
          PubChem returned no record for "{drugName}". Paste a SMILES below to render the structure locally with RDKit.
        </div>
        <SmilesEditor value={editSmiles} onChange={setEditSmiles} preview={editPreview} onActivate={() => setEditing(true)} />
      </div>
    );
  }

  const activeSvg = (editing && editPreview?.svg) ? editPreview.svg : c.structure_2d_svg;
  const activeDesc = (editing && editPreview?.desc) ? editPreview.desc : d;

  return (
    <div className="card p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-xs uppercase tracking-widest text-slate-light">
          Chemistry intelligence · PubChem + RDKit
        </div>
        {c.pubchem_url && (
          <a href={c.pubchem_url} target="_blank" className="text-[11px] text-teal-glow hover:underline">
            PubChem CID {c.cid} ↗
          </a>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4 items-start">
        {/* Left: structure — render SVG via data URL inside <img> to avoid
            dangerouslySetInnerHTML's reconciliation issues across React re-mounts. */}
        <div className="bg-paper rounded p-3 flex items-center justify-center min-h-[240px] overflow-hidden">
          {activeSvg ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={drugName}
              src={`data:image/svg+xml;utf8,${encodeURIComponent(activeSvg)}`}
              className="max-h-[240px] max-w-full object-contain"
            />
          ) : c.structure_2d_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={drugName} src={c.structure_2d_url} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-slate">no structure</span>
          )}
        </div>

        {/* Right: properties */}
        <div className="space-y-2 min-w-0">
          {c.iupac && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-light">IUPAC</div>
              <div className="text-xs text-ice/90 break-words">{c.iupac}</div>
            </div>
          )}
          {c.formula && <Row k="Formula" v={c.formula} mono />}
          {c.mw && <Row k="Molecular weight" v={`${Number(c.mw).toFixed(2)} g/mol`} />}
          {c.xlogp !== undefined && c.xlogp !== null && <Row k="XLogP (PubChem)" v={String(c.xlogp)} />}
          {activeDesc?.logp !== undefined && <Row k="LogP (RDKit)" v={String(activeDesc.logp)} />}
          {c.h_donor !== undefined && <Row k="H-bond donors / acceptors" v={`${c.h_donor} / ${c.h_acceptor}`} />}
          {c.rotatable !== undefined && <Row k="Rotatable bonds" v={String(c.rotatable)} />}
          {activeDesc?.lipinski_ro5_violations !== undefined && (
            <Row k="Lipinski Ro5 violations" v={String(activeDesc.lipinski_ro5_violations)} color={(activeDesc.lipinski_ro5_violations || 0) > 1 ? 'text-warn' : 'text-ok'} />
          )}
          {activeDesc?.tpsa !== undefined && <Row k="TPSA (RDKit)" v={`${activeDesc.tpsa} Å²`} />}
          {activeDesc?.heavy_atoms !== undefined && <Row k="Heavy atoms · rings" v={`${activeDesc.heavy_atoms} · ${activeDesc.rings || 0}`} />}
        </div>
      </div>

      <SmilesEditor
        value={editSmiles}
        onChange={setEditSmiles}
        preview={editPreview}
        onActivate={() => setEditing(true)}
        onReset={() => { setEditing(false); setEditSmiles(c.smiles || ''); setEditPreview(null); }}
        canReset={editing && c.smiles}
      />

      {c.inchikey && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-light">InChIKey</div>
          <code className="text-[11px] break-all">{c.inchikey}</code>
        </div>
      )}
      <div className="text-[10px] text-slate-light mt-3">
        2D depiction rendered locally by RDKit. Edit the SMILES above to re-render and recompute
        descriptors live — useful for analyzing variants or metabolites.
      </div>
    </div>
  );
}

function Row({ k, v, mono, color }: { k: string; v: string; mono?: boolean; color?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-light">{k}</span>
      <span className={`${mono ? 'font-mono' : ''} ${color || 'text-ice'} tabular-nums`}>{v}</span>
    </div>
  );
}

function SmilesEditor({
  value, onChange, preview, onActivate, onReset, canReset,
}: {
  value: string;
  onChange: (v: string) => void;
  preview: { svg?: string; desc?: Descriptors } | null;
  onActivate: () => void;
  onReset?: () => void;
  canReset?: any;
}) {
  return (
    <div className="mt-4 p-3 rounded bg-ink/40 border border-teal/15">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="text-[10px] uppercase tracking-widest text-slate-light">Editable SMILES · RDKit live re-render</div>
        {canReset && (
          <button onClick={onReset} className="btn text-[10px] py-0.5 px-2">reset to canonical</button>
        )}
      </div>
      <textarea
        className="w-full bg-ink/60 border border-teal/20 rounded px-2 py-1.5 text-[11px] font-mono text-ice min-h-[44px]"
        value={value}
        onChange={(e) => { onActivate(); onChange(e.target.value); }}
        placeholder="Paste or edit a SMILES string here…"
      />
      {preview?.svg && (
        <div className="text-[10px] text-ok mt-1">
          ▶ Updated · MW {preview.desc?.mw} · LogP {preview.desc?.logp} · Ro5 violations {preview.desc?.lipinski_ro5_violations}
        </div>
      )}
    </div>
  );
}
