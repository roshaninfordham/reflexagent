'use client';

/**
 * Patient hotspot heatmap with a temporal replay slider.
 * Open-source stack: Leaflet (BSD), OpenStreetMap (ODbL), leaflet.heat (MIT).
 *
 * Slider semantics: a single "as of" timestamp. Points fade in as their
 * patient last_seen timestamps fall below the slider value. Lets a viewer
 * replay the cohort growth over time.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';

type Point = {
  zip_3: string;
  lat: number;
  lng: number;
  label: string;
  patients: number;
  high_risk: number;
  patient_ts: number[]; // unix seconds, one entry per patient in this zone
  patient_hr: number[]; // 0/1 flag matching patient_ts
};
type Resp = {
  drug: string;
  total_patients: number;
  total_high_risk: number;
  points: Point[];
  time_range: { min: number; max: number } | null;
};

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

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function HotspotMap({ workflowId }: { workflowId: string }) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<any>(null);
  const layersRef = useRef<{ heat?: any; markers?: any }>({});
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null); // "as-of" timestamp
  const [playing, setPlaying] = useState(false);

  // Fetch + poll
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const r = await api<Resp>(`/api/v1/workflow/${workflowId}/hotspots`);
        if (mounted) {
          setData(r);
          // Default cursor = max (show everything)
          if (r.time_range && (cursor == null || cursor < r.time_range.min)) {
            setCursor(r.time_range.max);
          }
        }
      } catch (e: any) { if (mounted) setErr(e?.message || 'failed'); }
    };
    load();
    const i = setInterval(load, 6000);
    return () => { mounted = false; clearInterval(i); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  // Filter points by cursor — recompute patient counts as of "now"
  const filtered = useMemo(() => {
    if (!data) return null;
    if (cursor == null || !data.time_range) return data.points;
    return data.points
      .map((p) => {
        const idxs = p.patient_ts.map((t, i) => (t <= cursor ? i : -1)).filter((i) => i >= 0);
        const patients = idxs.length;
        const high_risk = idxs.reduce((acc, i) => acc + (p.patient_hr[i] || 0), 0);
        return { ...p, patients, high_risk };
      })
      .filter((p) => p.patients > 0);
  }, [data, cursor]);

  // Init map
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const L = await loadLeaflet();
        if (cancelled || !mapRef.current || mapInstance.current) return;
        const m = L.map(mapRef.current, {
          center: [39.8283, -98.5795],
          zoom: 4,
          zoomControl: true,
          attributionControl: true,
        });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(m);
        mapInstance.current = m;
      } catch (e: any) {
        setErr(e?.message || 'map init failed');
      }
    })();
    return () => {
      cancelled = true;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  // Update layers when filtered points change
  useEffect(() => {
    const L = window.L;
    const m = mapInstance.current;
    if (!L || !m || !filtered) return;

    if (layersRef.current.heat) m.removeLayer(layersRef.current.heat);
    if (layersRef.current.markers) m.removeLayer(layersRef.current.markers);

    const pts = filtered.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (pts.length === 0) return;

    const heat = L.heatLayer(
      pts.map((p) => [p.lat, p.lng, p.patients + p.high_risk]),
      {
        radius: 40, blur: 28, maxZoom: 11,
        gradient: { 0.2: '#5EEAD4', 0.4: '#F59E0B', 0.7: '#EF4444', 1.0: '#7c2d12' },
      }
    ).addTo(m);
    layersRef.current.heat = heat;

    const markers = L.layerGroup();
    pts.forEach((p) => {
      const r = Math.max(6, Math.min(24, 6 + Math.sqrt(p.patients) * 3));
      const c = L.circleMarker([p.lat, p.lng], {
        radius: r,
        color: p.high_risk > 0 ? '#EF4444' : '#5EEAD4',
        weight: 2,
        fillColor: p.high_risk > 0 ? '#7c2d12' : '#0D9488',
        fillOpacity: 0.65,
      }).bindPopup(
        `<strong>${p.label}</strong><br/>` +
        `ZIP-3 ${p.zip_3}<br/>` +
        `${p.patients} patient${p.patients !== 1 ? 's' : ''}` +
        (p.high_risk > 0 ? ` · <span style="color:#b91c1c">${p.high_risk} high-risk</span>` : '')
      );
      c.addTo(markers);
    });
    markers.addTo(m);
    layersRef.current.markers = markers;

    if (pts.length > 1) {
      const bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lng]));
      m.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [filtered]);

  // Playback timer
  useEffect(() => {
    if (!playing || !data?.time_range) return;
    const { min, max } = data.time_range;
    const span = max - min;
    const step = Math.max(60, Math.floor(span / 40));
    const i = setInterval(() => {
      setCursor((c) => {
        if (c == null) return min;
        const next = c + step;
        if (next >= max) {
          setPlaying(false);
          return max;
        }
        return next;
      });
    }, 220);
    return () => clearInterval(i);
  }, [playing, data?.time_range]);

  const filteredTotals = useMemo(() => {
    if (!filtered) return { patients: 0, hr: 0, zones: 0 };
    return {
      patients: filtered.reduce((a, p) => a + p.patients, 0),
      hr: filtered.reduce((a, p) => a + p.high_risk, 0),
      zones: filtered.length,
    };
  }, [filtered]);

  return (
    <div className="card overflow-hidden relative">
      <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-wrap gap-2">
        <div className="text-xs uppercase tracking-widest text-slate-light">
          Patient hotspots · cohort geography
        </div>
        <div className="text-[11px] text-slate-light tabular-nums">
          {data ? (
            <>
              <span className="text-teal-glow font-semibold">{filteredTotals.patients}</span> patients ·{' '}
              <span className="text-alert font-semibold">{filteredTotals.hr}</span> high-risk ·{' '}
              {filteredTotals.zones} ZIP-3 zone{filteredTotals.zones !== 1 ? 's' : ''}
            </>
          ) : 'loading…'}
        </div>
      </div>
      <div ref={mapRef} style={{ height: 380, width: '100%' }} />

      {data?.time_range && (
        <div className="px-4 py-3 border-t border-teal/10 flex items-center gap-3">
          <button
            className="btn text-[11px] py-1 px-2 shrink-0"
            onClick={() => {
              if (playing) { setPlaying(false); return; }
              if (cursor === data.time_range!.max) setCursor(data.time_range!.min);
              setPlaying(true);
            }}
          >
            {playing ? '❚❚ pause' : '▶ replay'}
          </button>
          <input
            type="range"
            min={data.time_range.min}
            max={data.time_range.max}
            value={cursor ?? data.time_range.max}
            onChange={(e) => { setPlaying(false); setCursor(parseInt(e.target.value, 10)); }}
            className="flex-1 accent-teal"
          />
          <span className="text-[10px] text-slate-light font-mono whitespace-nowrap">
            {cursor ? fmtDate(cursor) : '—'}
          </span>
        </div>
      )}

      {err && <div className="px-4 py-2 text-xs text-alert">{err}</div>}
      <div className="text-[10px] text-slate-light px-4 py-2 border-t border-teal/10">
        Tiles: OpenStreetMap (ODbL) · Library: Leaflet + leaflet.heat (open source).
        Drag the slider or hit replay to watch the cohort grow as lots were dispensed over time.
      </div>
    </div>
  );
}
