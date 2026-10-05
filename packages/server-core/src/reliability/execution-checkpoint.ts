import { INTERRUPTED_READ_RESULT, recoveredFileOperationText, readToolFileOperation, verifyToolFileOperation, type ToolFileOperationIdentity } from '../../../shared/src/agent/backend/pi/file-operation-receipts'
import { isNativeReadOnlyTool } from '../../../shared/src/agent/backend/pi/constants'
import type { Message } from '@craft-agent/core/types'
import { isDeepStrictEqual } from 'node:util'
import { acquireProjectLock } from './project-lock'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type ToolRecoveryClass = 'read-only' | 'idempotent' | 'file-verifiable' | 'unknown'
/** Native identities and explicit host-owned contracts; other MCP effects remain unknown. */
export function toolRecoveryClass(name: string): ToolRecoveryClass {
  // Host-owned, identity-fenced coordination has no external effect; a crash
  // cancels its waiting record before retained-tool recovery can request again.
  if (/^(?:mcp__session__|session__)?task_help$/.test(name)) return 'read-only'
  return isNativeReadOnlyTool(name) ? 'read-only' : 'unknown'
}
export interface ExecutionTaskIdentity {
  taskSlug?: string
  taskRunId?: string
  taskNodeId?: string
  taskAttempt?: number
  taskRevision?: number
  taskActor?: { id: string; persona?: string }
  taskWorkerId?: string
  orchestrationId?: string
  parentSessionId?: string
}
/** Link to the existing coordinator state, without duplicating its node scheduler. */
export function executionTaskIdentity(session: ExecutionTaskIdentity): ExecutionTaskIdentity | undefined {
  const identity = Object.fromEntries(['taskSlug', 'taskRunId', 'taskNodeId', 'taskAttempt', 'taskRevision', 'taskActor', 'taskWorkerId', 'orchestrationId', 'parentSessionId']
    .flatMap(key => session[key as keyof ExecutionTaskIdentity] === undefined ? [] : [[key, session[key as keyof ExecutionTaskIdentity]]]))
  return Object.keys(identity).length ? identity : undefined
}

