'use client';

/**
 * Floating voice agent — a small pill at the bottom-right of the viewport
 * that expands to the full VoiceAgent panel when clicked. Always reachable
 * regardless of scroll position. Power-UX pattern (Linear / Notion / Intercom).
 */

import { useEffect, useState } from 'react';
import VoiceAgent from './VoiceAgent';

export default function FloatingVoiceAgent({ workflowId }: { workflowId?: string }) {
  const [open, setOpen] = useState(false);

  // Press 'v' anywhere to toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'v' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tgt = e.target as HTMLElement;
        if (tgt && /input|textarea/i.test(tgt.tagName)) return;
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 btn btn-primary shadow-glow text-sm py-2.5 px-4 rounded-full"
        style={{ boxShadow: '0 0 24px rgba(20, 184, 166, 0.35)' }}
        title="Talk to Reflex (press V)"
      >
        <span className="inline-flex items-center gap-2">
          <span className="relative inline-flex w-2 h-2 rounded-full bg-ok">
            <span className="absolute inline-flex h-full w-full rounded-full bg-ok opacity-60 animate-ping" />
          </span>
          {open ? 'Close voice agent' : 'Talk to Reflex'}
        </span>
      </button>
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[min(420px,calc(100vw-3rem))] max-h-[70vh] overflow-y-auto scrollbar-thin shadow-glow">
          <VoiceAgent workflowId={workflowId} />
        </div>
      )}
    </>
  );
}
