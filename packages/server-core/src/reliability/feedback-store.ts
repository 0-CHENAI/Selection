import { isDeepStrictEqual } from 'node:util'
import { acquireProjectLock, ProjectLockBusyError } from './project-lock'
import { atomicWrite } from './artifact-versions'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface FeedbackRecord {
  revision?: number
  version: 1; id: string; sessionId: string; artifactId: string; baseVersion: string; instruction: string
  validationInputs?: string[]
  anchor?: { hash: string; start: number; end: number; text: string }
  status: 'queued' | 'running' | 'validating' | 'applied' | 'conflict' | 'failed' | 'cancelled'
  createdAt: number; updatedAt: number; childSessionId?: string; appliedVersion?: string
  validation?: string[]; error?: string; userResolved?: boolean
}
export function assertFeedbackAnchor(bytes: Buffer, anchor: NonNullable<FeedbackRecord['anchor']>): void {
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (createHash('sha256').update(bytes).digest('hex') !== anchor.hash || !Number.isInteger(anchor.start)
    || !Number.isInteger(anchor.end) || anchor.start < 0 || anchor.end <= anchor.start || anchor.end > content.length
    || content.slice(anchor.start, anchor.end) !== anchor.text) throw new Error('Feedback selection is stale; select the target again')
}
export class FeedbackStore {
  constructor(private root: string) { mkdirSync(root, { recursive: true }) }
  claimExecution(id: string): () => void {
    this.path(id)
    return acquireProjectLock(join(this.root, 'executions', id))
  }
  tryClaimExecution(id: string): (() => void) | undefined {
    try { return this.claimExecution(id) }
    catch (error) { if (error instanceof ProjectLockBusyError) return undefined; throw error }
  }
  protectedVersions(artifactId: string): string[] {
    const versions = new Set<string>()
    for (const name of readdirSync(this.root).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const record = this.read(name.slice(0, -5))
      if (record.artifactId !== artifactId) continue
      if (record.userResolved && !['queued', 'running', 'validating'].includes(record.status)) continue
      versions.add(record.baseVersion)
      if (record.appliedVersion) versions.add(record.appliedVersion)
    }
    return [...versions]
  }
  list(sessionId: string, artifactId: string): FeedbackRecord[] {
    return readdirSync(this.root).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
      .map(name => this.read(name.slice(0, -5)))
      .filter(record => record.sessionId === sessionId && record.artifactId === artifactId)
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
  }
  private path(id: string) { if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid feedback identity'); return join(this.root, `${id}.json`) }
  create(requestId: string, input: Pick<FeedbackRecord, 'sessionId' | 'artifactId' | 'baseVersion' | 'instruction' | 'anchor' | 'validationInputs'>): { record: FeedbackRecord; created: boolean } {
    const id = createHash('sha256').update(`${input.sessionId}\0${requestId}`).digest('hex')
    const release = acquireProjectLock(join(this.root, 'locks', id))
    try {
      const existing = this.findRequest(requestId, input)
      if (existing) return { record: existing, created: false }
      const record: FeedbackRecord = { ...input, version: 1, revision: 1, id, status: 'queued', createdAt: Date.now(), updatedAt: Date.now() }
      atomicWrite(this.path(id), JSON.stringify(record)); return { record, created: true }
    } finally { release() }
  }
  /** Resolve retries before checking the mutable target version. */
  findRequest(requestId: string, input: Pick<FeedbackRecord, 'sessionId' | 'artifactId' | 'baseVersion' | 'instruction' | 'anchor' | 'validationInputs'>): FeedbackRecord | undefined {
    if (!requestId || !input.instruction.trim()) throw new Error('Request identity and feedback are required')
    const id = createHash('sha256').update(`${input.sessionId}\0${requestId}`).digest('hex')
    if (existsSync(this.path(id))) {
      const record = this.read(id)
      if (record.artifactId !== input.artifactId || record.baseVersion !== input.baseVersion || record.instruction !== input.instruction
        || JSON.stringify(record.validationInputs ?? []) !== JSON.stringify(input.validationInputs ?? [])
        || JSON.stringify(record.anchor) !== JSON.stringify(input.anchor)) throw new Error('Request identity was already used for different feedback')
      return record
    }
    return undefined
  }
  read(id: string): FeedbackRecord {
    const record = JSON.parse(readFileSync(this.path(id), 'utf8')) as FeedbackRecord
    if (!record || record.version !== 1 || record.id !== id
      || record.revision !== undefined && (!Number.isSafeInteger(record.revision) || record.revision < 1)
      || ![record.sessionId, record.artifactId, record.baseVersion, record.instruction].every(value => typeof value === 'string' && value.length > 0)
      || !['queued','running','validating','applied','conflict','failed','cancelled'].includes(record.status)
      || !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)
      || record.userResolved !== undefined && typeof record.userResolved !== 'boolean'
      || [record.childSessionId, record.appliedVersion, record.error].some(value => value !== undefined && typeof value !== 'string')
      || record.validationInputs !== undefined && (!Array.isArray(record.validationInputs) || record.validationInputs.some(value => typeof value !== 'string' || !value))
      || record.validation !== undefined && (!Array.isArray(record.validation) || record.validation.some(value => typeof value !== 'string'))
      || record.anchor !== undefined && (!record.anchor || typeof record.anchor.hash !== 'string' || !/^[a-f0-9]{64}$/.test(record.anchor.hash)
        || !Number.isSafeInteger(record.anchor.start) || !Number.isSafeInteger(record.anchor.end)
        || record.anchor.start < 0 || record.anchor.end <= record.anchor.start || typeof record.anchor.text !== 'string')) throw new Error('Unsupported or invalid feedback record')
    return record
  }
  /** Publish only the revision read by this writer; optional synchronous application shares the lock. */
  save(record: FeedbackRecord, apply?: () => void): void {
    const release = acquireProjectLock(join(this.root, 'locks', record.id))
    try {
      const previous = this.read(record.id)
      if ((previous.revision ?? 0) !== (record.revision ?? 0)) throw new Error('Feedback changed; reload before updating')
      if (previous.sessionId !== record.sessionId || previous.artifactId !== record.artifactId
        || previous.baseVersion !== record.baseVersion || previous.instruction !== record.instruction
        || previous.createdAt !== record.createdAt || !isDeepStrictEqual(previous.anchor, record.anchor)
        || !isDeepStrictEqual(previous.validationInputs, record.validationInputs)) {
        throw new Error('Feedback identity cannot change')
      }
      apply?.()
      const next = { ...record, revision: (previous.revision ?? 0) + 1, updatedAt: Date.now() }
      atomicWrite(this.path(record.id), JSON.stringify(next))
      Object.assign(record, next)
    } finally { release() }
  }
}