function validTaskIdentity(value: unknown): value is ExecutionTaskIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(([key, field]) => {
    if (['taskAttempt', 'taskRevision'].includes(key)) return Number.isSafeInteger(field) && field >= 0
    if (key === 'taskActor') return !!field && typeof field === 'object' && !Array.isArray(field)
      && typeof field.id === 'string' && !!field.id
      && Object.keys(field).every(name => ['id', 'persona'].includes(name))
      && (field.persona === undefined || typeof field.persona === 'string' && !!field.persona)
    return ['taskSlug', 'taskRunId', 'taskNodeId', 'taskWorkerId', 'orchestrationId', 'parentSessionId'].includes(key)
      && typeof field === 'string' && !!field
  })
}
export interface ExecutionCheckpoint {
  contextReads?: Record<string, { path: string; hash: string; complete: boolean; write?: boolean }>
  contextUnverified?: boolean
  version: 1
  sessionId: string
  userMessageId: string
  generation: number
  answerRunId?: string
  sdkSessionId?: string
  sdkStateHash?: string
  sdkStateSize?: number
  sdkTurnAnchor?: string
  compactionMessageId?: string
  taskIdentity?: ExecutionTaskIdentity
  waitingFor?: 'model' | 'tool' | 'user' | 'recovery'
  transcriptTailId?: string
  status: 'running' | 'claimed' | 'completed' | 'cancelled' | 'blocked'
  pendingTools: Record<string, { name: string; recovery: ToolRecoveryClass }>
  completedTools: string[]
  updatedAt: number
  reason?: string
}
export type CheckpointRead = { kind: 'missing' } | { kind: 'unsupported' } | { kind: 'corrupt' } | { kind: 'ok'; checkpoint: ExecutionCheckpoint }
export function sdkStateSnapshot(sessionPath: string, sdkSessionId?: string): { hash: string; size: number; bytes: Buffer } | undefined {
  if (!sdkSessionId) return undefined
  try {
    const directory = join(sessionPath, '.pi-sessions')
    const matches = readdirSync(directory).filter(name => name.endsWith(`_${sdkSessionId}.jsonl`))
    if (matches.length !== 1) return undefined
    const bytes = readFileSync(join(directory, matches[0]!))
    if (!bytes.length) return undefined
    return { hash: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, bytes }
  } catch { return undefined }
}
export function sdkStateHash(sessionPath: string, sdkSessionId?: string): string | undefined {
  return sdkStateSnapshot(sessionPath, sdkSessionId)?.hash
}
/** Only complete results of already-pending calls may extend the saved SDK prefix. */
export function recoverySdkSnapshot(sessionPath: string, checkpoint: ExecutionCheckpoint): ReturnType<typeof sdkStateSnapshot> {
  const current = sdkStateSnapshot(sessionPath, checkpoint.sdkSessionId)
  if (current && checkpoint.sdkTurnAnchor) {
    try {
      if (!current.bytes.toString('utf8').trim().split('\n').some(line => {
        const entry = JSON.parse(line)
        return entry.type === 'message' && entry.id === checkpoint.sdkTurnAnchor
      })) return undefined
    } catch { return undefined }
  }
  if (!current || current.hash === checkpoint.sdkStateHash) return current
  const size = checkpoint.sdkStateSize
  if (size === undefined || size <= 0 || size >= current.size
    || createHash('sha256').update(current.bytes.subarray(0, size)).digest('hex') !== checkpoint.sdkStateHash
    || current.bytes[size - 1] !== 10 || current.bytes.at(-1) !== 10) return undefined
  try {
    const prefix = current.bytes.subarray(0, size).toString('utf8').trim().split('\n').map(line => JSON.parse(line))
    const entries = current.bytes.subarray(size).toString('utf8').trim().split('\n').map(line => JSON.parse(line))
    const seen = new Set(prefix.map(entry => entry.id)), results = new Set<string>()
    let parentId = prefix.at(-1)?.type === 'session' ? null : prefix.at(-1)?.id
    for (const entry of entries) {
      if (entry.type !== 'message' || typeof entry.id !== 'string' || seen.has(entry.id) || entry.parentId !== parentId
        || entry.message?.role !== 'toolResult' || typeof entry.message.toolCallId !== 'string'
        || !checkpoint.pendingTools[entry.message.toolCallId] || results.has(entry.message.toolCallId)) return undefined
      seen.add(entry.id); results.add(entry.message.toolCallId); parentId = entry.id
    }
    return current
  } catch { return undefined }
}
export function readExecutionCheckpoint(sessionPath: string): CheckpointRead {
  const file = join(sessionPath, 'data', 'execution-checkpoint.json')
  if (!existsSync(file)) return { kind: 'missing' }
  try {
    const c = JSON.parse(readFileSync(file, 'utf8'))
    if (c?.version !== 1) return { kind: 'unsupported' }
    if (typeof c.sessionId !== 'string' || typeof c.userMessageId !== 'string'
      || ['sdkTurnAnchor', 'compactionMessageId'].some(key => c[key] !== undefined && (typeof c[key] !== 'string' || !c[key]))
      || (c.taskIdentity !== undefined && !validTaskIdentity(c.taskIdentity))
      || (c.contextUnverified !== undefined && typeof c.contextUnverified !== 'boolean')
      || (c.contextReads !== undefined && (!c.contextReads || typeof c.contextReads !== 'object' || Array.isArray(c.contextReads)
        || Object.values(c.contextReads).some((read: any) => !read || typeof read.path !== 'string' || !read.path
          || typeof read.hash !== 'string' || !/^[a-f0-9]{64}$/.test(read.hash) || typeof read.complete !== 'boolean' || read.write !== undefined && typeof read.write !== 'boolean')))
      || (c.waitingFor !== undefined && !['model', 'tool', 'user', 'recovery'].includes(c.waitingFor))
      || (c.sdkStateSize !== undefined && (!Number.isSafeInteger(c.sdkStateSize) || c.sdkStateSize <= 0))
      || !Number.isSafeInteger(c.generation) || c.generation < 0 || !Number.isFinite(c.updatedAt)
      || !['running', 'claimed', 'completed', 'cancelled', 'blocked'].includes(c.status)
      || !c.pendingTools || typeof c.pendingTools !== 'object' || Array.isArray(c.pendingTools)
      || !Array.isArray(c.completedTools) || c.completedTools.some((id: unknown) => typeof id !== 'string')
      || Object.values(c.pendingTools).some((v: any) => !v || typeof v.name !== 'string'
        || !['read-only', 'idempotent', 'file-verifiable', 'unknown'].includes(v.recovery))) return { kind: 'corrupt' }
    return { kind: 'ok', checkpoint: c }
  } catch { return { kind: 'corrupt' } }
}
/** Flush the file before publication; unique temp names never collide with another writer. */
export function writeExecutionCheckpoint(sessionPath: string, checkpoint: ExecutionCheckpoint): void {
  const release = acquireProjectLock(join(sessionPath, 'data', 'execution-checkpoint-lock'))
  try {
    const saved = readExecutionCheckpoint(sessionPath)
    if (saved.kind === 'unsupported' || saved.kind === 'corrupt') throw new Error('Execution checkpoint requires inspection before publication')
    if (saved.kind === 'ok') {
      const previous = saved.checkpoint
      if (previous.sessionId !== checkpoint.sessionId || previous.generation > checkpoint.generation
        || (previous.generation === checkpoint.generation && (previous.userMessageId !== checkpoint.userMessageId
          || !isDeepStrictEqual(previous.taskIdentity, checkpoint.taskIdentity)))) {
        throw new Error('Stale execution checkpoint publication')
      }
      if (previous.generation === checkpoint.generation && previous.status === 'cancelled' && checkpoint.status !== 'cancelled') {
        throw new Error('Cancelled execution checkpoint cannot change state')
      }
      if (previous.generation === checkpoint.generation && previous.status !== 'running'
        && (checkpoint.status === 'running' || (checkpoint.status === 'claimed' && previous.status !== 'claimed'))) {
        throw new Error('Execution checkpoint cannot return to an active state')
      }
    }
    publishCheckpoint(sessionPath, checkpoint)
  } finally { release() }
}

