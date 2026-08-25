/** i18n keys for canvas / runner / run-status labels. Keep in sync with locale files. */

const NODE_KIND_KEYS: Record<string, string> = {
  aggregate: 'tasks.nodeKindAggregate',
  approval: 'tasks.nodeKindApproval',
  filter: 'tasks.nodeKindFilter',
  finally: 'tasks.nodeKindFinally',
  judge: 'tasks.nodeKindJudge',
  loop: 'tasks.nodeKindLoop',
  map: 'tasks.nodeKindMap',
  orchestrator: 'tasks.nodeKindOrchestrator',
  parallel: 'tasks.nodeKindParallel',
  route: 'tasks.nodeKindRoute',
  session: 'tasks.nodeKindSession',
  synthesize: 'tasks.nodeKindSynthesize',
  verify: 'tasks.nodeKindVerify',
}

const RUN_STATUS_KEYS: Record<string, string> = {
  completed: 'tasks.runStatusCompleted',
  failed: 'tasks.runStatusFailed',
  interrupted: 'tasks.runStatusInterrupted',
  paused: 'tasks.runStatusPaused',
  pausing: 'tasks.runStatusPausing',
  repairing: 'tasks.runStatusRepairing',
  running: 'tasks.runStatusRunning',
  stopped: 'tasks.runStatusStopped',
  verifying: 'tasks.runStatusVerifying',
  'waiting-approval': 'tasks.runStatusWaitingApproval',
  'waiting-budget': 'tasks.runStatusWaitingBudget',
}

export function nodeKindLabelKey(kind?: string): string {
  return NODE_KIND_KEYS[kind ?? 'session'] ?? NODE_KIND_KEYS.session!
}

export function runStatusLabelKey(status?: string): string | null {
  if (!status) return null
  return RUN_STATUS_KEYS[status] ?? null
}

export function runnerLabelKey(
  runner: 'conduct' | 'orchestrate' | undefined,
  orchestrateOn: boolean,
): string {
  if (runner === 'orchestrate') return orchestrateOn ? 'tasks.runnerOrchestrate' : 'tasks.orchestrateBeta'
  return 'tasks.runnerConduct'
}
