'use client';

/**
 * Real-time chemistry dossier — PubChem REST + RDKit local rendering.
 * Open source: rdkit (BSD-3), PubChem (US gov, public).
 */

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

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

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await api<Resp>(`/api/v1/chemistry/${encodeURIComponent(drugName)}`);
        if (mounted) setData(r);
      } catch (e: any) { if (mounted) setErr(e?.message || 'failed'); }
    })();
    return () => { mounted = false; };
  }, [drugName]);

  if (err) return <div className="text-xs text-alert">Chemistry lookup: {err}</div>;
  if (!data) return <div className="card p-4 text-xs text-slate-light">Loading chemistry dossier…</div>;
  const { compound: c, descriptors_local: d } = data;
  if (!c.found) {
    return (
      <div className="card p-4">
        <div className="text-xs uppercase tracking-widest text-slate-light mb-1">Chemistry intelligence</div>
        <div className="text-xs text-slate-light italic">
          PubChem returned no record for "{drugName}". The Substitute agent's protein-based
          analysis still applies — small-molecule structure data is unavailable for this query.
        </div>
      </div>
    );
  }

  return (
    <div className="card p-4">
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

      <div className="grid md:grid-cols-2 gap-3">
        {/* Left: structure */}
        <div className="bg-paper rounded p-2 flex items-center justify-center min-h-[220px]">
          {c.structure_2d_svg ? (
            <div className="max-h-full max-w-full" dangerouslySetInnerHTML={{ __html: c.structure_2d_svg }} />
          ) : c.structure_2d_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={drugName} src={c.structure_2d_url} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-slate">no structure</span>
          )}
        </div>

        {/* Right: properties */}
        <div className="space-y-2">
          {c.iupac && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-light">IUPAC</div>
              <div className="text-xs text-ice/90 break-words">{c.iupac}</div>
            </div>
          )}
          {c.formula && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-light">Formula</span>
              <span className="text-ice font-mono">{c.formula}</span>
            </div>
          )}
          {c.mw && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-light">Molecular weight</span>
              <span className="text-ice tabular-nums">{Number(c.mw).toFixed(2)} g/mol</span>
            </div>
          )}
          {c.xlogp !== undefined && c.xlogp !== null && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-light">XLogP</span>
              <span className="text-ice tabular-nums">{c.xlogp}</span>
            </div>
          )}
          {c.h_donor !== undefined && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-light">H-bond donors / acceptors</span>
              <span className="text-ice tabular-nums">{c.h_donor} / {c.h_acceptor}</span>
            </div>
          )}
          {c.rotatable !== undefined && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-light">Rotatable bonds</span>
              <span className="text-ice tabular-nums">{c.rotatable}</span>
            </div>
          )}
          {d.lipinski_ro5_violations !== undefined && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-light">Lipinski Ro5 violations</span>
              <span className={`tabular-nums ${(d.lipinski_ro5_violations || 0) > 1 ? 'text-warn' : 'text-ok'}`}>
                {d.lipinski_ro5_violations}
              </span>
            </div>
          )}
          {d.tpsa !== undefined && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-light">TPSA (RDKit)</span>
              <span className="text-ice tabular-nums">{d.tpsa} Å²</span>
            </div>
          )}
        </div>
      </div>

      {c.smiles && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-light">Canonical SMILES</div>
          <code className="text-[11px] break-all">{c.smiles}</code>
        </div>
      )}
      {c.inchikey && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-widest text-slate-light">InChIKey</div>
          <code className="text-[11px]">{c.inchikey}</code>
        </div>
      )}
      <div className="text-[10px] text-slate-light mt-3">
        2D depiction rendered locally by RDKit from the canonical SMILES.
        Descriptors computed locally; PubChem values shown alongside for cross-check.
      </div>
    </div>
  );
}
