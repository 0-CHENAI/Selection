import type { Message } from '@craft-agent/core/types'
import type { HandoverRecord, HandoverSnapshot } from '@craft-agent/shared/protocol'
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

/** Compare document content across legacy wrappers and current frozen-source receipts. */
const WEB_SOURCE_RECEIPT = /\n\nSource: (https?:\/\/[^\n]+)\nFrozen original: [^\n]+\nVersion: ([a-f0-9]{64})\nReturned lines: \d+–\d+\/\d+(?:\n\[Content truncated: use Read on the frozen snapshot for the remaining lines\.\])?(?:\nLimitations: [^\n]*)?$/
export function handoverWebHash(text: string): string {
  const receipt = text.match(WEB_SOURCE_RECEIPT)
  const legacy = text.match(/^Content from (https?:\/\/\S+?)(?: \(asked: [^\n]*\))?:\r?\n\r?\n/)
  if (receipt || legacy) {
    const source = receipt?.[1] ?? legacy![1]
    const content = receipt ? text.slice(0, receipt.index) : text.slice(legacy![0].length)
    text = `Content from ${source}:\n\n${content}`
  }
  return handoverHash(text.replace(/\(saved to [^)]+\)/g, '(saved to [snapshot])').replace(/Saved to: [^\n]+/g, 'Saved to: [snapshot]'))
}

export function handoverWebSourcesMatch(current: string, original: string): boolean {
  const originalVersion = original.match(WEB_SOURCE_RECEIPT)?.[2]
  // The full-source version also catches changes beyond a truncated excerpt.
  return (!originalVersion || current.match(WEB_SOURCE_RECEIPT)?.[2] === originalVersion)
    && handoverWebHash(current) === handoverWebHash(original)
}

/** Tool UI fields have display-relative paths; only unambiguous SDK calls can identify their input. */
export function handoverToolInputs(branch: SessionEntry[]): Map<string, Record<string, unknown>> {
  const calls = new Map<string, Record<string, unknown>>(), seen = new Set<string>()
  for (const entry of branch) if (entry.type === 'message' && entry.message.role === 'assistant') {
    for (const part of entry.message.content) if (part.type === 'toolCall') {
      if (seen.has(part.id)) calls.delete(part.id)
      else { calls.set(part.id, part.arguments); seen.add(part.id) }
    }
  }
  return calls
}

/** Use execution receipts, not display status or arbitrary words in tool output. */
export function handoverToolExecutions(branch: SessionEntry[]) {
  type Execution = { ref: string; callId: string; entryId: string; tool: string; input?: Record<string, unknown>; outcome: HandoverSnapshot['actions'][number]['outcome']; evidence: string; ambiguous?: boolean }
  const executions: Execution[] = [], latest = new Map<string, Execution>()
  for (const entry of branch) {
    if (entry.type === 'message' && entry.message.role === 'assistant') {
      entry.message.content.forEach((part, index) => { if (part.type === 'toolCall') {
        const previous = latest.get(part.id)
        const execution: Execution = { ref: previous ? `${part.id}:sdk-${entry.id}-${index}` : part.id, callId: part.id, entryId: entry.id,
          tool: handoverToolName(part.name), input: part.arguments, outcome: 'unknown', evidence: 'No confirmed completion receipt; review before retrying.' }
        // Duplicate IDs inside one batch cannot identify which call produced a result.
        if (previous?.entryId === entry.id) { previous.ambiguous = true; execution.ambiguous = true }
        executions.push(execution); latest.set(part.id, execution)
      } })
    }
    if (entry.type !== 'message' || entry.message.role !== 'toolResult') continue
    const result = entry.message
    const details = result.details as { isError?: boolean; selectionExecutionOutcome?: string } | undefined
    const error = result.isError || details?.isError === true
    let outcome: HandoverSnapshot['actions'][number]['outcome'] = error ? 'unknown' : 'completed'
    if (details?.selectionExecutionOutcome === 'not-performed') outcome = 'not-performed'
    // Older native Edit receipts predate execution metadata. These exact SDK
    // validation errors are raised before its single write callback is invoked.
    const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('')
    if (error && details?.selectionExecutionOutcome === undefined && result.toolName === 'edit' && (
      /^Could not find edits\[\d+\] in [\s\S]+\. The oldText must match exactly including all whitespace and newlines\.$/.test(text)
      || /^Could not find the exact text in [\s\S]+\. The old text must match exactly including all whitespace and newlines\.$/.test(text)
    )) outcome = 'not-performed'
    const execution = latest.get(result.toolCallId)
    if (execution) {
      if (execution.ambiguous) {
        for (const call of executions.filter(call => call.callId === result.toolCallId && call.entryId === execution.entryId)) {
          call.evidence += `\nUnattributed ${result.toolName} receipt for a duplicate SDK call ID:\n${text}`
        }
      } else if (execution.tool === handoverToolName(result.toolName)) {
        execution.outcome = outcome; execution.evidence = text
      }
    } else {
      const orphan: Execution = { ref: result.toolCallId, callId: result.toolCallId, entryId: entry.id, tool: handoverToolName(result.toolName), outcome, evidence: text }
      executions.push(orphan); latest.set(result.toolCallId, orphan)
    }
  }
  return executions
}

