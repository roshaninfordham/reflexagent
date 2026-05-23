'use client';

/**
 * Reflex Narrator — speaks the agent swarm's key findings out loud using the
 * browser's Web Speech API (SpeechSynthesis). Zero infra, works offline once
 * the page loads. Optional but powerful for live-stage demos.
 */
import { useEffect, useRef, useState } from 'react';

type Props = {
  workflowId: string;
  // Headline strings the narrator should read once they appear.
  lines: string[];
};

export default function Narrator({ workflowId, lines }: Props) {
  const [enabled, setEnabled] = useState(false);
  const spokenRef = useRef<Set<string>>(new Set());
  const lastWorkflowRef = useRef<string>('');

  useEffect(() => {
    if (lastWorkflowRef.current !== workflowId) {
      spokenRef.current = new Set();
      lastWorkflowRef.current = workflowId;
    }
  }, [workflowId]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;

    for (const raw of lines) {
      const text = (raw || '').trim();
      if (!text || spokenRef.current.has(text)) continue;
      spokenRef.current.add(text);
      try {
        const utter = new SpeechSynthesisUtterance(text);
        // Prefer a calm voice if available.
        const voices = synth.getVoices();
        const preferred =
          voices.find((v) => /Samantha|Alex|Karen|Daniel|Google US English|en-US/.test(v.name + ' ' + v.lang)) ||
          voices[0];
        if (preferred) utter.voice = preferred;
        utter.rate = 1.0;
        utter.pitch = 1.0;
        synth.speak(utter);
      } catch {}
    }
    return () => {
      // We do not cancel mid-utterance — let the current line finish.
    };
  }, [lines, enabled]);

  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  return (
    <button
      onClick={() => setEnabled((v) => !v)}
      disabled={!supported}
      className={`btn ${enabled ? 'btn-primary' : ''}`}
      title={supported ? 'Toggle agent voice narration' : 'SpeechSynthesis not supported'}
    >
      {enabled ? 'Narrator: on' : 'Narrator: off'}
    </button>
  );
}
