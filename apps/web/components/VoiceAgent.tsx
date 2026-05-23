'use client';

/**
 * Reflex voice agent — fully agentic.
 *
 *   Speak → SpeechRecognition transcribes → POST /api/v1/chat (NIM tool-calling) →
 *   tool actions execute server-side → answer comes back → SpeechSynthesis speaks →
 *   any client_hint navigates the browser / shows a toast → loop continues.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE } from '../lib/api';

type Action = {
  name: string;
  args: Record<string, unknown>;
  summary: string;
  result: Record<string, unknown>;
};
type ClientHint = { navigate?: string; toast?: string };
type Turn = {
  role: 'user' | 'assistant';
  content: string;
  actions?: Action[];
  at: number;
};

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
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  const preferred =
    voices.find((v) => /Samantha|Karen|Daniel|Google US English|en-US/.test(v.name + ' ' + v.lang)) ||
    voices[0];
  if (preferred) u.voice = preferred;
  u.rate = 1.04;
  synth.speak(u);
  return u;
}

const ACTION_LABEL: Record<string, string> = {
  trigger_new_workflow: 'Triggering workflow',
  send_pharmacist_memo: 'Sending pharmacist memo',
  send_clinician_alert: 'Alerting clinicians',
  send_patient_letters: 'Notifying patients',
  publish_brief: 'Publishing brief',
  run_premium_subbrief: 'Running premium sub-brief',
  list_recent_recalls: 'Listing recalls',
  navigate_to_brief: 'Opening brief',
  get_wallet_status: 'Checking wallet',
};

export default function VoiceAgent({ workflowId }: { workflowId?: string }) {
  const router = useRouter();
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
  const [toast, setToast] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const isSpeakingRef = useRef(false);
  const pendingRef = useRef('');

  const historyForApi = useMemo(
    () => turns.map((t) => ({ role: t.role, content: t.content })),
    [turns],
  );

  const handleHints = useCallback(
    (hints: ClientHint[]) => {
      for (const h of hints) {
        if (h.toast) {
          setToast(h.toast);
          setTimeout(() => setToast(null), 4500);
        }
        if (h.navigate) {
          // Defer navigation slightly so the user can hear the spoken confirmation.
          setTimeout(() => router.push(h.navigate!), 1800);
        }
      }
    },
    [router],
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
        const actions: Action[] = data.actions || [];
        const hints: ClientHint[] = data.client_hints || [];
        setTurns((prev) => [
          ...prev,
          { role: 'assistant', content: answer, actions, at: Date.now() },
        ]);
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
        handleHints(hints);
      } catch (e: any) {
        setTurns((prev) => [...prev, { role: 'assistant', content: `(error: ${e?.message || e})`, at: Date.now() }]);
      } finally {
        setThinking(false);
      }
    },
    [historyForApi, muted, workflowId, handleHints],
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
      if (e?.error && !['no-speech', 'aborted'].includes(e.error)) {
        console.warn('recognition error', e);
      }
    };
    r.onend = () => {
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
    <div className="card p-4 relative">
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
          <button onClick={() => setMuted((v) => !v)} className="btn text-[11px] py-1 px-2">
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
          …you: {transcript}
        </div>
      )}

      <div className="max-h-72 overflow-y-auto scrollbar-thin pr-1 space-y-2.5">
        {turns.length === 0 && !running ? (
          <div className="text-xs text-slate-light italic leading-relaxed">
            Click "Start conversation" and ask anything. Examples:
            <ul className="mt-1.5 ml-3 list-disc space-y-0.5">
              <li>"Send the pharmacist memo and alert the clinicians."</li>
              <li>"Take next steps for me — handle this whole recall."</li>
              <li>"Run a premium sub-brief on CKD patients."</li>
              <li>"Trigger a new workflow for Valsartan recall."</li>
              <li>"Show me the brief." / "What's my wallet balance?"</li>
            </ul>
          </div>
        ) : (
          turns.slice().reverse().map((t, i) => (
            <div key={i} className="text-sm">
              <span className="text-[10px] uppercase tracking-widest text-slate-light mr-2">
                {t.role === 'user' ? 'you' : 'reflex'}
              </span>
              <span className={t.role === 'user' ? 'text-ice/90' : 'text-teal-glow'}>{t.content}</span>
              {t.actions && t.actions.length > 0 && (
                <ul className="mt-1.5 ml-3 space-y-1">
                  {t.actions.map((a, j) => (
                    <li key={j} className="text-[11px] text-ice/70 border-l-2 border-teal/30 pl-2">
                      <span className="text-teal-glow font-mono">
                        ▶ {ACTION_LABEL[a.name] || a.name}
                      </span>{' '}
                      <span className="text-slate-light">— {a.summary || 'done'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
        {thinking && (
          <div className="text-xs text-slate-light italic">reflex is thinking…</div>
        )}
      </div>

      {toast && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full card border-ok/40 bg-ok/10 px-3 py-1.5 text-xs text-ok shadow-glow whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}
