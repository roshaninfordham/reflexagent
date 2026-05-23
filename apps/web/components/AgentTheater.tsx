'use client';

import { useEffect, useRef, useState } from 'react';
import { AgentEvent, subscribeWorkflow } from '../lib/sse';

// ---- Layout config (logical 0..1 space; we scale to canvas size) ----

type Node = { id: string; label: string; x: number; y: number; kind: 'agent' | 'source' };

const SOURCES: Node[] = [
  { id: 'fda', label: 'FDA', x: 0.18, y: 0.12, kind: 'source' },
  { id: 'ema', label: 'EMA', x: 0.82, y: 0.12, kind: 'source' },
  { id: 'pubmed', label: 'PubMed', x: 0.95, y: 0.5, kind: 'source' },
  { id: 'bionemo', label: 'BioNeMo · ESM2', x: 0.82, y: 0.88, kind: 'source' },
  { id: 'clickhouse', label: 'ClickHouse', x: 0.5, y: 0.94, kind: 'source' },
  { id: 'senso', label: 'Senso · cited.md', x: 0.05, y: 0.5, kind: 'source' },
];

const AGENTS: Node[] = [
  // Outer ring (ingest)
  { id: 'inbound', label: 'Inbound', x: 0.30, y: 0.32, kind: 'agent' },
  { id: 'scout', label: 'Scout', x: 0.50, y: 0.22, kind: 'agent' },
  { id: 'recon', label: 'Recon', x: 0.70, y: 0.32, kind: 'agent' },
  // Middle ring (decision)
  { id: 'triage', label: 'Triage', x: 0.30, y: 0.50, kind: 'agent' },
  { id: 'verify_counter', label: 'Verify · Counter', x: 0.50, y: 0.40, kind: 'agent' },
  { id: 'cohort', label: 'Cohort', x: 0.66, y: 0.50, kind: 'agent' },
  { id: 'substitute', label: 'Substitute', x: 0.74, y: 0.62, kind: 'agent' },
  { id: 'routing_comms', label: 'Routing · Comms', x: 0.50, y: 0.58, kind: 'agent' },
  // Inner ring (synthesis)
  { id: 'writer', label: 'Writer', x: 0.38, y: 0.72, kind: 'agent' },
  { id: 'auditor', label: 'Auditor', x: 0.50, y: 0.78, kind: 'agent' },
  { id: 'publisher', label: 'Publisher', x: 0.62, y: 0.72, kind: 'agent' },
];

const ALL = [...SOURCES, ...AGENTS];

type Cursor = {
  id: string;
  agent: string;
  fromX: number; fromY: number;
  toX: number; toY: number;
  born: number;
  duration: number; // ms
  returnLeg: boolean;
  color: string;
  label?: string;
};

type Pulse = { agent: string; born: number; conflict?: boolean };

const MAX_CURSORS = 30;

const COLOR = {
  base: '#5EEAD4',
  alt: '#22d3ee',
  warn: '#F59E0B',
  alert: '#EF4444',
  ok: '#10B981',
};

// React state we surface OUTSIDE the RAF loop (right rail step log + conflict modal).
export type EventRow = { agent: string; step: string; label?: string | null; at: string };

