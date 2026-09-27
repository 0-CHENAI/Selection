import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { atomicWrite, ArtifactConflict } from './artifact-versions'
import { inside } from './isolated-workspace'
import { acquireProjectLock } from './project-lock'

export interface IntegrationChange { path: string; expectedHash: string | null; content: Buffer | null }
interface Entry { path: string; before: string | null; after: string | null; mode: number }
interface Journal { version: 1; id: string; root: string; status: 'applying' | 'applied' | 'rolling-back' | 'rolled-back'; entries: Entry[] }
const active = new Set<string>()
const digest = (bytes: Buffer | null) => bytes === null ? null : createHash('sha256').update(bytes).digest('hex')
const decode = (value: string | null) => value === null ? null : Buffer.from(value, 'base64')
const equal = (a: Buffer | null, b: Buffer | null) => digest(a) === digest(b)

/** One host owns a project's writes. Persistent journals prevent a new transaction after a crash. */
export class ProjectIntegration {
  private root: string
  private journalPath: string
  constructor(root: string, storage: string) {
    this.root = realpathSync(root)
    if (inside(this.root, resolve(storage))) throw new Error('Integration records must be outside the target project')
    this.journalPath = join(storage, createHash('sha256').update(this.root).digest('hex'), 'integration.json')
  }
  private target(path: string): string {
    const target = resolve(this.root, path)
    if (!inside(this.root, target) || target === this.root) throw new Error('Integration path is outside the project')
    let ancestor = target
    while (!existsSync(ancestor)) {
      if (lstatSafe(ancestor)) throw new Error('Broken symbolic link in integration path')
      ancestor = dirname(ancestor)
    }
    if (!inside(this.root, realpathSync(ancestor)) || lstatSync(ancestor).isSymbolicLink()) throw new Error('Integration path escapes through a symbolic link')
    return target
  }
  private bytes(path: string): Buffer | null {
    const target = this.target(path)
    if (!existsSync(target)) return null
    if (!lstatSync(target).isFile()) throw new Error('Integration target is not a regular file')
    return readFileSync(target)
  }
  private locked<T>(action: () => T): T {
    if (active.has(this.root)) throw new Error('Project integration is already active')
    active.add(this.root)
    let release: (() => void) | undefined
    try { release = acquireProjectLock(dirname(this.journalPath)); return action() }
    finally { release?.(); active.delete(this.root) }
  }
  private save(journal: Journal) {
    const serialized = JSON.stringify(journal)
    // Keep earlier backups after the current transaction pointer moves forward.
    atomicWrite(join(dirname(this.journalPath), 'transactions', `${journal.id}.json`), serialized)
    atomicWrite(this.journalPath, serialized)
  }
  private load(path = this.journalPath): Journal | undefined {
    if (!existsSync(path)) return undefined
    const journal = JSON.parse(readFileSync(path, 'utf8')) as Journal
    if (journal.version !== 1 || journal.root !== this.root || typeof journal.id !== 'string' || !/^[a-f0-9-]+$/.test(journal.id)
      || !['applying', 'applied', 'rolling-back', 'rolled-back'].includes(journal.status)
      || !Array.isArray(journal.entries) || new Set(journal.entries.map(e => e.path)).size !== journal.entries.length
      || journal.entries.some(e => !e || typeof e.path !== 'string' || !Number.isInteger(e.mode) || e.mode < 0 || e.mode > 0o777
        || ![e.before, e.after].every(v => v === null || typeof v === 'string' && Buffer.from(v, 'base64').toString('base64') === v))) throw new Error('Invalid integration journal')
    const targets = journal.entries.map(entry => this.target(entry.path))
    if (new Set(targets).size !== targets.length) throw new Error('Duplicate integration journal target')
    return journal
  }
  private write(entry: Entry, content: Buffer | null) {
    const target = this.target(entry.path)
    if (content === null) { if (existsSync(target)) unlinkSync(target) }
    else atomicWrite(target, content, entry.mode)
  }
  apply(changes: IntegrationChange[], afterWrite?: (index: number) => void, onPrepared?: (transactionId: string) => void): string {
    return this.locked(() => {
      const pending = this.load()
      if (pending && !['applied', 'rolled-back'].includes(pending.status)) throw new Error('Recover the interrupted integration first')
      const paths = changes.map(change => this.target(change.path))
      if (new Set(paths).size !== paths.length) throw new Error('Duplicate integration target')
      const entries = changes.map((change, index): Entry => {
        const before = this.bytes(change.path)
        if (digest(before) !== change.expectedHash) throw new ArtifactConflict()
        return { path: paths[index]!, before: before?.toString('base64') ?? null, after: change.content?.toString('base64') ?? null,
          mode: before === null ? 0o600 : lstatSync(paths[index]!).mode & 0o777 }
      })
      const journal: Journal = { version: 1, id: randomUUID(), root: this.root, status: 'applying', entries }
      this.save(journal)
      onPrepared?.(journal.id)
      for (const [index, entry] of entries.entries()) {
        if (!equal(this.bytes(entry.path), decode(entry.before))) throw new ArtifactConflict()
        this.write(entry, decode(entry.after)); afterWrite?.(index)
      }
      journal.status = 'applied'; this.save(journal)
      return journal.id
    })
  }
  recover(action: 'complete' | 'rollback', expectedTransactionId?: string): void {
    this.locked(() => {
      const journal = this.load()
      if (expectedTransactionId && journal?.id !== expectedTransactionId) {
        // A later integration may have advanced the pointer before delivery was acknowledged.
        // Only acknowledge completed archives; never replay old writes over a newer transaction.
        const archived = /^[a-f0-9-]+$/.test(expectedTransactionId)
          ? this.load(join(dirname(this.journalPath), 'transactions', `${expectedTransactionId}.json`)) : undefined
        if (action === 'complete' && archived?.id === expectedTransactionId && archived.status === 'applied'
          && (!journal || ['applied', 'rolled-back'].includes(journal.status))) return
        throw new Error('Integration transaction identity changed')
      }
      if (!journal || journal.status === 'rolled-back' || journal.status === 'applied') return
      // Check ALL targets before writing any: external edits must survive recovery.
      for (const entry of journal.entries) {
        const actual = this.bytes(entry.path)
        if (!equal(actual, decode(entry.before)) && !equal(actual, decode(entry.after))) throw new ArtifactConflict()
      }
      const rollback = action === 'rollback' || journal.status === 'rolling-back'
      journal.status = rollback ? 'rolling-back' : 'applying'; this.save(journal)
      for (const entry of journal.entries) {
        const actual = this.bytes(entry.path)
        if (!equal(actual, decode(entry.before)) && !equal(actual, decode(entry.after))) throw new ArtifactConflict()
        this.write(entry, decode(rollback ? entry.before : entry.after))
      }
      journal.status = rollback ? 'rolled-back' : 'applied'; this.save(journal)
    })
  }
}
function lstatSafe(path: string): boolean {
  try { lstatSync(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
