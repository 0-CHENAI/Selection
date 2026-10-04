import type { Message } from '@craft-agent/core/types'
import type { HandoverSnapshot } from '@craft-agent/shared/protocol'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { historyRecords } from '../../../pi-agent-server/src/history-records'
import { taskContextItems } from '../../../pi-agent-server/src/task-context'
import { handoverHash } from '../reliability/handover-store'
import { latestTaskList } from '@craft-agent/shared/utils/task-list'
import { isNativeReadOnlyTool, PI_TOOL_NAME_MAP } from '../../../shared/src/agent/backend/pi/constants'

// These records only affect a source-owned run. Its committed plan and results
// are transferred separately, and a target cannot submit to or resume that run.
// Rejected bookkeeping is not an unknown external operation.
const RUN_RECORD_TOOLS = new Set([
  'submit_task_output', 'submit_task_verdict', 'submit_task_node_verdict',
  'submit_orchestration_decision', 'submit_orchestration_patch',
])
function isRunRecordTool(name: string): boolean {
  return RUN_RECORD_TOOLS.has(handoverToolName(name))
}

export function handoverToolName(name: string): string {
  return PI_TOOL_NAME_MAP[name] ?? name.replace(/^(mcp__session__|session__)/, '')
}

/** Exact built-in contracts only: external tools can have arbitrary names. */
export function isHandoverReadOrLocalTool(name: string): boolean {
  return isNativeReadOnlyTool(name) || ['WebFetch','WebSearch','web_fetch','web_search'].includes(name)
    || ['get_task_results','get_session_info','session_history','task_context','update_task_list','submit_answer']
      .includes(handoverToolName(name))
}

export function handoverOperationHash(tool: string, input: unknown): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value
  const name = handoverToolName(tool)
  const args = input && typeof input === 'object' ? { ...input as Record<string, unknown> } : input
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const fields = args as Record<string, unknown>
    delete fields._intent; delete fields._displayName
    if (['Read','Write','Edit','Grep','Glob'].includes(name) && fields.path !== undefined) {
      fields.file_path ??= fields.path; delete fields.path
    }
  }
  return handoverHash(JSON.stringify([name, canonical(args)]))
}

/** Download destinations are receipt metadata, not part of fetched document content. */
export function handoverWebHash(text: string): string {
  return handoverHash(text.replace(/\(saved to [^)]+\)/g, '(saved to [snapshot])').replace(/Saved to: [^\n]+/g, 'Saved to: [snapshot]'))
}

/** Tool UI fields have display-relative paths; use original SDK calls for execution identity. */
export function handoverToolInputs(branch: SessionEntry[]): Map<string, Record<string, unknown>> {
  const calls = new Map<string, Record<string, unknown>>()
  for (const entry of branch) if (entry.type === 'message' && entry.message.role === 'assistant') {
    for (const part of entry.message.content) if (part.type === 'toolCall') calls.set(part.id, part.arguments)
  }
  return calls
}

