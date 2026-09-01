/**
 * Run / node metrics persisted on the snapshot and run log.
 * Phase 0 records these without changing scheduling.
 */
export type CacheStatus = 'none' | 'hit' | 'miss' | 'bypass';

export type CoordinatorGateReason =
  | 'first-schedule'
  | 'node-failed'
  | 'approval'
  | 'budget'
  | 'no-ready'
  | 'before-verify';

export interface TaskNodeVerdictSummary {
  result: 'pass' | 'fail';
  reason?: string;
  evidence?: string;
  nodes?: string[];
}

export interface TaskRunMetrics {
  elapsedMs: number;
  queueMs: number;
  modelMs: number;
  tokensUsed: number;
  retries: number;
  repairs: number;
  coordinatorWaitMs: number;
  coordinatorWaits: number;
  cacheHits: number;
  cacheMisses: number;
  cacheBypasses: number;
  verifyBudgetReserved?: number;
  verifyBudgetRemaining?: number;
  criticalPathNodeIds?: string[];
}

export interface TaskNodeTiming {
  scheduledAtMs?: number;
  startedAtMs?: number;
  finishedAtMs?: number;
  queueMs?: number;
  elapsedMs?: number;
  modelMs?: number;
  cacheStatus?: CacheStatus;
  cacheCreatedAt?: string;
  cacheSourceRunId?: string;
  verdict?: TaskNodeVerdictSummary;
}

export function emptyRunMetrics(): TaskRunMetrics {
  return {
    elapsedMs: 0,
    queueMs: 0,
    modelMs: 0,
    tokensUsed: 0,
    retries: 0,
    repairs: 0,
    coordinatorWaitMs: 0,
    coordinatorWaits: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheBypasses: 0,
  };
}

export function accumulateNodeTiming(timing: TaskNodeTiming | undefined): Pick<TaskRunMetrics, 'queueMs' | 'modelMs'> {
  return {
    queueMs: timing?.queueMs ?? 0,
    modelMs: timing?.modelMs ?? 0,
  };
}
