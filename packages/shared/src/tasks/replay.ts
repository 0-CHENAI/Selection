/** Read-only history inspection. Does not construct TaskRunner, dispatch models or repair files. */
import { existsSync, readFileSync } from 'node:fs';
import { committedRunLog, readRunLog, readRunState, readRunSpecSnapshot, deriveRunStatusFromLog, type NodeRunState } from './storage.ts';
import { specRevisionPath } from './revisions.ts';
import { validateTaskSpec } from './validate.ts';
import { TaskSpecSchema, type TaskSpec } from './schema.ts';
import { explainPreflight, projectTaskView, revisionImpact, TASK_VIEWS } from './explain.ts';
import { validateOrchestrationPatch, type OrchestrationPatch } from './orchestration-patch.ts';
import type { TaskRunSnapshotDto } from '../protocol/dto.ts';
import { loadResearchResults } from './research-storage.ts';

function exactSpec(root: string, slug: string, runId: string, revision: number): TaskSpec | null {
  const path = specRevisionPath(root, slug, runId, revision);
  try { const raw = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).spec : revision === 0 ? readRunSpecSnapshot(root, slug, runId) : null;
    const result = TaskSpecSchema.safeParse(raw); return result.success ? result.data : null;
  } catch { return null; }
}
export function inspectTaskRun(root: string, slug: string, runId: string, cursor?: number, patch?: OrchestrationPatch) {
  const durable = committedRunLog(readRunLog(root, slug, runId), readRunState(root, slug, runId));
  if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0)) throw new Error('Invalid replay cursor');
  const position = cursor === undefined ? durable.length : Math.max(0, Math.min(Math.floor(cursor), durable.length));
  const log = durable.slice(0, position);
  const revision = log.reduce((value, event) => Math.max(value, event.revision ?? 0), 0);
  const spec = exactSpec(root, slug, runId, revision);
  const nodes = new Map<string, { id: string; state: NodeRunState; attempt: number; sessionId?: string; revision?: number; actor?: { id: string; persona?: string } }>();
  spec?.nodes.forEach(node => nodes.set(node.id, { id: node.id, state: 'pending', attempt: 0, actor: node.actor }));
  const ensure = (id: string) => { let value = nodes.get(id); if (!value) { value = { id, state: 'pending', attempt: 0 }; nodes.set(id, value); } return value; };
  for (const event of log) {
    if (event.kind === 'node-scheduled') Object.assign(ensure(event.nodeId), { state: 'running', attempt: ensure(event.nodeId).attempt + 1, revision: event.revision ?? 0 });
    if (event.kind === 'node-spawned') Object.assign(ensure(event.nodeId), { sessionId: event.sessionId, ...(event.actor ? { actor: event.actor } : {}), attempt: event.attempt ?? ensure(event.nodeId).attempt, revision: event.attemptRevision ?? event.revision ?? 0 });
    if (event.kind === 'node-finished') Object.assign(ensure(event.nodeId), { state: event.state, sessionId: event.sessionId });
    if (event.kind === 'node-waiting-approval') ensure(event.nodeId).state = 'waiting-approval';
    if (event.kind === 'node-help-resumed') ensure(event.nodeId).state = 'running';
    if (event.kind === 'task-help' && ['waiting', 'waiting-user'].includes(event.help.state)) ensure(event.help.nodeId).state = 'waiting-help';
    if (event.kind === 'node-retry') ensure(event.nodeId).state = 'pending';
    if (event.kind === 'run-resumed') { event.discardInstanceIds?.forEach(id => nodes.delete(id)); event.retryNodeIds?.forEach(id => ensure(id).state = 'pending'); }
    if (event.kind === 'artifact-results-invalidated') event.nodeIds.forEach(id => ensure(id).state = 'invalid');
    if (event.kind === 'orchestration-patch') event.cancelled?.forEach(id => ensure(id).state = 'cancelled');
  }
  const started = log.find(event => event.kind === 'run-started');
  const snapshot: TaskRunSnapshotDto = { slug, runId, taskId: started?.kind === 'run-started' ? started.taskId : slug,
    orchestratorSessionId: started?.kind === 'run-started' ? started.orchestratorSessionId : undefined,
    status: log.length ? deriveRunStatusFromLog(log) : 'not-started', nodes: [...nodes.values()], revision,
    tokensUsed: log.reduce((value, event) => 'tokensUsed' in event && typeof event.tokensUsed === 'number' ? event.tokensUsed : value, 0),
    workers: [...new Map(log.filter(event => event.kind === 'task-worker').map(event => [event.worker.workerId, event.worker])).values()] };
  // Research records carry exact producer identity; prefix filtering prevents future conclusions from leaking into earlier frames.
  const research = spec?.research && log.some(event => event.kind === 'run-started') ? loadResearchResults(root, slug, runId, new Set(), position) : undefined;
  snapshot.research = research;
  const history = durable.map((event, index) => ({ cursor: index + 1, seq: event.seq, revision: event.revision ?? 0, time: event.t, kind: event.kind,
    nodeId: 'nodeId' in event ? event.nodeId : undefined, reason: 'reason' in event ? event.reason : 'rationale' in event ? event.rationale : undefined }));
  const changes = log.flatMap(event => { if (event.kind !== 'orchestration-patch') return [];
    const before = exactSpec(root, slug, runId, event.baseRevision), after = exactSpec(root, slug, runId, event.revision ?? event.baseRevision + 1);
    return [{ revision: event.revision, reason: event.rationale, impact: before && after ? revisionImpact(before, after, event.cancelled) : null }]; });
  const validation = spec ? validateTaskSpec(spec) : undefined;
  const preflight = spec ? { ...explainPreflight(spec), valid: validation!.valid, errors: validation!.errors, warnings: validation!.warnings } : null;
  const consumedResults = new Set(log.flatMap(event => event.kind === 'orchestration-patch' || event.kind === 'coordinator-decision' ? event.consumedResults ?? [] : []));
  const preview = patch && spec ? validateOrchestrationPatch(patch, { spec, runId, revision,
    seenDecisionIds: new Set(log.filter(event => event.kind === 'orchestration-patch' || event.kind === 'coordinator-decision').map(event => event.decisionId)),
    nodeStates: Object.fromEntries([...nodes].map(([id, node]) => [id, node.state])),
    pendingResultIds: new Set(log.flatMap(event => event.kind === 'node-finished' && event.resultEvent && !consumedResults.has(event.resultEvent.id) ? [event.resultEvent.id] : [])),
    researchRecords: research?.records }) : undefined;
  return { readOnly: true as const, cursor: position, total: durable.length, spec, snapshot, history, changes, preflight,
    views: spec ? Object.fromEntries(TASK_VIEWS.map(view => [view, projectTaskView(spec, view, research)])) : {},
    preview: preview?.ok ? { ok: true, revision: preview.revision, impact: revisionImpact(spec!, preview.spec, preview.cancelled) } : preview,
    limitations: [...(!spec ? ['Exact revision snapshot is missing or invalid; no replacement from the current definition was invented.'] : []),
      ...(position < durable.length ? ['Mutable latest artifact bodies are withheld; research uses exact immutable attempt/version receipts.'] : []),
      ...(durable.some(event => event.seq === undefined) ? ['Legacy log lacks sequence identity; cursor uses durable file order.'] : [])] };
}
export type TaskRunInspection = ReturnType<typeof inspectTaskRun>;