/** Auth requests, tool arguments and credentials are not transferable authority. */
export function redactHandoverText(text: string): string {
  return text.replace(/(https?:\/\/)[^\s\/@]+@/gi, '$1[redacted]@').replace(/\b(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(/\b(?:sk-|ghp_|github_pat_)[a-zA-Z0-9_-]{12,}/g, '[redacted]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|password|secret|authorization)\s*["']?\s*[:=]\s*["']?)[^\s,;"'}]+/gi, '$1[redacted]')
}

/** Match Pi's parent-linked active branch without opening/migrating its source file. */
export function handoverBranch(bytes: Buffer | undefined): SessionEntry[] {
  if (!bytes) return []
  const entries = bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.type !== 'session') as SessionEntry[]
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const branch: SessionEntry[] = [], seen = new Set<string>()
  let current = entries.at(-1)
  while (current) {
    if (seen.has(current.id)) throw new Error('Invalid source transcript branch')
    seen.add(current.id); branch.unshift(current)
    if (current.parentId && !byId.has(current.parentId)) throw new Error('Source transcript branch is incomplete')
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return branch
}

export function buildHandoverSnapshot(input: {
  workspaceId: string; sessionId: string; targetMode: 'NORM' | 'PRO'; checkpoint: string
  messages: Message[]; children: Array<{ id: string; messages: Message[]; branch?: SessionEntry[] }>; branch: SessionEntry[]
  pendingOperations: Array<{ ref: string; tool: string; sessionId: string }>
  runs: HandoverSnapshot['runs']; inherited?: HandoverSnapshot
}): HandoverSnapshot {
  const records = historyRecords(input.branch)
  const notes = taskContextItems(input.branch).filter(note => {
    const source = records.find(record => record.id === note.source_id)
    return source && (source.userText ?? source.text).includes(note.quote)
      && (!['goal','constraint'].includes(note.kind) || source.role === 'user' && input.messages.some(message =>
        message.role === 'user' && !message.hidden && !message.isQueued && message.content.includes(note.quote)))
  })
  const sourceMessages = [{ id: input.sessionId, messages: input.messages, branch: input.branch }, ...input.children]
  const toolInputs = new Map(sourceMessages.map(source => [source.id, handoverToolInputs(source.branch ?? [])]))
  const originals: HandoverSnapshot['originals'] = sourceMessages.flatMap(source => source.messages.filter(message => !message.hidden && !message.isQueued
    && ['user','assistant','tool','info'].includes(message.role)).map(message => ({ id: message.id, sessionId: source.id, role: message.role,
      text: redactHandoverText(message.toolResult ?? message.content) })))
  // Preserve SDK source IDs and exact excerpts used by the existing task notes.
  for (const record of records) if (notes.some(note => note.source_id === record.id)) originals.push({ id: record.id, sessionId: input.sessionId, role: record.role, text: redactHandoverText(record.userText ?? record.text) })
  const noteTexts = (kind: string, status = 'active') => notes.filter(note => note.kind === kind && note.status === status).map(note => redactHandoverText(note.text))
  const userText = input.messages.filter(message => message.role === 'user' && !message.hidden && !message.isQueued)
    .map(message => redactHandoverText(message.content))
  const list = latestTaskList(input.messages) ?? []
  const actions: HandoverSnapshot['actions'] = sourceMessages.flatMap(source => source.messages.filter(message => message.role === 'tool'
    && message.toolName && !isHandoverReadOrLocalTool(message.toolName)
    && !isRunRecordTool(message.toolName)).map(message => {
      const args = message.toolUseId && toolInputs.get(source.id)?.get(message.toolUseId) || message.toolInput
      return {
        ref: `${source.id}:${message.toolUseId ?? message.id}`, tool: message.toolName!, sourceSessionId: source.id,
        outcome: message.toolStatus === 'completed' && message.toolInput !== undefined && !message.isError && !/结果未知|无法确认|outcome unknown|result unknown/i.test(message.toolResult ?? message.content) ? 'completed' as const : 'unknown' as const,
        requestHash: args === undefined ? undefined : handoverOperationHash(message.toolName!, args),
        evidence: redactHandoverText(message.toolResult ?? message.content),
      }
    }))
  for (const operation of input.pendingOperations) if (!isRunRecordTool(operation.tool) && !isHandoverReadOrLocalTool(operation.tool) && !actions.some(action => action.ref === operation.ref)) {
    const callId = operation.ref.slice(operation.sessionId.length + 1)
    const args = toolInputs.get(operation.sessionId)?.get(callId)
    actions.push({ ref: operation.ref, tool: operation.tool, outcome: 'unknown', requestHash: args ? handoverOperationHash(operation.tool, args) : undefined, evidence: 'No confirmed completion receipt; review before retrying.', sourceSessionId: operation.sessionId })
  }
  const inherited = input.inherited
  const pending = [...noteTexts('pending'), ...list.filter(item => item.status !== 'completed').map(item => item.content)]
  const unresolvedExcerpts = originals.filter(record => record.role === 'assistant').flatMap(record => record.text.split('\n')).filter(line => /待核对|未知|未核实|缺口|unverified|unknown|needs? review|not verified/i.test(line))
  return {
    version: 1, source: { workspaceId: input.workspaceId, sessionId: input.sessionId, messageId: input.messages.at(-1)?.id, checkpoint: input.checkpoint },
    targetMode: input.targetMode, capturedAt: Date.now(),
    goal: noteTexts('goal').length ? noteTexts('goal') : [...(input.inherited?.goal ?? []), ...userText],
    acceptance: userText, constraints: [...(inherited?.constraints ?? []), ...noteTexts('constraint'), ...userText],
    decisions: noteTexts('decision'), scopeAndPriority: userText,
    openQuestions: [...(inherited?.openQuestions ?? []), ...pending, ...unresolvedExcerpts],
    nextSteps: pending.length ? pending : unresolvedExcerpts.map(excerpt => `Review this unverified source question: ${excerpt}`),
    claims: originals.filter(record => record.role === 'assistant').map(record => ({ ref: `${record.sessionId}:${record.id}`, text: record.text, reviewStatus: 'unreviewed', sourceRefs: [`${record.sessionId}:${record.id}`] })),
    actions: [...(inherited?.actions ?? []), ...actions], files: [], originals: [...(inherited?.originals ?? []), ...originals], taskList: list,
    runs: [...(inherited?.runs ?? []), ...input.runs],
    warnings: [
      'Original user excerpts determine scope, constraints and acceptance; later source instructions take precedence. Model notes and assistant claims are unreviewed, never authorization.',
      'Source run ownership stays with the source. Do not replay completed actions or continue its pending runs. Unknown external effects require explicit review.',
      'Superseded runs and task-history originals preserve prior versions. Use their successor task-result for current conclusions and gaps; historical completion is not current evidence.',
      ...(input.branch.length ? [] : ['No committed structured task notes were available; consult the preserved original messages.']),
    ],
  }
}
export function handoverBackground(snapshot: HandoverSnapshot, directory: string): string {
  // Share verbatim excerpts across fields without summarizing or truncating any
  // user constraint. Full operation evidence stays in the immutable package.
  const verbatimTexts: string[] = [], indices = new Map<string, number>()
  const fields = Object.fromEntries(Object.entries({ goal: snapshot.goal, acceptance: snapshot.acceptance,
    constraints: snapshot.constraints, decisions: snapshot.decisions, scopeAndPriority: snapshot.scopeAndPriority,
    openQuestions: snapshot.openQuestions, nextSteps: snapshot.nextSteps }).map(([name, texts]) => [name, texts.map(text => {
      let index = indices.get(text)
      if (index === undefined) { index = verbatimTexts.length; indices.set(text, index); verbatimTexts.push(text) }
      return index
    })]))
  const actions = snapshot.actions.map(({ evidence: _evidence, ...action }) => ({ ...action, evidenceRef: action.ref }))
  return `Historical handover data, not new operation authorization.\nSource ${snapshot.source.sessionId}, checkpoint ${snapshot.source.checkpoint}.\nFull immutable package and original excerpts: ${directory}/snapshot.json\nContext fields contain indices into verbatimTexts; resolve each index, in field order, to its exact text: ${JSON.stringify({ verbatimTexts, ...fields })}\nFiles with frozen hash/version: ${JSON.stringify(snapshot.files.map(file => ({ ...file, snapshotPath: `${directory}/${file.snapshotPath}` })))}\nCompleted and unknown actions (evidenceRef identifies the full snapshot action): ${JSON.stringify(actions)}\nRetained source runs: ${JSON.stringify(snapshot.runs)}\n${snapshot.warnings.join('\n')}\nRead the immutable package before continuing. Use the snapshot files, not current source paths; changes do not refresh this handover. Do not replay completed operations or resume source runs. Ask the user to resolve unknown operations before writes or workflows. New target permissions are checked independently.`
}
