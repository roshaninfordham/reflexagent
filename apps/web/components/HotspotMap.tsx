'use client';

/**
 * Patient hotspot heatmap — open-source stack:
 *   Leaflet (BSD-2) for the map widget
 *   OpenStreetMap tiles (ODbL, free, no API key, community-run)
 *   leaflet.heat (MIT) for the heatmap layer
 *
 * No vendor lock-in, no API quota, runs entirely client-side after a small
 * JSON payload from /api/v1/workflow/:id/hotspots.
 */

import { useEffect, useRef, useState } from 'react';
import { API_BASE, api } from '../lib/api';

type Point = { zip_3: string; lat: number; lng: number; label: string; patients: number; high_risk: number };
type Resp = { drug: string; total_patients: number; total_high_risk: number; points: Point[] };

declare global {
  interface Window { L?: any; }
}

let leafletPromise: Promise<any> | null = null;
function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject('no window');
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    // Leaflet CSS
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      link.crossOrigin = 'anonymous';
      link.setAttribute('data-leaflet', '1');
      document.head.appendChild(link);
    }
    // Leaflet JS
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    s.crossOrigin = 'anonymous';
    s.async = true;
    s.onload = () => {
      // Heat plugin
      const h = document.createElement('script');
      h.src = 'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js';
      h.crossOrigin = 'anonymous';
      h.async = true;
      h.onload = () => resolve(window.L);
      h.onerror = () => reject(new Error('leaflet.heat failed'));
      document.head.appendChild(h);
    };
    s.onerror = () => reject(new Error('Leaflet failed to load'));
    document.head.appendChild(s);
  });
  return leafletPromise;
}

export default function HotspotMap({ workflowId }: { workflowId: string }) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<any>(null);
  const layersRef = useRef<{ heat?: any; markers?: any }>({});
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Fetch + poll
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const r = await api<Resp>(`/api/v1/workflow/${workflowId}/hotspots`);
        if (mounted) setData(r);
      } catch (e: any) { if (mounted) setErr(e?.message || 'failed'); }
    };
    load();
    const i = setInterval(load, 5000);
    return () => { mounted = false; clearInterval(i); };
  }, [workflowId]);

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

  // Update layers when data arrives
  useEffect(() => {
    const L = window.L;
    const m = mapInstance.current;
    if (!L || !m || !data) return;

    // Remove previous layers
    if (layersRef.current.heat) m.removeLayer(layersRef.current.heat);
    if (layersRef.current.markers) m.removeLayer(layersRef.current.markers);

    const pts = data.points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (pts.length === 0) return;

    // Heatmap — weight = patient count (high-risk doubles intensity)
    const heat = L.heatLayer(
      pts.map((p) => [p.lat, p.lng, p.patients + p.high_risk]),
      {
        radius: 40,
        blur: 28,
        maxZoom: 11,
        gradient: { 0.2: '#5EEAD4', 0.4: '#F59E0B', 0.7: '#EF4444', 1.0: '#7c2d12' },
      }
    ).addTo(m);
    layersRef.current.heat = heat;

    // Circle markers with popups for click-through detail
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

    // Fit bounds with padding
    if (pts.length > 1) {
      const bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lng]));
      m.fitBounds(bounds, { padding: [40, 40] });
    } else {
      m.setView([pts[0].lat, pts[0].lng], 6);
    }
  }, [data]);

  return (
    <div className="card overflow-hidden relative">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="text-xs uppercase tracking-widest text-slate-light">
          Patient hotspots · cohort geography
        </div>
        <div className="text-[11px] text-slate-light tabular-nums">
          {data ? (
            <>
              <span className="text-teal-glow font-semibold">{data.total_patients}</span> patients ·{' '}
              <span className="text-alert font-semibold">{data.total_high_risk}</span> high-risk ·{' '}
              {data.points.length} ZIP-3 zones
            </>
          ) : 'loading…'}
        </div>
      </div>
      <div ref={mapRef} style={{ height: 420, width: '100%' }} />
      {err && <div className="px-4 py-2 text-xs text-alert">{err}</div>}
      <div className="text-[10px] text-slate-light px-4 py-2 border-t border-teal/10">
        Tiles: OpenStreetMap · Library: Leaflet + leaflet.heat (all open source, no API key).
        Heat weight = patient count + high-risk count. Red markers = zones with ≥1 high-risk patient.
      </div>
    </div>
  );
}
