/** Work mode is an execution boundary, independent of permissions and models. */
export type WorkMode = 'NORM' | 'PRO';
export interface WorkModeMetadata {
  workMode?: WorkMode;
  workModeNeedsReview?: boolean;
  executionRootSessionId?: string;
}
export interface WorkModeSession extends WorkModeMetadata {
  id: string;
  parentSessionId?: string;
  taskSlug?: string;
  taskRunId?: string;
  taskNodeId?: string;
  taskDraft?: boolean;
  orchestrationId?: string;
  orchestrationRootSessionId?: string;
  orchestrationRole?: 'coordinator' | 'worker' | 'reviewer';
  orchestrationLifecycle?: 'managed' | 'detached';
  orchestrationStatus?: string;
}

export type ComplexCapability = 'delegate' | 'create-workflow' | 'run-workflow' | 'change-plan';
export function complexCapabilityError(session: WorkModeMetadata & { id?: string; parentSessionId?: string; taskNodeId?: string; orchestrationRole?: string; orchestrationRootSessionId?: string } | null | undefined, capability: ComplexCapability): string | undefined {
  if (!session) return 'Execution session is unavailable.';
  if (session.workModeNeedsReview) return 'Execution ownership needs review before starting new delegated work.';
  if (session.workMode !== 'PRO') return 'NORM completes work in this conversation. Create a PRO conversation to use delegation or workflows.';
  if (session.parentSessionId || session.taskNodeId || (session.id && session.executionRootSessionId && session.executionRootSessionId !== session.id) || (session.id && session.orchestrationRootSessionId && session.orchestrationRootSessionId !== session.id) || (session.orchestrationRole && session.orchestrationRole !== 'coordinator')) {
    return `${capability} requires the PRO root coordinator; workers and reviewers only perform assigned work.`;
  }
  return undefined;
}
export function assertComplexCapability(session: Parameters<typeof complexCapabilityError>[0], capability: ComplexCapability): void {
  const error = complexCapabilityError(session, capability);
  if (error) throw new Error(error);
}

/** Selection session aliases and currently supported provider-native delegation. */
export function complexToolCapability(toolName: string): ComplexCapability | undefined {
  const name = toolName.replace(/^(mcp__session__|session__)/, '');
  if (['Task', 'Agent', 'spawn_session', 'send_agent_message'].includes(name)) return 'delegate';
  if (['create_task', 'submit_task_definition'].includes(name)) return 'create-workflow';
  if (name === 'run_task') return 'run-workflow';
  if (['submit_orchestration_patch', 'submit_orchestration_decision', 'control_task_run'].includes(name)) return 'change-plan';
  return undefined;
}

/** Run per workspace after loading all headers; never change permission/model/ownership. */
export function migrateWorkModes(sessions: readonly WorkModeSession[]): Map<string, WorkModeMetadata> {
  const byId = new Map(sessions.map(session => [session.id, session]));
  const roots = new Map<string, string>();
  const disputed = new Set<string>();
  for (const session of sessions) {
    const seen = new Set<string>();
    let current = session;
    while (current.parentSessionId) {
      seen.add(current.id);
      const parent = byId.get(current.parentSessionId);
      if (!parent || seen.has(parent.id)) { disputed.add(session.id); break; }
      current = parent;
    }
    const hintedRootId = session.executionRootSessionId ?? session.orchestrationRootSessionId
    if (!session.parentSessionId && hintedRootId && hintedRootId !== session.id) {
      const hintedRoot = byId.get(hintedRootId)
      if (hintedRoot && !hintedRoot.parentSessionId) current = hintedRoot
      else disputed.add(session.id)
    }
    if (session.orchestrationRootSessionId && session.orchestrationRootSessionId !== current.id) disputed.add(session.id);
    if (session.executionRootSessionId && session.executionRootSessionId !== current.id) disputed.add(session.id);
    if (current.id === session.id && (session.taskNodeId || session.orchestrationRole === 'worker' || session.orchestrationRole === 'reviewer')) disputed.add(session.id);
    roots.set(session.id, current.id);
  }
  const complexRoots = new Set<string>();
  for (const session of sessions) {
    if (disputed.has(session.id)) continue;
    if (session.taskSlug || session.taskRunId || session.taskDraft || session.orchestrationId || session.parentSessionId) {
      complexRoots.add(roots.get(session.id)!);
    }
  }
  const modes = new Map<string, WorkMode>();
  for (const session of sessions) {
    if (roots.get(session.id) !== session.id) continue;
    modes.set(session.id, session.workMode === 'NORM' || session.workMode === 'PRO'
      ? session.workMode : complexRoots.has(session.id) ? 'PRO' : 'NORM');
    if (session.workMode === 'NORM' && complexRoots.has(session.id)) disputed.add(session.id);
  }
  return new Map(sessions.map(session => {
    const root = roots.get(session.id)!;
    const mode = session.workMode === 'NORM' || session.workMode === 'PRO'
      ? session.workMode : modes.get(root) ?? 'NORM';
    const needsReview = !!session.workModeNeedsReview || disputed.has(session.id) || disputed.has(root)
      || (root !== session.id && mode !== modes.get(root));
    return [session.id, { workMode: mode, workModeNeedsReview: needsReview,
      executionRootSessionId: session.executionRootSessionId ?? session.orchestrationRootSessionId ?? (disputed.has(session.id) && session.parentSessionId && !byId.has(session.parentSessionId) ? session.parentSessionId : root) }];
  }));
}
