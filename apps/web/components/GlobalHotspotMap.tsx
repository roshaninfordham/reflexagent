'use client';

/**
 * Multi-recall overlay — every completed workflow's cohort plotted together.
 * Marker color = dominant drug for that ZIP-3. Popup shows the per-drug
 * breakdown. Open-source: Leaflet + OpenStreetMap + leaflet.heat.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';

type Zone = {
  zip_3: string;
  lat: number;
  lng: number;
  label: string;
  total_patients: number;
  dominant_drug: string;
  drug_counts: Record<string, number>;
};
type Resp = {
  drugs: { name: string; total_patients: number }[];
  zones: Zone[];
  total_patients: number;
  workflow_count: number;
};

const PALETTE = ['#5EEAD4', '#F59E0B', '#EF4444', '#a78bfa', '#FCD34D', '#34D399', '#F472B6', '#60A5FA'];

declare global { interface Window { L?: any; } }

let leafletPromise: Promise<any> | null = null;
function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject('no window');
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.setAttribute('data-leaflet', '1');
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.async = true;
    s.onload = () => {
      const h = document.createElement('script');
      h.src = 'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js';
      h.async = true;
      h.onload = () => resolve(window.L);
      h.onerror = () => reject(new Error('leaflet.heat failed'));
      document.head.appendChild(h);
    };
    s.onerror = () => reject(new Error('Leaflet failed'));
    document.head.appendChild(s);
  });
  return leafletPromise;
}

export default function GlobalHotspotMap() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<any>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const layersRef = useRef<{ heat?: any; markers?: any }>({});
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const r = await api<Resp>('/api/v1/hotspots/global');
        if (mounted) setData(r);
      } catch (e: any) { if (mounted) setErr(e?.message || 'failed'); }
    };
    load();
    const i = setInterval(load, 6000);
    return () => { mounted = false; clearInterval(i); };
  }, []);

  const drugColor: Record<string, string> = useMemo(() => {
    if (!data) return {};
    const m: Record<string, string> = {};
    data.drugs.forEach((d, i) => { m[d.name] = PALETTE[i % PALETTE.length]; });
    return m;
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    if (!hostRef.current) return;
    const host = hostRef.current;
    const inner = document.createElement('div');
    inner.style.cssText = 'width:100%; height:100%; position:absolute; inset:0;';
    host.appendChild(inner);
    innerRef.current = inner;

    (async () => {
      try {
        const L = await loadLeaflet();
        if (cancelled || !inner.isConnected || mapInstance.current) return;
        const m = L.map(inner, {
          center: [39.8283, -98.5795], zoom: 4, zoomControl: true, attributionControl: true,
        });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
        }).addTo(m);
        mapInstance.current = m;
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'map init failed');
      }
    })();
    return () => {
      cancelled = true;
      try { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } } catch {}
      try { if (inner.parentNode === host) host.removeChild(inner); } catch {}
      innerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const L = window.L;
    const m = mapInstance.current;
    if (!L || !m || !data) return;

    if (layersRef.current.heat) m.removeLayer(layersRef.current.heat);
    if (layersRef.current.markers) m.removeLayer(layersRef.current.markers);

    const pts = data.zones.filter((z) => Number.isFinite(z.lat) && Number.isFinite(z.lng));
    if (pts.length === 0) return;

    const heat = L.heatLayer(
      pts.map((p) => [p.lat, p.lng, p.total_patients]),
      { radius: 38, blur: 26, maxZoom: 11, gradient: { 0.2: '#5EEAD4', 0.5: '#F59E0B', 0.8: '#EF4444' } }
    ).addTo(m);
    layersRef.current.heat = heat;

    const markers = L.layerGroup();
    pts.forEach((p) => {
      const r = Math.max(6, Math.min(28, 6 + Math.sqrt(p.total_patients) * 3));
      const color = drugColor[p.dominant_drug] || '#5EEAD4';
      const breakdown = Object.entries(p.drug_counts)
        .sort((a, b) => b[1] - a[1])
        .map(([d, c]) => `<div><span style="color:${drugColor[d] || '#5EEAD4'}">●</span> ${d}: ${c}</div>`)
        .join('');
      const c = L.circleMarker([p.lat, p.lng], {
        radius: r, color, weight: 2, fillColor: color, fillOpacity: 0.55,
      }).bindPopup(
        `<strong>${p.label}</strong><br/>` +
        `ZIP-3 ${p.zip_3}<br/>` +
        `Total: <strong>${p.total_patients}</strong> patient${p.total_patients !== 1 ? 's' : ''}<br/>` +
        `<hr style="margin:4px 0; opacity:0.3"/>${breakdown}`
      );
      c.addTo(markers);
    });
    markers.addTo(m);
    layersRef.current.markers = markers;

    if (pts.length > 1) {
      const bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lng]));
      m.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [data, drugColor]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-wrap gap-2">
        <div className="text-xs uppercase tracking-widest text-slate-light">
          Global hotspots · all active recalls
        </div>
        <div className="text-[11px] text-slate-light tabular-nums">
          {data ? (
            <>
              <span className="text-teal-glow font-semibold">{data.workflow_count}</span> workflows ·{' '}
              <span className="text-teal-glow font-semibold">{data.total_patients}</span> patients ·{' '}
              {data.zones.length} zones
            </>
          ) : 'loading…'}
        </div>
      </div>
      <div ref={hostRef} style={{ height: 320, width: '100%', position: 'relative' }} />
      {data && data.drugs.length > 0 && (
        <div className="px-4 py-2 border-t border-teal/10 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {data.drugs.slice(0, 8).map((d) => (
            <span key={d.name} className="inline-flex items-center gap-1 text-ice/90">
              <span className="w-2 h-2 rounded-full" style={{ background: drugColor[d.name] }} />
              {d.name.length > 26 ? d.name.slice(0, 26) + '…' : d.name}
              <span className="text-slate-light">· {d.total_patients}</span>
            </span>
          ))}
        </div>
      )}
      {err && <div className="px-4 py-2 text-xs text-alert">{err}</div>}
    </div>
  );
}
