'use client';

/**
 * Reflex copilot — text-first chat panel.
 *
 *   Type → POST /api/v1/chat (server has the live state pre-injected) →
 *   stream tool-call chips + final answer → execute UI hints (navigate / toast /
 *   refresh-state). Voice (SpeechRecognition + Synthesis) is optional and off
 *   by default because browser speech APIs are unreliable.
 *
 * The panel is designed to be embedded directly in /ops; it claims its own
 * vertical space and scrolls its own message log.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE, api } from '../lib/api';

type Action = {
  name: string;
  args: Record<string, unknown>;
  summary: string;
  result: Record<string, unknown>;
};
type ClientHint = { navigate?: string; toast?: string; refresh?: boolean };
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

const ACTION_LABEL: Record<string, string> = {
  get_dashboard_state: 'Fetched fresh state',
  launch_demo_workflow: 'Launched demo workflow',
  trigger_new_workflow: 'Triggered new workflow',
  replay_historical_recall: 'Replaying historical recall',
  get_workflow_detail: 'Got workflow detail',
  dispatch_all_comms: 'Dispatched all comms',
  send_pharmacist_memo: 'Sent pharmacist memo',
  send_clinician_alert: 'Alerted clinicians',
  send_patient_letters: 'Sent patient letters',
  approve_review: 'Approved review',
  publish_brief: 'Published brief',
  run_premium_subbrief: 'Ran premium sub-brief ($0.50)',
  navigate: 'Opening page',
  get_wallet_status: 'Checked wallet',
};

const SUGGESTIONS = [
  "What's happening right now?",
  'What should I do next?',
  'Launch a demo workflow',
  'Replay the Valsartan 2018 recall',
  "Take next steps for the active workflow",
  "What's my wallet balance?",
];

function speak(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  const preferred = voices.find((v) => /Samantha|Karen|Daniel|en-US/.test(v.name + ' ' + v.lang)) || voices[0];
  if (preferred) u.voice = preferred;
  u.rate = 1.05;
  synth.speak(u);
}

function makeRecognition(): Recognition | null {
  if (typeof window === 'undefined') return null;
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) return null;
  const r = new R();
  r.continuous = false;
  r.interimResults = true;
  r.lang = 'en-US';
  return r;
}

export default function ReflexCopilot({ workflowId }: { workflowId?: string }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [voice, setVoice] = useState(false);
  const [listening, setListening] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ running: number; completed: number; review: number; patients: number } | null>(null);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const recRef = useRef<Recognition | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Live state polling for the header strip — independent from chat turns so
  // the user always sees current counts even without talking.
  useEffect(() => {
    let on = true;
    const load = async () => {
      try {
        const xs = await api<any[]>('/api/v1/workflows?limit=15');
        if (!on) return;
        const running = xs.filter((w) => w.status === 'running').length;
        const completed = xs.filter((w) => w.status === 'completed').length;
        const review = xs.filter((w) => w.verification?.verdict === 'requires_human').length;
        const patients = xs.reduce((a, w) => a + (w.cohort?.patient_count || 0), 0);
        setCounts({ running, completed, review, patients });
      } catch {}
    };
    load();
    const i = setInterval(load, 4000);
    return () => { on = false; clearInterval(i); };
  }, []);

  // Auto-scroll to bottom on new turn.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, thinking, activeTools]);

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
          setTimeout(() => router.push(h.navigate!), 900);
        }
        if (h.refresh) {
          // Soft refresh — the polling loop catches it on the next tick.
        }
      }
    },
    [router],
  );

  const send = useCallback(
    async (utterance: string) => {
      const txt = utterance.trim();
      if (!txt || thinking) return;
      setTurns((prev) => [...prev, { role: 'user', content: txt, at: Date.now() }]);
      setInput('');
      setThinking(true);
      setActiveTools([]);
      try {
        const res = await fetch(`${API_BASE}/api/v1/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflow_id: workflowId,
            history: historyForApi,
            message: txt,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const answer = (data.answer || '').trim() || '(no response)';
        const actions: Action[] = data.actions || [];
        const hints: ClientHint[] = data.client_hints || [];
        setTurns((prev) => [
          ...prev,
          { role: 'assistant', content: answer, actions, at: Date.now() },
        ]);
        if (voice) speak(answer);
        handleHints(hints);
      } catch (e: any) {
        setTurns((prev) => [
          ...prev,
          { role: 'assistant', content: `Couldn't reach the copilot: ${e?.message || e}`, at: Date.now() },
        ]);
      } finally {
        setThinking(false);
        setActiveTools([]);
      }
    },
    [historyForApi, workflowId, thinking, voice, handleHints],
  );

  const startListening = useCallback(() => {
    if (listening) return;
    const r = makeRecognition();
    if (!r) {
      setToast('Voice not supported in this browser');
      setTimeout(() => setToast(null), 3000);
      return;
    }
    r.onresult = (ev: any) => {
      let finalTxt = '';
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const seg = ev.results[i];
        const t = seg[0]?.transcript || '';
        if (seg.isFinal) finalTxt += t + ' ';
        else interim += t + ' ';
      }
      if (interim) setInput(interim.trim());
      if (finalTxt.trim()) {
        const text = finalTxt.trim();
        setInput('');
        setListening(false);
        try { r.stop(); } catch {}
        send(text);
      }
    };
    r.onerror = (e: any) => {
      if (!['no-speech', 'aborted'].includes(e?.error)) console.warn('rec', e);
      setListening(false);
    };
    r.onend = () => setListening(false);
    recRef.current = r;
    try { r.start(); setListening(true); } catch {}
  }, [listening, send]);

  const stopListening = useCallback(() => {
    setListening(false);
    if (recRef.current) {
      try { recRef.current.stop(); } catch {}
      recRef.current = null;
    }
  }, []);

  useEffect(() => () => stopListening(), [stopListening]);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void send(input);
    },
    [input, send],
  );

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void send(input);
      }
    },
    [input, send],
  );

  const hasReview = (counts?.review || 0) > 0;

  return (
    <div className="card flex flex-col h-full max-h-[80vh] overflow-hidden">
      {/* Header — always-current state, even without sending a message */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-teal/15 bg-ink/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-ok shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-ok opacity-60 animate-ping" />
          </span>
          <span className="text-[10px] uppercase tracking-widest text-teal-glow font-semibold">Reflex copilot</span>
          {counts && (
            <span className="text-[11px] text-slate-light truncate ml-2">
              · {counts.running} running · {counts.completed} verified
              {hasReview && <> · <span className="text-alert font-semibold">{counts.review} for review</span></>}
              · {counts.patients} patients
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setVoice((v) => !v)}
            className={`btn text-[10px] py-1 px-2 ${voice ? 'btn-primary' : ''}`}
            title="Speak responses aloud"
          >
            {voice ? '🔊' : '🔈'}
          </button>
          <button
            onClick={listening ? stopListening : startListening}
            className={`btn text-[10px] py-1 px-2 ${listening ? 'border-alert text-alert' : ''}`}
            title="Hold-to-talk (uses your mic)"
          >
            {listening ? '● rec' : '🎙'}
          </button>
          {turns.length > 0 && (
            <button onClick={() => setTurns([])} className="btn text-[10px] py-1 px-2" title="Clear conversation">
              clear
            </button>
          )}
        </div>
      </div>

      {/* Message log */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-3 min-h-[260px]"
      >
        {turns.length === 0 ? (
          <div className="text-xs text-slate-light leading-relaxed">
            <p className="text-ice/85 mb-2">
              I'm your operator for the agent swarm. I can see every workflow, every
              held-for-review item, every cohort, and the wallet. Ask me anything — or
              tell me to take action.
            </p>
            <p className="text-slate-light">Try one of these:</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-[11px] px-2 py-1 rounded bg-ink/50 border border-teal/20 text-ice/85 hover:border-teal-glow hover:text-teal-glow transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((t, i) => (
            <div key={i} className={t.role === 'user' ? 'pl-6' : ''}>
              <div className="text-[9px] uppercase tracking-widest text-slate-light mb-1">
                {t.role === 'user' ? 'you' : 'reflex'}
              </div>
              {t.role === 'user' ? (
                <div className="text-sm text-ice bg-teal/10 border border-teal/20 rounded px-3 py-2">{t.content}</div>
              ) : (
                <div className="text-sm text-ice/95 leading-relaxed whitespace-pre-wrap">{t.content}</div>
              )}
              {t.actions && t.actions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.actions.map((a, j) => (
                    <ToolChip key={j} action={a} />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
        {thinking && (
          <div>
            <div className="text-[9px] uppercase tracking-widest text-slate-light mb-1">reflex</div>
            <div className="inline-flex items-center gap-1.5 text-xs text-slate-light italic">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-glow animate-pulse" />
              thinking…
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <form onSubmit={onSubmit} className="border-t border-teal/15 bg-ink/30 px-3 py-2.5">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={listening ? 'Listening…' : 'Ask anything or tell me to act — Enter to send'}
            rows={1}
            className="flex-1 resize-none bg-ink/60 border border-teal/20 rounded px-3 py-2 text-sm text-ice placeholder:text-slate-light focus:border-teal-glow focus:outline-none scrollbar-thin"
            style={{ maxHeight: 96 }}
          />
          <button
            type="submit"
            disabled={!input.trim() || thinking}
            className="btn btn-primary text-xs py-2 px-3 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
        {turns.length > 0 && !thinking && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {['What now?', 'Do it', 'Show me the brief', 'List recalls'].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-ink/40 border border-teal/15 text-slate-light hover:border-teal-glow hover:text-teal-glow transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </form>

      {toast && (
        <div className="absolute top-3 right-3 z-50 card border-ok/40 bg-ok/15 px-3 py-1.5 text-xs text-ok shadow-glow whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}

function ToolChip({ action }: { action: Action }) {
  const [open, setOpen] = useState(false);
  const label = ACTION_LABEL[action.name] || action.name;
  const err = (action.result as any)?.error;
  return (
    <div className="text-[11px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border ${
          err
            ? 'bg-alert/10 border-alert/30 text-alert'
            : 'bg-teal/10 border-teal/30 text-teal-glow'
        }`}
        title={action.summary}
      >
        <span className="font-mono">{err ? '✗' : '✓'}</span>
        <span>{label}</span>
        {action.summary && (
          <span className="text-slate-light truncate max-w-[260px]">
            — {action.summary}
          </span>
        )}
      </button>
      {open && (
        <pre className="mt-1 ml-2 text-[10px] text-slate-light bg-ink/60 border border-teal/15 rounded p-2 max-h-40 overflow-auto scrollbar-thin">
          {JSON.stringify({ args: action.args, result: action.result }, null, 2)}
        </pre>
      )}
    </div>
  );
}