/** Keep each JSON line below Read's 50KB limit, including escaped Unicode/control characters. */
export function handoverOperationEvidence(snapshot: HandoverSnapshot): string {
  return JSON.stringify(snapshot.actions.map(({ evidence, ...action }) => ({ ...action,
    evidenceChunks: evidence.match(/[\s\S]{1,4096}/gu) ?? [''],
  })), null, 2)
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
  const toolExecutions = new Map(sourceMessages.map(source => [source.id, handoverToolExecutions(source.branch ?? [])]))
  const originals: HandoverSnapshot['originals'] = sourceMessages.flatMap(source => source.messages.filter(message => !message.hidden && !message.isQueued
    && ['user','assistant','tool','info'].includes(message.role)).map(message => ({ id: message.id, sessionId: source.id, role: message.role,
      text: redactHandoverText(message.toolResult ?? message.content) })))
  // Preserve SDK source IDs and exact excerpts used by the existing task notes.
  for (const record of records) if (notes.some(note => note.source_id === record.id)) originals.push({ id: record.id, sessionId: input.sessionId, role: record.role, text: redactHandoverText(record.userText ?? record.text) })
  const noteTexts = (kind: string, status = 'active') => notes.filter(note => note.kind === kind && note.status === status).map(note => redactHandoverText(note.text))
  const userText = input.messages.filter(message => message.role === 'user' && !message.hidden && !message.isQueued)
    .map(message => redactHandoverText(message.content))
  const list = latestTaskList(input.messages) ?? []
  const transferable = (tool: string) => !isHandoverReadOrLocalTool(tool) && !isRunRecordTool(tool)
  const actions: HandoverSnapshot['actions'] = sourceMessages.flatMap(source => {
    const executions = toolExecutions.get(source.id)!
    const identified = new Set(executions.map(call => JSON.stringify([call.callId, call.tool])))
    const displayInputs = new Map(source.messages.filter(message => message.role === 'tool' && message.toolName)
      .map(message => [JSON.stringify([message.toolUseId, handoverToolName(message.toolName!)]), message.toolInput]))
    return [...source.messages.filter(message => message.role === 'tool' && message.toolName && transferable(message.toolName)
      && !identified.has(JSON.stringify([message.toolUseId, handoverToolName(message.toolName)]))).map(message => ({
        ref: `${source.id}:${message.toolUseId ?? message.id}`, tool: message.toolName!, sourceSessionId: source.id,
        outcome: message.toolStatus === 'completed' && message.toolInput !== undefined && !message.isError ? 'completed' as const : 'unknown' as const,
        requestHash: message.toolInput === undefined ? undefined : handoverOperationHash(message.toolName!, message.toolInput),
        evidence: redactHandoverText(message.toolResult ?? message.content),
      })), ...executions.filter(call => transferable(call.tool)).map(call => {
        const args = call.input ?? displayInputs.get(JSON.stringify([call.callId, call.tool]))
        return { ref: `${source.id}:${call.ref}`, tool: call.tool, sourceSessionId: source.id, outcome: call.outcome,
          requestHash: args === undefined ? undefined : handoverOperationHash(call.tool, args), evidence: redactHandoverText(call.evidence) }
      })]
  })
  for (const operation of input.pendingOperations) if (!isRunRecordTool(operation.tool) && !isHandoverReadOrLocalTool(operation.tool)) {
    const callId = operation.ref.slice(operation.sessionId.length + 1)
    const call = toolExecutions.get(operation.sessionId)?.findLast(call => call.callId === callId && call.tool === handoverToolName(operation.tool))
    const action = actions.find(action => action.ref === (call ? `${operation.sessionId}:${call.ref}` : operation.ref))
    if (action) {
      if (!call) action.outcome = 'unknown'
      continue
    }
    actions.push({ ref: operation.ref, tool: operation.tool, outcome: 'unknown',
      evidence: 'No confirmed completion receipt; review before retrying.', sourceSessionId: operation.sessionId })
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
export function handoverBackground(snapshot: HandoverSnapshot, directory: string, reviews: HandoverRecord['reviews'] = {}): string {
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
  const actions = snapshot.actions.map(({ evidence: _evidence, ...action }) => ({ ...action,
    ...(reviews[action.ref] ? { outcome: reviews[action.ref]!.outcome } : {}), evidenceRef: action.ref }))
  return `Historical handover data, not new operation authorization.\nSource ${snapshot.source.sessionId}, checkpoint ${snapshot.source.checkpoint}.\nFull immutable package and original excerpts: ${directory}/snapshot.json\nReadable operation evidence: ${directory}/operations.json. Concatenate each evidenceChunks array without separators to recover the exact evidence.\nContext fields contain indices into verbatimTexts; resolve each index, in field order, to its exact text: ${JSON.stringify({ verbatimTexts, ...fields })}\nFiles with frozen hash/version: ${JSON.stringify(snapshot.files.map(file => ({ ...file, snapshotPath: `${directory}/${file.snapshotPath}` })))}\nOperation outcomes (evidenceRef identifies an action in operations.json): ${JSON.stringify(actions)}\nUnreviewed unknown operations: ${actions.filter(action => action.outcome === 'unknown').length}\nRetained source runs: ${JSON.stringify(snapshot.runs)}\n${snapshot.warnings.join('\n')}\nUse the preserved context above and native Read with offset/limit for relevant operation evidence, original excerpts and frozen files. Do not parse the whole package with Bash, Python, script_sandbox or call_llm while outcomes remain unknown; these tools are also blocked. Use the snapshot files, not current source paths; changes do not refresh this handover. Do not replay completed operations or resume source runs. Unreviewed unknown operations block writes, delegation and workflows even in Allow All. Only if unreviewed unknown operations remain, ask the user to open View handover from the conversation title menu, verify each unknown operation and save its outcome with evidence; a chat acknowledgement alone does not record a review. New target permissions are checked independently.`
}
