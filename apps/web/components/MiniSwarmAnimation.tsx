'use client';

/**
 * Pure-SVG animated mini swarm — the same visual idea as the full Canvas Agent
 * Theater but lightweight and embeddable in the landing hero. 4 agent nodes
 * + 3 source nodes; cursor pulses travel along the edges on a CSS-only loop.
 * No JS, no canvas, no race conditions — safe to mount anywhere.
 */

export default function MiniSwarmAnimation() {
  return (
    <div className="card relative w-full overflow-hidden p-3" style={{ aspectRatio: '4 / 3', minHeight: 220 }}>
      <svg viewBox="0 0 400 300" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="agentGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#5EEAD4" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#0D9488" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="sourceGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#14B8A6" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#0D9488" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="conflictGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#EF4444" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#7c2d12" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Decorative concentric rings */}
        <g stroke="rgba(94,234,212,0.07)" fill="none">
          <circle cx="200" cy="150" r="40" />
          <circle cx="200" cy="150" r="80" />
          <circle cx="200" cy="150" r="120" />
        </g>

        {/* Edges — drawn faint */}
        <g stroke="rgba(94,234,212,0.18)" strokeWidth="1" fill="none" strokeDasharray="2 3">
          <line x1="200" y1="60"  x2="60"  y2="100" /> {/* scout → fda */}
          <line x1="200" y1="60"  x2="340" y2="100" /> {/* scout → ema */}
          <line x1="200" y1="60"  x2="200" y2="150" /> {/* scout → verify */}
          <line x1="200" y1="150" x2="60"  y2="220" /> {/* verify → counter zone */}
          <line x1="200" y1="150" x2="340" y2="220" /> {/* cohort → ch */}
          <line x1="200" y1="150" x2="200" y2="240" /> {/* publisher → senso */}
        </g>

        {/* Source nodes */}
        <g>
          <Source x={60}  y={100} label="FDA" />
          <Source x={340} y={100} label="EMA" />
          <Source x={340} y={220} label="ClickHouse" />
          <Source x={60}  y={220} label="PubMed" />
          <Source x={200} y={250} label="Senso · cited.md" />
        </g>

        {/* Agent nodes */}
        <g>
          <Agent x={200} y={60}  label="Scout" />
          <Agent x={200} y={150} label="Verify · Counter" isConflict />
          <Agent x={120} y={180} label="Cohort" />
          <Agent x={280} y={180} label="Substitute" />
        </g>

        {/* Animated cursor pulses — pure SVG <animateMotion> on a path */}
        <g>
          {/* Scout → FDA */}
          <circle r="3.5" fill="#5EEAD4">
            <animateMotion dur="2.6s" repeatCount="indefinite" path="M 200 60 L 60 100" rotate="auto" />
          </circle>
          {/* Scout → EMA, delayed */}
          <circle r="3.5" fill="#5EEAD4">
            <animateMotion dur="2.6s" begin="0.4s" repeatCount="indefinite" path="M 200 60 L 340 100" />
          </circle>
          {/* Counter → red */}
          <circle r="3" fill="#EF4444">
            <animateMotion dur="3.2s" begin="1s" repeatCount="indefinite" path="M 200 150 L 60 220" />
          </circle>
          {/* Cohort → ClickHouse */}
          <circle r="3.5" fill="#5EEAD4">
            <animateMotion dur="2.4s" begin="1.4s" repeatCount="indefinite" path="M 120 180 L 340 220" />
          </circle>
          {/* Publisher → Senso */}
          <circle r="4" fill="#10B981">
            <animateMotion dur="2.4s" begin="2.2s" repeatCount="indefinite" path="M 200 150 L 200 250" />
          </circle>
        </g>
      </svg>

      <div className="absolute top-3 left-3 right-3 flex items-center justify-between text-[10px] uppercase tracking-widest pointer-events-none">
        <span className="text-teal-glow">Live · agent swarm</span>
        <span className="text-slate-light">11 agents · 7 sources</span>
      </div>
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-[10px] pointer-events-none">
        <span className="text-ice/80">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-glow align-middle mr-1" /> reasoning
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-alert align-middle mx-1 ml-3" /> counter-evidence
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-ok align-middle mx-1 ml-3" /> publish
        </span>
        <span className="text-slate-light text-[9px]">animated preview · click "Launch demo" for the live theater</span>
      </div>
    </div>
  );
}

function Agent({ x, y, label, isConflict }: { x: number; y: number; label: string; isConflict?: boolean }) {
  const grad = isConflict ? 'url(#conflictGlow)' : 'url(#agentGlow)';
  const stroke = isConflict ? 'rgba(239,68,68,0.85)' : 'rgba(94,234,212,0.85)';
  const fill = isConflict ? '#7c2d12' : '#0D9488';
  const dot = isConflict ? '#EF4444' : '#5EEAD4';
  return (
    <g>
      {/* Pulsing glow */}
      <circle cx={x} cy={y} r="22" fill={grad}>
        <animate attributeName="r" values="18;26;18" dur="2.6s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.45;0.8;0.45" dur="2.6s" repeatCount="indefinite" />
      </circle>
      <circle cx={x} cy={y} r="14" fill={fill} stroke={stroke} strokeWidth="1.5" />
      <circle cx={x} cy={y} r="3" fill={dot} />
      <text x={x} y={y - 22} textAnchor="middle" fontSize="9" fill="#E0F2FE" fontFamily="Inter, system-ui">
        {label}
      </text>
    </g>
  );
}

function Source({ x, y, label }: { x: number; y: number; label: string }) {
  // Hexagon points
  const r = 12;
  const points = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return `${x + r * Math.cos(a)},${y + r * Math.sin(a)}`;
  }).join(' ');
  return (
    <g>
      <circle cx={x} cy={y} r="18" fill="url(#sourceGlow)" />
      <polygon points={points} fill="#0D9488" stroke="#5EEAD4" strokeWidth="1.2" />
      <text x={x} y={y + 28} textAnchor="middle" fontSize="8" fill="#94A3B8" fontFamily="Inter, system-ui">
        {label}
      </text>
    </g>
  );
}