/** Compare and claim under the publication lock. Reclaim requires startup provenance
 * and the caller holding the session execution-owner lock for the entire recovery. */
export function claimExecutionCheckpoint(sessionPath: string, expected: ExecutionCheckpoint, reclaimAfterRestart = false): ExecutionCheckpoint {
  const release = acquireProjectLock(join(sessionPath, 'data', 'execution-checkpoint-lock'))
  try {
    const saved = readExecutionCheckpoint(sessionPath)
    // A UI-only blocking reason does not change the execution identity.
    if (saved.kind !== 'ok' || (saved.checkpoint.status !== 'running' && !(reclaimAfterRestart && saved.checkpoint.status === 'claimed'))
      || !isDeepStrictEqual({ ...saved.checkpoint, reason: undefined }, { ...expected, reason: undefined })) {
      throw new Error('Execution checkpoint changed before recovery claim')
    }
    const claimed: ExecutionCheckpoint = { ...saved.checkpoint, status: 'claimed', reason: undefined, updatedAt: Date.now() }
    publishCheckpoint(sessionPath, claimed)
    return claimed
  } finally { release() }
}

function publishCheckpoint(sessionPath: string, checkpoint: ExecutionCheckpoint): void {
  const dir = join(sessionPath, 'data')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'execution-checkpoint.json')
  const temporary = `${file}.${randomUUID()}.tmp`
  let fd: number | undefined
  try {
    fd = openSync(temporary, 'wx', 0o600)
    writeFileSync(fd, JSON.stringify(checkpoint))
    fsyncSync(fd)
    closeSync(fd); fd = undefined
    renameSync(temporary, file)
  } finally {
    if (fd !== undefined) closeSync(fd)
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}
export function recoveryBlocker(checkpoint: ExecutionCheckpoint, current: {
  sessionId: string; generation: number; userMessageId?: string; sdkSessionId?: string; sdkStateHash?: string; transcriptTailId?: string
  taskIdentity?: ExecutionTaskIdentity; compactionMessageId?: string
  cancelled: boolean; orchestrated: boolean; permissionMode?: string; verifiedToolCalls?: string[]
}): string | undefined {
  if (checkpoint.sessionId !== current.sessionId || checkpoint.userMessageId !== current.userMessageId || checkpoint.generation !== current.generation) return 'turn-changed'
  if (!isDeepStrictEqual(checkpoint.taskIdentity, current.taskIdentity)) return 'turn-changed'
  if (current.cancelled || checkpoint.status === 'cancelled') return 'cancelled'
  if (checkpoint.status !== 'running') return 'already-claimed-or-stopped'
  if (current.orchestrated) return 'coordinator-required'
  if (!checkpoint.sdkSessionId || checkpoint.sdkSessionId !== current.sdkSessionId) return 'sdk-anchor-mismatch'
  if (!checkpoint.sdkStateHash || checkpoint.sdkStateHash !== current.sdkStateHash) return 'sdk-state-mismatch'
  if (checkpoint.transcriptTailId !== current.transcriptTailId) return 'transcript-mismatch'
  if (checkpoint.compactionMessageId !== undefined && checkpoint.compactionMessageId !== current.compactionMessageId) return 'transcript-mismatch'
  // Continue under the current permission mode. Recovered writes are only verified,
  // never replayed; subsequent calls still pass the normal authorization gate.
  if (!['safe', 'ask', 'allow-all'].includes(current.permissionMode ?? '')) return 'authorization-review'
  if (Object.entries(checkpoint.pendingTools).some(([id, t]) => !(t.recovery === 'read-only' && toolRecoveryClass(t.name) === 'read-only')
    && !(t.recovery === 'file-verifiable' && ['Write', 'Edit'].includes(t.name) && current.verifiedToolCalls?.includes(id)))) return 'unknown-tool-result'
  return undefined
}


