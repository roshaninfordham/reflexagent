import { API_BASE } from './api';

export type AgentEvent = {
  workflow_id: string;
  agent: string;
  step: 'start' | 'tool_call' | 'tool_return' | 'end' | 'conflict';
  target?: string | null;
  label?: string | null;
  data: Record<string, unknown>;
  at: string;
};

export function subscribeWorkflow(
  workflowId: string,
  onEvent: (e: AgentEvent) => void,
  onReady?: () => void
): () => void {
  const url = `${API_BASE}/api/v1/events/${workflowId}`;
  const es = new EventSource(url);
  es.addEventListener('ready', () => onReady?.());
  es.addEventListener('agent', (e) => {
    try {
      onEvent(JSON.parse((e as MessageEvent).data) as AgentEvent);
    } catch {}
  });
  return () => es.close();
}

export function subscribeGlobal(onEvent: (e: AgentEvent) => void): () => void {
  const url = `${API_BASE}/api/v1/events`;
  const es = new EventSource(url);
  es.addEventListener('agent', (e) => {
    try {
      onEvent(JSON.parse((e as MessageEvent).data) as AgentEvent);
    } catch {}
  });
  return () => es.close();
}
