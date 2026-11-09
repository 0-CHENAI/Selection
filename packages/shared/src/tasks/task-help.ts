import type { RunLogEntry } from './storage';

/** A durable coordination record, never an authorization grant. */
export interface TaskHelpRecord {
  id: string;
  requestId: string;
  runId: string;
  nodeId: string;
  attempt: number;
  revision: number;
  sessionId: string;
  generation: number;
  problem: string;
  tried: string[];
  needed: string;
  claimRefs: Array<{ id: string; version: number }>;
  sourceRefs: Array<{ id: string; version: string }>;
  state: 'waiting' | 'waiting-user' | 'answered' | 'cancelled';
  responses: Array<{ id: string; action: 'answer' | 'needs-user'; text: string; revision: number }>;
  cancellationReason?: string;
}

export function taskHelpHistory(log: readonly RunLogEntry[]): TaskHelpRecord[] {
  const records = new Map<string, TaskHelpRecord>();
  for (const event of log) if (event.kind === 'task-help') records.set(event.help.id, structuredClone(event.help));
  return [...records.values()];
}