/** Verify only registered native file operations; names and display text are not proof. */
export function verifiedFileOperations(sessionPath: string, checkpoint: ExecutionCheckpoint): string[] {
  if (!checkpoint.sdkSessionId) return []
  const verified: string[] = []
  for (const [toolCallId, tool] of Object.entries(checkpoint.pendingTools)) {
    if (tool.recovery !== 'file-verifiable' || (tool.name !== 'Write' && tool.name !== 'Edit')) continue
    const identity: ToolFileOperationIdentity = { sessionId: checkpoint.sessionId, sdkSessionId: checkpoint.sdkSessionId,
      answerRunId: checkpoint.answerRunId, toolCallId, toolName: tool.name }
    try {
      const receipt = readToolFileOperation(sessionPath, identity)
      if (receipt && verifyToolFileOperation(receipt, identity)) verified.push(toolCallId)
    } catch { /* Damaged receipts preserve the unknown-outcome blocker. */ }
  }
  return verified
}

/** Recovery may have saved missing tool rows before its checkpoint was published.
 * Accept only those exact receipts, never new user or assistant content. */
export function recoveryTranscriptMatches(sessionPath: string, checkpoint: ExecutionCheckpoint, messages: Message[]): boolean {
  if (messages.at(-1)?.id === checkpoint.transcriptTailId) return true
  const anchor = messages.findIndex(message => message.id === checkpoint.transcriptTailId)
  if (anchor < 0 || !checkpoint.sdkSessionId) return false
  const seen = new Set<string>()
  return messages.slice(anchor + 1).every(message => {
    const id = message.toolUseId
    const pending = id && checkpoint.pendingTools[id]
    if (!id || !pending || seen.has(id) || message.role !== 'tool' || message.toolName !== pending.name
      || message.answerRunId !== checkpoint.answerRunId || message.content !== '') return false
    seen.add(id)
    if (pending.recovery === 'read-only' && toolRecoveryClass(pending.name) === 'read-only') {
      return message.toolResult === INTERRUPTED_READ_RESULT && message.toolStatus === 'error' && message.isError === true
    }
    if (pending.recovery !== 'file-verifiable' || (pending.name !== 'Write' && pending.name !== 'Edit')) return false
    const identity: ToolFileOperationIdentity = { sessionId: checkpoint.sessionId, sdkSessionId: checkpoint.sdkSessionId!,
      answerRunId: checkpoint.answerRunId, toolCallId: id, toolName: pending.name }
    try {
      const receipt = readToolFileOperation(sessionPath, identity)
      return !!receipt && verifyToolFileOperation(receipt, identity) && message.toolResult === recoveredFileOperationText(receipt)
        && message.toolStatus === 'completed' && message.isError === false
    } catch { return false }
  })
}
