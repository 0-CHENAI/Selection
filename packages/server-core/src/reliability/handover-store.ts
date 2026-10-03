import type { HandoverRecord, HandoverSnapshot } from '@craft-agent/shared/protocol'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWrite } from './artifact-versions'
import { acquireProjectLock, ProjectLockBusyError } from './project-lock'

export const handoverHash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
export class HandoverStore {
  constructor(readonly root: string, readonly workspaceId: string) { mkdirSync(root, { recursive: true }) }
  directory(id: string): string {
    if (!/^[a-zA-Z0-9-]{1,120}$/.test(id)) throw new Error('Invalid handover identity')
    return join(this.root, handoverHash(id))
  }
  claim(id: string): () => void { return acquireProjectLock(join(this.directory(id), 'lock')) }
  tryClaim(id: string): (() => void) | undefined {
    try { return this.claim(id) }
    catch (error) { if (error instanceof ProjectLockBusyError) return undefined; throw error }
  }
  read(id: string): HandoverRecord | undefined {
    const file = join(this.directory(id), 'record.json')
    if (!existsSync(file)) return undefined
    const record = JSON.parse(readFileSync(file, 'utf8')) as HandoverRecord
    if (record?.version !== 1 || record.handoverId !== id || record.workspaceId !== this.workspaceId
      || record.snapshotVersion !== 1 || !['NORM', 'PRO'].includes(record.targetMode)
      || !['waiting', 'prepared', 'created', 'applied', 'cancelled'].includes(record.status)
      || typeof record.sourceSessionId !== 'string' || !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)
      || record.targetSessionId !== undefined && typeof record.targetSessionId !== 'string'
      || !record.reviews || typeof record.reviews !== 'object' || Array.isArray(record.reviews)
      || Object.values(record.reviews).some(review => !['completed', 'not-performed'].includes(review?.outcome) || typeof review.note !== 'string')) throw new Error('Invalid handover record')
    if (record.creationConfig && (typeof record.creationConfig !== 'object' || Array.isArray(record.creationConfig)
      || Object.keys(record.creationConfig).some(key => !['model', 'llmConnection'].includes(key))
      || Object.values(record.creationConfig).some(value => typeof value !== 'string'))) throw new Error('Invalid handover creation configuration')
    if (record.snapshot) {
      this.validateSnapshot(record.snapshot)
      if (record.snapshot.source.sessionId !== record.sourceSessionId || record.snapshot.targetMode !== record.targetMode) throw new Error('Handover snapshot owner mismatch')
    }
    if (Object.entries(record.reviews).some(([ref, review]) => !record.snapshot?.actions.some(action => action.ref === ref && action.outcome === 'unknown') || !review.note.trim())) throw new Error('Invalid handover operation review')
    if (['prepared', 'created', 'applied'].includes(record.status) && (!record.snapshot || !record.targetSessionId)) throw new Error('Incomplete handover receipt')
    return record
  }
  save(record: HandoverRecord): void {
    const previous = this.read(record.handoverId)
    if (previous && (previous.sourceSessionId !== record.sourceSessionId || previous.targetMode !== record.targetMode
      || previous.targetSessionId && previous.targetSessionId !== record.targetSessionId
      || previous.snapshot && JSON.stringify(previous.snapshot) !== JSON.stringify(record.snapshot)
      || previous.snapshot && JSON.stringify(previous.creationConfig) !== JSON.stringify(record.creationConfig)
      || previous.createdAt !== record.createdAt
      || Object.entries(previous.reviews).some(([ref, review]) => JSON.stringify(review) !== JSON.stringify(record.reviews[ref])))) throw new Error('A committed handover snapshot cannot change; create a new handover')
    const transitions = { waiting: ['waiting', 'prepared', 'cancelled'], prepared: ['prepared', 'created'], created: ['created', 'applied'], applied: ['applied'], cancelled: ['cancelled'] }
    if (previous && !transitions[previous.status].includes(record.status)) throw new Error('Invalid handover receipt transition')
    record.updatedAt = Date.now()
    atomicWrite(join(this.directory(record.handoverId), 'record.json'), JSON.stringify(record))
  }
  list(sessionId: string): HandoverRecord[] {
    return readdirSync(this.root).filter(name => /^[a-f0-9]{64}$/.test(name)).flatMap(name => {
      const file = join(this.root, name, 'record.json')
      if (!existsSync(file)) return []
      const id = JSON.parse(readFileSync(file, 'utf8')).handoverId
      if (handoverHash(id) !== name) throw new Error('Handover storage identity mismatch')
      const record = this.read(id)!
      return record.sourceSessionId === sessionId || record.targetSessionId === sessionId ? [record] : []
    }).sort((a, b) => b.createdAt - a.createdAt)
  }
  snapshotBytes(id: string, path: string, expectedHash: string): Buffer {
    if (!/^files\/[a-f0-9]{64}(\.[a-zA-Z0-9]{1,12})?$/.test(path)) throw new Error('Invalid handover file reference')
    const bytes = readFileSync(join(this.directory(id), path))
    if (handoverHash(bytes) !== expectedHash) throw new Error('Handover snapshot integrity check failed')
    return bytes
  }
  private validateSnapshot(snapshot: HandoverSnapshot): void {
    if (snapshot.version !== 1 || !['NORM','PRO'].includes(snapshot.targetMode) || !Number.isFinite(snapshot.capturedAt) || snapshot.source?.workspaceId !== this.workspaceId || typeof snapshot.source.sessionId !== 'string'
      || typeof snapshot.source.checkpoint !== 'string' || !Array.isArray(snapshot.files) || !Array.isArray(snapshot.actions)
      || snapshot.files.some(file => typeof file.originalPath !== 'string' || !/^files\/[a-f0-9]{64}(\.[a-zA-Z0-9]{1,12})?$/.test(file.snapshotPath)
        || file.sourceUrl !== undefined && (typeof file.sourceUrl !== 'string' || !/^https?:\/\//.test(file.sourceUrl) || file.sourceUrl !== file.originalPath)
        || file.urlPrompt !== undefined && typeof file.urlPrompt !== 'string'
        || !/^[a-f0-9]{64}$/.test(file.hash) || !/^[a-f0-9]{64}$/.test(file.originalHash))
      || snapshot.actions.some(action => !['completed', 'unknown', 'not-performed'].includes(action.outcome) || typeof action.ref !== 'string'
        || action.requestHash !== undefined && !/^[a-f0-9]{64}$/.test(action.requestHash))
      || ['goal','acceptance','constraints','decisions','scopeAndPriority','openQuestions','nextSteps','warnings'].some(key => {
        const value = snapshot[key as keyof HandoverSnapshot]; return !Array.isArray(value) || value.some(item => typeof item !== 'string')
      }) || !Array.isArray(snapshot.originals) || !Array.isArray(snapshot.claims) || !Array.isArray(snapshot.runs) || !Array.isArray(snapshot.taskList)) throw new Error('Invalid handover snapshot')
  }
}
