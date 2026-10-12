import { createHash } from 'node:crypto'
import { TaskSpecSchema, TaskNodeSchema, validateTaskSpec, planValueKey, type TaskSpec } from '@craft-agent/shared/tasks'
import type { CreateTaskInput } from '@craft-agent/session-tools-core'
import type { PermissionMode } from '@craft-agent/shared/agent/mode-manager'

export const chatRequestKey = (rootId: string, requestId: string) => createHash('sha256').update(`${rootId}\0${requestId}`).digest('hex')
export const chatInputHash = (input: unknown) => createHash('sha256').update(planValueKey(input)).digest('hex')

/** Reuse the canonical parser and validator; never create a parallel plan representation. */
export function buildChatPlan(input: CreateTaskInput, root: {
  id: string; originalRequest?: string; model?: string; llmConnection?: string; permissionMode?: PermissionMode;
  projectId?: string; workingDirectory?: string; enabledSourceSlugs?: string[];
}): TaskSpec {
  if (!input.requestId?.trim() || input.requestId.length > 128) throw new Error('A stable requestId (1–128 characters) is required')
  if (input.spec !== undefined && (input.title !== undefined || input.description !== undefined)) throw new Error('Use spec or title/description, not both')
  const id = `pro-${chatRequestKey(root.id, 'canonical-plan').slice(0, 24)}`
  const raw = input.spec ?? {
    id, title: input.title, goal: input.description, acceptance_criteria: input.acceptanceCriteria,
    nodes: [{ id: 'work', kind: 'session', prompt: input.description }],
    sources: input.sources, skills: input.skills,
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('A structured task spec is required')
  const candidate = raw as Partial<TaskSpec>
  if (candidate.research && candidate.runner === 'conduct') {
    throw new Error('Chat research uses judgmentVersion: 1 and requires runner: orchestrate for same-line repairs and branch dispositions. Resubmit the research plan with runner: orchestrate; ordinary conduct plans remain supported.')
  }
  for (const node of candidate.nodes ?? []) {
    const parsed = TaskNodeSchema.parse(node)
    const unknown = Object.keys(node).filter(key => !(key in parsed) && key !== 'type')
    if (unknown.length) throw new Error(`Unknown node fields: ${unknown.join(', ')}`)
  }
  if (input.model && input.model !== root.model || input.llmConnection && input.llmConnection !== root.llmConnection) throw new Error('Plan must retain the current model and connection')
  const rank = { safe: 0, ask: 1, 'allow-all': 2 }
  const permission = root.permissionMode ?? 'safe'
  if (candidate.defaults?.permissionMode && rank[candidate.defaults.permissionMode] > rank[permission]) throw new Error('Plan permission exceeds current authorization')
  if (input.projectId && input.projectId !== root.projectId || candidate.project && candidate.project !== root.projectId) throw new Error('Plan must remain in the current project')
  if (input.workingDirectory && input.workingDirectory !== root.workingDirectory || candidate.cwd && candidate.cwd !== root.workingDirectory) throw new Error('Plan must remain in the current working directory')
  if (candidate.sources?.some(source => !root.enabledSourceSlugs?.includes(source))) throw new Error('Plan sources exceed the current root source scope')
  const spec = TaskSpecSchema.strict().parse({
    ...candidate, id, goal: root.originalRequest ?? candidate.goal, schema_version: 3, runner: candidate.runner ?? 'orchestrate',
    ...(candidate.research ? { research: { ...candidate.research, assuranceVersion: 2, judgmentVersion: 1 } } : {}),
    project: root.projectId, cwd: root.workingDirectory,
    execution: {
      ...candidate.execution,
      coordinator_gate: candidate.execution?.coordinator_gate ?? { mode: candidate.research ? 'required' : 'adaptive' },
    },
    locked_fields: [...new Set([...(candidate.locked_fields ?? []), 'goal' as const, 'acceptance_criteria' as const])],
    sources: candidate.sources ?? root.enabledSourceSlugs,
    defaults: { ...candidate.defaults, model: root.model, llmConnection: root.llmConnection, permissionMode: candidate.defaults?.permissionMode ?? permission },
  })
  if (spec.research && !spec.research.sources.length) {
    throw new Error('Frozen research requires existing local originals in research.sources. For open-web discovery, omit research and researchRole; use normal session nodes with WebSearch/WebFetch and an independent verify node. Source-backed research can start after original snapshots exist.')
  }
  const validation = validateTaskSpec(spec)
  if (validation.errors.length) throw new Error(validation.errors.map(issue => issue.message).join('; '))
  return spec
}
