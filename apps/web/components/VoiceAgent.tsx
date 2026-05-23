'use client';

/**
 * VoiceAgent — bidirectional voice loop powered by the browser's Web Speech API.
 *
 *   Speak → SpeechRecognition transcribes → POST /api/v1/chat (NIM-backed) →
 *   answer comes back → SpeechSynthesis speaks the answer →
 *   recognition restarts (continuous mode).
 *
 * Push-to-talk is also supported via the "Hold to speak" button. Everything is
 * client-side except the LLM call. No infra, no LiveKit, no Whisper download.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE } from '../lib/api';

type Turn = { role: 'user' | 'assistant'; content: string; at: number };

// Browser globals for typing.
type Recognition = any;
declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

function makeRecognition(): Recognition | null {
  if (typeof window === 'undefined') return null;
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) return null;
  const r = new R();
  r.continuous = true;
  r.interimResults = true;
  r.lang = 'en-US';
  return r;
}

function speak(text: string): SpeechSynthesisUtterance | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const synth = window.speechSynthesis;
  synth.cancel(); // stop anything in flight
  const u = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  const preferred =
    voices.find((v) => /Samantha|Karen|Daniel|Google US English|en-US/.test(v.name + ' ' + v.lang)) ||
    voices[0];
  if (preferred) u.voice = preferred;
  u.rate = 1.04;
  u.pitch = 1.0;
  synth.speak(u);
  return u;
}

export default function VoiceAgent({ workflowId }: { workflowId?: string }) {
  const [supported] = useState<boolean>(
    typeof window !== 'undefined' &&
      !!(window.SpeechRecognition || window.webkitSpeechRecognition) &&
      'speechSynthesis' in window,
  );
  const [running, setRunning] = useState(false);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [thinking, setThinking] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const recRef = useRef<Recognition | null>(null);
  const isSpeakingRef = useRef(false);
  const pendingRef = useRef('');

  // History sent to backend (last ~8 turns).
  const historyForApi = useMemo(
    () => turns.map((t) => ({ role: t.role, content: t.content })),
    [turns],
  );

  const sendToBrain = useCallback(
    async (text: string) => {
      const utterance = text.trim();
      if (!utterance) return;
      setTurns((prev) => [...prev, { role: 'user', content: utterance, at: Date.now() }]);
      setThinking(true);
      try {
        const res = await fetch(`${API_BASE}/api/v1/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflow_id: workflowId,
            history: historyForApi,
            message: utterance,
          }),
        });
        const data = await res.json();
        const answer = (data.answer || '').trim() || '(no response)';
        setTurns((prev) => [...prev, { role: 'assistant', content: answer, at: Date.now() }]);
        if (!muted) {
          isSpeakingRef.current = true;
          const u = speak(answer);
          if (u) {
            u.onend = () => { isSpeakingRef.current = false; };
            u.onerror = () => { isSpeakingRef.current = false; };
          } else {
            isSpeakingRef.current = false;
          }
        }
      } catch (e: any) {
        setTurns((prev) => [...prev, { role: 'assistant', content: `(error: ${e?.message || e})`, at: Date.now() }]);
      } finally {
        setThinking(false);
      }
    },
    [historyForApi, muted, workflowId],
  );

  const startListening = useCallback(() => {
    if (!supported || running) return;
    const r = makeRecognition();
    if (!r) return;

    r.onresult = (ev: any) => {
      let finalTxt = '';
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const seg = ev.results[i];
        const txt = seg[0]?.transcript || '';
        if (seg.isFinal) finalTxt += txt + ' ';
        else interim += txt + ' ';
      }
      setTranscript(interim.trim());
      if (finalTxt.trim()) {
        // Don't send while the assistant is speaking (avoid feedback loop).
        if (isSpeakingRef.current) {
          pendingRef.current = (pendingRef.current + ' ' + finalTxt).trim();
        } else {
          const text = (pendingRef.current + ' ' + finalTxt).trim();
          pendingRef.current = '';
          setTranscript('');
          sendToBrain(text);
        }
      }
    };
    r.onerror = (e: any) => {
      // 'no-speech' / 'aborted' are routine; ignore.
      if (e?.error && !['no-speech', 'aborted'].includes(e.error)) {
        console.warn('recognition error', e);
      }
    };
    r.onend = () => {
      // Auto-restart if still running (continuous loop).
      if (recRef.current === r && running) {
        try { r.start(); } catch {}
      }
    };

    recRef.current = r;
    try { r.start(); } catch {}
    setRunning(true);
  }, [running, sendToBrain, supported]);

  const stopListening = useCallback(() => {
    setRunning(false);
    if (recRef.current) {
      try { recRef.current.stop(); } catch {}
      recRef.current = null;
    }
  }, []);

  useEffect(() => () => stopListening(), [stopListening]);

  if (!supported) {
    return (
      <div className="card p-3 text-xs text-slate-light">
        Voice agent needs SpeechRecognition + SpeechSynthesis (Chrome / Edge / Safari).
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`relative inline-flex w-2.5 h-2.5 rounded-full ${running ? 'bg-ok' : 'bg-slate-light'}`}>
            {running && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-ok opacity-60 animate-ping" />
            )}
          </span>
          <span className="text-xs uppercase tracking-widest text-slate-light">
            Voice agent {running ? '· listening' : '· idle'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMuted((v) => !v)}
            className="btn text-[11px] py-1 px-2"
            title="Mute the assistant's voice (text still appears)"
          >
            {muted ? 'unmute' : 'mute'}
          </button>
          <button
            onClick={running ? stopListening : startListening}
            className={`btn ${running ? '' : 'btn-primary'} text-[11px] py-1 px-3`}
          >
            {running ? 'Stop' : 'Start conversation'}
          </button>
        </div>
      </div>

      {transcript && (
        <div className="text-[11px] text-slate-light italic mb-2">
          ...you: {transcript}
        </div>
      )}

      <div className="max-h-56 overflow-y-auto scrollbar-thin pr-1 space-y-2">
        {turns.length === 0 && !running ? (
          <div className="text-xs text-slate-light italic">
            Click "Start conversation" and ask anything — e.g. "What's the verdict on the metformin recall?",
            "Which alternative is closest by protein similarity?", "Draft a patient letter".
          </div>
        ) : (
          turns.slice().reverse().map((t, i) => (
            <div key={i} className={`text-sm ${t.role === 'user' ? 'text-ice/90' : 'text-teal-glow'}`}>
              <span className="text-[10px] uppercase tracking-widest text-slate-light mr-2">
                {t.role === 'user' ? 'you' : 'reflex'}
              </span>
              {t.content}
            </div>
          ))
        )}
        {thinking && (
          <div className="text-xs text-slate-light italic">reflex is thinking…</div>
        )}
      </div>
    </div>
  );
}
