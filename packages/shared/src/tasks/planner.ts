import type { NodeRunState } from './storage.ts';
import type { NodeOutput } from './refs.ts';
import type { TaskNode } from './schema.ts';

/** Planning is a derived subphase of a run, never a second execution state. */
export type PlannerPhase = 'active' | 'draining' | 'exhausted';

/** Execution facts owned by a logical node, including delegated Swarm work. */
export interface TaskWorkerRecord {
  workerId: string;
  rootSessionId: string;
  parentSessionId: string;
  sessionId?: string;
  nodeId: string;
  attempt: number;
  revision: number;
  role: 'worker' | 'reviewer';
  state: 'reserved' | 'running' | 'done' | 'failed' | 'stopped';
  output?: NodeOutput;
  reason?: string;
  tokensUsed?: number;
}

export interface PlanChange {
  revision: number;
  decisionId: string;
  kind: 'structure' | 'repair' | 'research';
  reason: string;
  added: string[];
  updated: string[];
  cancelled: string[];
}

export interface TaskSessionBinding {
  contract?: { goal: string; node: TaskNode; constraints?: string[]; decisions?: string[] };
  rootSessionId: string;
  taskSlug: string;
  taskRunId: string;
  taskNodeId: string;
  taskAttempt: number;
  taskRevision: number;
  taskActor?: { id: string; persona?: string };
  model?: string;
  llmConnection?: string;
  permissionMode: 'safe' | 'ask' | 'allow-all';
}

export interface PlannerResultEvent {
  id: string;
  nodeId: string;
  attempt: number;
  revision: number;
  state: NodeRunState;
  outputHash?: string;
  output?: NodeOutput;
  reason?: string;
}