export default function AgentTheater({ workflowId }: { workflowId: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Mutable animation state (refs only — never read in the RAF loop from React state).
  const cursors = useRef<Cursor[]>([]);
  const pulses = useRef<Map<string, Pulse>>(new Map());
  const eventQueue = useRef<AgentEvent[]>([]);
  const sizeRef = useRef({ w: 800, h: 540 });

  // React state for non-RAF surfaces.
  const [log, setLog] = useState<EventRow[]>([]);
  const [conflict, setConflict] = useState<{ label: string; at: string } | null>(null);
  const [ready, setReady] = useState(false);

  // -------- Resize handling --------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      if (!entries || !entries.length) return;
      const cr = entries[0].contentRect;
      sizeRef.current = { w: cr.width, h: cr.height };
      const c = canvasRef.current;
      if (!c) return; // canvas may have unmounted mid-resize
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, Math.floor(cr.width * dpr));
      c.height = Math.max(1, Math.floor(cr.height * dpr));
      c.style.width = `${cr.width}px`;
      c.style.height = `${cr.height}px`;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // -------- SSE → eventQueue (refs) + log (React state) --------
  useEffect(() => {
    let stop: (() => void) | null = null;
    stop = subscribeWorkflow(
      workflowId,
      (e) => {
        eventQueue.current.push(e);
        setLog((prev) => {
          const next = [...prev, { agent: e.agent, step: e.step, label: e.label, at: e.at }];
          return next.slice(-80);
        });
        if (e.step === 'conflict') {
          setConflict({ label: e.label || 'Counter-evidence conflict surfaced.', at: e.at });
        }
      },
      () => setReady(true)
    );
    return () => stop?.();
  }, [workflowId]);

  // -------- RAF loop --------
  useEffect(() => {
    let raf = 0;
    if (!canvasRef.current) return;
    const initialCtx = canvasRef.current.getContext('2d');
    if (!initialCtx) return;

    const draw = () => {
      const c = canvasRef.current;
      if (!c) { raf = requestAnimationFrame(draw); return; }
      const ctx = c.getContext('2d');
      if (!ctx) { raf = requestAnimationFrame(draw); return; }
      const { w, h } = sizeRef.current;
      const now = performance.now();

      // Drain queued events into cursors + pulses.
      while (eventQueue.current.length) {
        const ev = eventQueue.current.shift()!;
        applyEvent(ev, now);
      }

      // Background
      ctx.clearRect(0, 0, w, h);
      drawBackground(ctx, w, h);

      // Edges (light, decorative)
      drawAgentRing(ctx, w, h);

      // Source nodes
      for (const s of SOURCES) drawSource(ctx, s, w, h, now);

      // Agent nodes
      for (const a of AGENTS) {
        const pulse = pulses.current.get(a.id);
        drawAgent(ctx, a, w, h, now, pulse);
      }

      // Cursors
      cursors.current = cursors.current.filter((c) => now - c.born < c.duration);
      for (const c of cursors.current) drawCursor(ctx, c, w, h, now);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // -------- Map an AgentEvent into animation state --------
  function applyEvent(ev: AgentEvent, now: number) {
    const agent = AGENTS.find((a) => a.id === ev.agent);
    if (!agent && ev.agent !== 'orchestrator' && ev.agent !== 'monitor') return;

    if (ev.step === 'start') {
      if (agent) pulses.current.set(agent.id, { agent: agent.id, born: now });
      if (ev.target) {
        const source = SOURCES.find((s) => s.id === ev.target);
        if (source && agent) {
          spawnCursor(agent, source, false, now, ev.agent === 'verify_counter' ? COLOR.alt : COLOR.base, ev.label || undefined);
        }
      }
    } else if (ev.step === 'tool_call' && ev.target) {
      const source = SOURCES.find((s) => s.id === ev.target);
      const a = agent || AGENTS.find((x) => x.id === 'scout')!;
      if (source) {
        spawnCursor(a, source, false, now, COLOR.base, ev.label || undefined);
      }
    } else if (ev.step === 'end') {
      if (agent) {
        const existing = pulses.current.get(agent.id);
        if (existing) {
          // Brief "completion flare" — extend pulse but tag as success.
          pulses.current.set(agent.id, { ...existing, born: now - 800 });
        }
      }
      // Spawn a return-leg cursor from the last touched source back to the agent (decorative).
      if (ev.target && agent) {
        const source = SOURCES.find((s) => s.id === ev.target);
        if (source) spawnCursor(source, agent, true, now, COLOR.ok);
      }
    } else if (ev.step === 'conflict' && agent) {
      pulses.current.set(agent.id, { agent: agent.id, born: now, conflict: true });
      // Red cursor circling between verify_counter and EMA/FDA/PubMed.
      const targets = ['fda', 'ema', 'pubmed'];
      for (const tid of targets) {
        const t = SOURCES.find((s) => s.id === tid)!;
        spawnCursor(agent, t, false, now, COLOR.alert, 'COUNTER');
      }
    }
  }

  function spawnCursor(
    from: { x: number; y: number },
    to: { x: number; y: number },
    returnLeg: boolean,
    now: number,
    color: string,
    label?: string
  ) {
    if (cursors.current.length >= MAX_CURSORS) {
      // Recycle oldest.
      cursors.current.shift();
    }
    cursors.current.push({
      id: `${Math.random()}`,
      agent: '',
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      born: now,
      duration: returnLeg ? 700 : 1100,
      returnLeg,
      color,
      label,
    });
  }

  return (
    <div className="card relative w-full">
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="text-xs uppercase tracking-widest text-slate-light">
          Agent Theater {ready ? '· live' : '· connecting'}
        </div>
        <div className="text-xs text-slate-light">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-teal animate-pulse_slow" /> reasoning
          </span>
          <span className="mx-3" />
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-alert" /> counter
          </span>
        </div>
      </div>
      <div ref={wrapRef} className="relative h-[560px] w-full">
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>

      {/* Compact event ticker across the bottom of the canvas */}
      <div className="px-4 py-2 border-t border-teal/10 text-[11px] font-mono text-ice/80 flex items-center gap-3 overflow-x-auto scrollbar-thin">
        <span className="text-slate-light shrink-0 uppercase tracking-widest">events</span>
        {log.length === 0 ? (
          <span className="text-slate-light italic">waiting for first event…</span>
        ) : (
          log.slice(-12).map((row, i) => (
            <span key={i} className="shrink-0">
              <span className={row.step === 'conflict' ? 'text-alert' : 'text-teal-glow'}>{row.agent}</span>
              <span className="text-slate-light">·{row.step}</span>
            </span>
          ))
        )}
      </div>

      {/* Conflict pop */}
      {conflict && (
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-4 max-w-md card border-alert/40 bg-alert/10 px-4 py-3 text-sm cursor-pointer"
          onClick={() => setConflict(null)}
        >
          <div className="font-semibold text-alert">⚑ Counter-evidence surfaced</div>
          <div className="text-ice/90 mt-1">{conflict.label}</div>
          <div className="text-[10px] text-slate-light mt-1">click to dismiss</div>
        </div>
      )}
    </div>
  );
}

// ---------- Drawing primitives ----------

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const grad = ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, Math.max(w, h));
  grad.addColorStop(0, 'rgba(20, 184, 166, 0.06)');
  grad.addColorStop(1, 'rgba(6, 16, 31, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Decorative concentric rings
  ctx.strokeStyle = 'rgba(94, 234, 212, 0.06)';
  ctx.lineWidth = 1;
  for (let r = 60; r < Math.max(w, h); r += 60) {
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawAgentRing(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = 'rgba(94, 234, 212, 0.08)';
  ctx.lineWidth = 1;
  // Connect agents serially as a decorative spine
  ctx.beginPath();
  AGENTS.forEach((a, i) => {
    const px = a.x * w, py = a.y * h;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();
}

function drawSource(ctx: CanvasRenderingContext2D, n: Node, w: number, h: number, now: number) {
  const px = n.x * w, py = n.y * h;
  // Outer glow
  const r = 22;
  const breath = 6 + 2 * Math.sin(now / 600);
  const g = ctx.createRadialGradient(px, py, r * 0.4, px, py, r + breath);
  g.addColorStop(0, 'rgba(94, 234, 212, 0.6)');
  g.addColorStop(1, 'rgba(94, 234, 212, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(px, py, r + breath, 0, Math.PI * 2);
  ctx.fill();

  // Core hex
  drawHex(ctx, px, py, 16, '#0D9488', '#5EEAD4', 1.5);

  // Label
  ctx.fillStyle = '#E0F2FE';
  ctx.font = '600 11px Inter, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(n.label, px, py + 32);
}

function drawAgent(
  ctx: CanvasRenderingContext2D,
  n: Node,
  w: number, h: number,
  now: number,
  pulse?: Pulse
) {
  const px = n.x * w, py = n.y * h;
  let r = 22;
  let stroke = 'rgba(94, 234, 212, 0.5)';
  let fill = 'rgba(6, 16, 31, 0.95)';
  let labelColor = '#E0F2FE';

  if (pulse) {
    const t = (now - pulse.born) / 1400;
    const breath = 6 + 6 * (1 - Math.min(1, t));
    const conflict = !!pulse.conflict;
    const ringColor = conflict ? 'rgba(239, 68, 68, 0.8)' : 'rgba(94, 234, 212, 0.9)';
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, r + breath, 0, Math.PI * 2);
    ctx.stroke();
    stroke = conflict ? 'rgba(239, 68, 68, 0.9)' : 'rgba(94, 234, 212, 0.9)';
    fill = conflict ? 'rgba(127, 29, 29, 0.6)' : 'rgba(6, 78, 74, 0.7)';
    labelColor = conflict ? '#FECACA' : '#5EEAD4';
  }

  // Background card
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Inner glyph dot
  ctx.fillStyle = pulse?.conflict ? '#EF4444' : '#5EEAD4';
  ctx.beginPath();
  ctx.arc(px, py, 4, 0, Math.PI * 2);
  ctx.fill();

  // Label
  ctx.fillStyle = labelColor;
  ctx.font = '500 11px Inter, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(n.label, px, py - 30);
}

function drawHex(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  fill: string, stroke: string, lineWidth: number
) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawCursor(
  ctx: CanvasRenderingContext2D,
  c: Cursor,
  w: number, h: number,
  now: number
) {
  const t = Math.min(1, (now - c.born) / c.duration);
  const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

  const fx = c.fromX * w, fy = c.fromY * h;
  const tx = c.toX * w, ty = c.toY * h;
  // Slight curved path (control point perpendicular to the segment)
  const mx = (fx + tx) / 2, my = (fy + ty) / 2;
  const dx = tx - fx, dy = ty - fy;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const curve = 0.10 * len;
  const cx = mx + nx * curve, cy = my + ny * curve;
  const x = (1 - ease) * (1 - ease) * fx + 2 * (1 - ease) * ease * cx + ease * ease * tx;
  const y = (1 - ease) * (1 - ease) * fy + 2 * (1 - ease) * ease * cy + ease * ease * ty;

  // Trail (fading)
  const trailSteps = 8;
  for (let i = 1; i <= trailSteps; i++) {
    const tt = Math.max(0, ease - i * 0.04);
    const et = tt < 0.5 ? 2 * tt * tt : -1 + (4 - 2 * tt) * tt;
    const xx = (1 - et) * (1 - et) * fx + 2 * (1 - et) * et * cx + et * et * tx;
    const yy = (1 - et) * (1 - et) * fy + 2 * (1 - et) * et * cy + et * et * ty;
    ctx.fillStyle = withAlpha(c.color, (1 - i / trailSteps) * 0.18);
    ctx.beginPath();
    ctx.arc(xx, yy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Head
  const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
  g.addColorStop(0, withAlpha(c.color, 0.95));
  g.addColorStop(1, withAlpha(c.color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = c.color;
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fill();

  if (c.label && ease < 0.7) {
    ctx.fillStyle = withAlpha(c.color, 0.85);
    ctx.font = '600 9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(c.label.slice(0, 18), x + 8, y - 6);
  }
}

function withAlpha(hex: string, a: number): string {
  // hex like #RRGGBB
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
