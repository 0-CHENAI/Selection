import { acquireProjectLock } from './project-lock'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

export interface ArtifactVersion { ordinal?: number; id: string; hash: string; size: number; createdAt: number; sourceRunId?: string; restoredFrom?: string; summary?: string; summaryOrigin?: 'assistant' }
export interface ArtifactRecord { version: 1; id: string; hostId: string; workspaceId: string; path: string; currentVersion: string; versions: ArtifactVersion[]; previousPaths?: string[]; fileIdentity?: string; cleanupRequests?: Record<string, { expectedVersion: string; versionIds: string[] }>; lastRestore?: { versionId: string; sourceRunId?: string } }
export class ArtifactConflict extends Error { constructor() { super('Artifact changed outside this operation; candidate retained.'); this.name = 'ArtifactConflict' } }
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const validId = (id: string) => { if (!/^[a-f0-9-]+$/.test(id)) throw new Error('Invalid artifact identifier'); return id }
function fileIdentity(path: string): string | undefined {
  try {
    const stat = statSync(path, { bigint: true })
    // Birth time makes a reused inode distinct while surviving rename and edits.
    return stat.ino === 0n || stat.birthtimeNs <= 0n ? undefined : `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`
  } catch { return undefined }
}
function withFileIdentity(record: ArtifactRecord): ArtifactRecord {
  if (!existsSync(record.path)) return record
  const identity = fileIdentity(record.path)
  return identity ? { ...record, fileIdentity: identity } : record
}
function isCurrentFile(record: ArtifactRecord): boolean {
  return !record.fileIdentity || fileIdentity(record.path) === record.fileIdentity
}
export function canonicalLocation(path: string): string {
  try { return realpathSync(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    let ancestor = resolve(path)
    const missing: string[] = []
    while (!existsSync(ancestor)) {
      const parent = dirname(ancestor)
      if (parent === ancestor) throw error
      missing.unshift(basename(ancestor)); ancestor = parent
    }
    return join(realpathSync(ancestor), ...missing)
  }
}
/** Windows short and long names can refer to the same file while realpath keeps different spellings. */
export function sameArtifactLocation(left: string, right: string): boolean {
  if (left === right) return true
  try {
    const a = statSync(left, { bigint: true }), b = statSync(right, { bigint: true })
    if (a.ino !== 0n && a.ino === b.ino && a.dev === b.dev) return true
  } catch { /* Missing files still need path comparison for deletion history. */ }
  return canonicalLocation(left) === canonicalLocation(right)
}
export function atomicWrite(path: string, data: string | Buffer, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  let fd: number | undefined
  try { fd = openSync(temp, 'wx', mode); writeFileSync(fd, data); fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(temp, path) }
  finally { if (fd !== undefined) closeSync(fd); if (existsSync(temp)) unlinkSync(temp) }
}
/** Called only after the host's existing file-access authorization. */
export class ArtifactVersions {
  constructor(private root: string, private hostId: string, private workspaceId: string) { mkdirSync(root, { recursive: true }) }
  private recordPath(id: string) { return join(this.root, `${validId(id)}.json`) }
  private blobPath(digest: string) { if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid hash'); return join(this.root, 'blobs', digest) }
  private snapshot(path: string): { bytes: Buffer; digest: string } {
    if (lstatSync(path).isSymbolicLink() || !statSync(path).isFile()) throw new Error('Only regular files can be versioned')
    const bytes = readFileSync(path); return { bytes, digest: hash(bytes) }
  }
  private put(bytes: Buffer): string {
    const digest = hash(bytes), path = this.blobPath(digest)
    if (!existsSync(path)) atomicWrite(path, bytes)
    else if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || hash(readFileSync(path)) !== digest) throw new Error('Artifact version blob is damaged')
    return digest
  }
  register(path: string, sourceRunId?: string, alternativePaths: string[] = [], summary?: string, summaryOrigin?: 'assistant'): ArtifactRecord {
    const release = acquireProjectLock(join(this.root, 'locks', 'registry'))
    try { return this.registerUnlocked(path, sourceRunId, alternativePaths, summary, summaryOrigin) } finally { release() }
  }
  private registerUnlocked(path: string, sourceRunId?: string, alternativePaths: string[] = [], summary?: string, summaryOrigin?: 'assistant'): ArtifactRecord {
    const canonical = canonicalLocation(path)
    // A live primary path is authoritative. Alternatives only recover missing links.
    const candidates = existsSync(canonical) ? [canonical] : [canonical, ...alternativePaths.map(canonicalLocation)]
    const existing = this.findRegistered(candidates)
    if (existing) {
      this.reconcileLocked(existing.id, true)
      return this.locked(existing.id, () => {
        const record = this.read(existing.id)
        if (existsSync(record.path) && !isCurrentFile(record)) throw new ArtifactConflict()
        const refreshed = withFileIdentity(record)
        if (record.fileIdentity !== refreshed.fileIdentity) atomicWrite(this.recordPath(record.id), JSON.stringify(refreshed))
        return refreshed
      }, true)
    }
    const identity = fileIdentity(canonical)
    if (identity) {
      const moved = readdirSync(this.root).filter(name => /^[a-f0-9-]+\.json$/.test(name))
        .map(name => this.read(name.slice(0, -5)))
        .filter(record => !isCurrentFile(record) && record.fileIdentity === identity)
      if (moved.length > 1) throw new Error('Artifact move is ambiguous')
      if (moved.length === 1) {
        const record = moved[0]!
        const relocated = this.locked(record.id, () => {
          if (fileIdentity(canonical) !== record.fileIdentity || isCurrentFile(record)) return undefined
          const relocated = withFileIdentity({ ...record, path: canonical,
            previousPaths: [...new Set([...(record.previousPaths ?? []), record.path])] })
          atomicWrite(this.recordPath(record.id), JSON.stringify(relocated))
          return relocated
        }, true)
        if (relocated) return relocated
      }
    }
    const id = randomUUID()
    const { bytes } = this.snapshot(canonical)
    const first: ArtifactVersion = { ordinal: 1, id: randomUUID(), hash: this.put(bytes), size: bytes.length, createdAt: Date.now(), sourceRunId, summary,
      ...(summaryOrigin ? { summaryOrigin } : {}) }
    const record: ArtifactRecord = withFileIdentity({ version: 1, id, hostId: this.hostId, workspaceId: this.workspaceId, path: canonical, currentVersion: first.id, versions: [first] })
    atomicWrite(this.recordPath(id), JSON.stringify(record)); return record
  }
  /** Exact recorded paths and missing historical aliases only, never filenames. */
  findByPath(path: string): ArtifactRecord | undefined {
    const record = this.findRegistered([canonicalLocation(path)])
    if (record && existsSync(`${this.recordPath(record.id)}.pending`)) throw new Error('Artifact update requires recovery before opening')
    return record
  }
  findByVersionId(versionId: string): ArtifactRecord | undefined {
    validId(versionId)
    for (const entry of readdirSync(this.root)) {
      if (!/^[a-f0-9-]+\.json$/.test(entry)) continue
      const record = this.read(entry.slice(0, -5))
      if (record.versions.some(version => version.id === versionId)) return record
    }
    return undefined
  }
  /** Follow a plain rename in the recorded directory without equating identical copies. */
  refreshMovedRecord(id: string): ArtifactRecord {
    const record = this.read(id)
    if (isCurrentFile(record)) return record
    const directory = dirname(record.path)
    if (!existsSync(directory)) return record
    const matches = readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => join(directory, entry.name))
      .filter(path => fileIdentity(path) === record.fileIdentity)
    if (matches.length > 1) throw new Error('Artifact move is ambiguous')
    return matches.length ? this.register(matches[0]!) : record
  }
  private findRegistered(candidates: string[]): ArtifactRecord | undefined {
    const matches: ArtifactRecord[] = []
    for (const entry of readdirSync(this.root)) {
      if (!/^[a-f0-9-]+\.json$/.test(entry)) continue
      const existing = this.read(entry.slice(0, -5))
      if (candidates.some(canonical => (sameArtifactLocation(existing.path, canonical)
        && (!existsSync(canonical) || !existing.fileIdentity || fileIdentity(canonical) === existing.fileIdentity))
        || (!existsSync(canonical) && existing.previousPaths?.includes(canonical)))) matches.push(existing)
    }
    if (matches.length > 1) throw new Error('Artifact path is ambiguous; choose its exact original location')
    return matches[0]
  }
  private validateRecord(record: ArtifactRecord, id: string): void {
    if (!record || record.version !== 1 || record.id !== id || record.hostId !== this.hostId || record.workspaceId !== this.workspaceId
      || typeof record.path !== 'string' || record.previousPaths !== undefined && (!Array.isArray(record.previousPaths) || record.previousPaths.some(path => typeof path !== 'string'))
      || record.fileIdentity !== undefined && (typeof record.fileIdentity !== 'string' || !/^\d+:\d+:\d+$/.test(record.fileIdentity))
      || !Array.isArray(record.versions) || record.versions.length === 0
      || !record.versions.some(v => v.id === record.currentVersion)
      || new Set(record.versions.map(v => v.id)).size !== record.versions.length
      || record.lastRestore !== undefined && (!record.lastRestore || !record.versions.some(v => v.id === record.lastRestore!.versionId)
        || record.lastRestore.sourceRunId !== undefined && typeof record.lastRestore.sourceRunId !== 'string')
      || record.versions.some(v => !v || typeof v.id !== 'string' || !/^[a-f0-9]{64}$/.test(v.hash)
        || v.summary !== undefined && typeof v.summary !== 'string'
        || v.summaryOrigin !== undefined && v.summaryOrigin !== 'assistant'
        || !Number.isSafeInteger(v.size) || v.size < 0 || !Number.isFinite(v.createdAt))) throw new Error('Unsupported or invalid artifact record')
    let ordinal = 0
    for (const version of record.versions) {
      const next = version.ordinal ?? ordinal + 1
      if (!Number.isSafeInteger(next) || next <= ordinal) throw new Error('Invalid artifact version order')
      ordinal = next
    }
    if (record.cleanupRequests !== undefined && (!record.cleanupRequests || typeof record.cleanupRequests !== 'object'
      || Array.isArray(record.cleanupRequests) || Object.entries(record.cleanupRequests).some(([requestId, receipt]) =>
        !requestId.trim() || !receipt || typeof receipt.expectedVersion !== 'string'
        || !Array.isArray(receipt.versionIds) || !receipt.versionIds.length
        || receipt.versionIds.some(versionId => typeof versionId !== 'string' || !/^[a-f0-9-]+$/.test(versionId))
        || new Set(receipt.versionIds).size !== receipt.versionIds.length))) throw new Error('Invalid cleanup receipt')
  }
  read(id: string): ArtifactRecord {
    const record = JSON.parse(readFileSync(this.recordPath(id), 'utf8')) as ArtifactRecord
    this.validateRecord(record, id)
    // Assign legacy ordinals in memory; ordinary reads never rewrite history.
    let lastOrdinal = 0
    record.versions = record.versions.map(version => {
      const ordinal = version.ordinal ?? lastOrdinal + 1
      if (!Number.isSafeInteger(ordinal) || ordinal <= lastOrdinal) throw new Error('Invalid artifact version order')
      lastOrdinal = ordinal
      return { ...version, ordinal }
    })
    return record
  }
  hasCurrentFile(id: string): boolean {
    const record = this.read(id)
    return existsSync(record.path) && isCurrentFile(record)
  }
  /** Resolve historical message references without trusting the link text or current path. */
  versionSourceRunIds(versionIds: readonly string[]): Map<string, string | undefined> {
    const wanted = new Set(versionIds)
    const found = new Map<string, string | undefined>()
    if (!wanted.size) return found
    for (const entry of readdirSync(this.root)) {
      if (!/^[a-f0-9-]+\.json$/.test(entry)) continue
      for (const version of this.read(entry.slice(0, -5)).versions) {
        if (wanted.has(version.id)) found.set(version.id, version.sourceRunId)
      }
      if (found.size === wanted.size) break
    }
    return found
  }
  versionArtifactIds(versionIds: readonly string[]): Map<string, string> {
    const wanted = new Set(versionIds)
    const found = new Map<string, string>()
    if (!wanted.size) return found
    for (const entry of readdirSync(this.root)) {
      if (!/^[a-f0-9-]+\.json$/.test(entry)) continue
      const record = this.read(entry.slice(0, -5))
      for (const version of record.versions) if (wanted.has(version.id)) found.set(version.id, record.id)
      if (found.size === wanted.size) break
    }
    return found
  }
  /** Record settled file bytes without modifying the file or creating duplicate versions. */
  capture(id: string, sourceRunId?: string, summary?: string, summaryOrigin?: 'assistant'): ArtifactRecord {
    return this.locked(id, () => {
      if (existsSync(`${this.recordPath(id)}.pending`)) throw new Error('Reconcile interrupted applications before recording versions')
      const record = this.read(id)
      const snapshot = this.snapshot(record.path)
      if (snapshot.digest === record.versions.find(version => version.id === record.currentVersion)!.hash) {
        const refreshed = withFileIdentity(record)
        if (refreshed.fileIdentity !== record.fileIdentity) atomicWrite(this.recordPath(id), JSON.stringify(refreshed))
        return refreshed
      }
      const next: ArtifactVersion = { ordinal: record.versions.at(-1)!.ordinal! + 1, id: randomUUID(),
        hash: this.put(snapshot.bytes), size: snapshot.bytes.length, createdAt: Date.now(), sourceRunId, summary,
        ...(summaryOrigin ? { summaryOrigin } : {}) }
      const after = withFileIdentity({ ...record, currentVersion: next.id, versions: [...record.versions, next] })
      delete after.lastRestore
      atomicWrite(this.recordPath(id), JSON.stringify(after))
      return after
    })
  }
  versionBytes(id: string, versionId: string): Buffer {
    const version = this.read(id).versions.find(v => v.id === versionId)
    if (!version) throw new Error('Artifact version not found')
    const bytes = readFileSync(this.blobPath(version.hash))
    if (hash(bytes) !== version.hash) throw new Error('Artifact snapshot is damaged')
    return bytes
  }
  private references(id: string): Record<string, string[]> {
    const path = `${this.recordPath(id)}.references`
    if (!existsSync(path)) return {}
    const value = JSON.parse(readFileSync(path, 'utf8')) as { version: number; references: Record<string, string[]> }
    if (value?.version !== 1 || !value.references || typeof value.references !== 'object' || Array.isArray(value.references)
      || Object.values(value.references).some(ids => !Array.isArray(ids) || ids.some(versionId => typeof versionId !== 'string' || !/^[a-f0-9-]+$/.test(versionId)))) {
      throw new Error('Invalid artifact reference record')
    }
    return value.references
  }
  /** Runtime ownership, persisted independently from historical version records. */
  pinVersions(id: string, owner: string, versionIds: string[]): void {
    if (!owner || !versionIds.length) throw new Error('Version reference requires an owner and versions')
    this.locked(id, () => {
      const record = this.read(id)
      const ids = [...new Set(versionIds)].sort()
      if (ids.some(versionId => !record.versions.some(version => version.id === versionId))) throw new Error('Referenced version does not exist')
      const references = this.references(id)
      if (Object.hasOwn(references, owner) && JSON.stringify(references[owner]) !== JSON.stringify(ids)) throw new Error('Version reference owner already has different versions')
      atomicWrite(`${this.recordPath(id)}.references`, JSON.stringify({ version: 1, references: { ...references, [owner]: ids } }))
    })
  }
  releaseVersions(id: string, owner: string): void {
    this.locked(id, () => {
      this.read(id)
      const references = this.references(id)
      delete references[owner]
      atomicWrite(`${this.recordPath(id)}.references`, JSON.stringify({ version: 1, references }))
    })
  }
  protectedVersionIds(id: string): string[] {
    return this.locked(id, () => {
      const record = this.read(id)
      return [...new Set([record.currentVersion, ...Object.values(this.references(id)).flat(),
        ...record.versions.flatMap(version => version.restoredFrom ? [version.restoredFrom] : [])])]
    })
  }
  /** Remove explicit history entries only; blob collection is a separate step. */
  removeVersions(id: string, expectedVersion: string, versionIds: string[], runtimeProtected: readonly string[] = [], requestId?: string): ArtifactRecord {
    return this.locked(id, () => {
      const record = this.read(id)
      const selected = [...new Set(versionIds)].sort()
      if (requestId !== undefined) {
        if (!requestId.trim()) throw new Error('Cleanup requires a request identifier')
        const previous = record.cleanupRequests?.[requestId]
        if (previous && Object.hasOwn(record.cleanupRequests!, requestId)) {
          if (previous.expectedVersion !== expectedVersion || JSON.stringify(previous.versionIds) !== JSON.stringify(selected)) {
            throw new Error('Cleanup request already has different versions')
          }
          return record
        }
      }
      if (record.currentVersion !== expectedVersion) throw new ArtifactConflict()
      if (existsSync(`${this.recordPath(id)}.pending`)) throw new Error('Reconcile interrupted applications before removing versions')
      const removed = new Set(versionIds)
      if (!removed.size || versionIds.some(versionId => !record.versions.some(version => version.id === versionId))) throw new Error('Select existing versions to remove')
      const protectedIds = new Set([record.currentVersion, ...runtimeProtected, ...Object.values(this.references(id)).flat(),
        ...record.versions.flatMap(version => version.restoredFrom ? [version.restoredFrom] : [])])
      if ([...removed].some(versionId => protectedIds.has(versionId))) throw new Error('Selected version is current or still referenced')
      const next: ArtifactRecord = { ...record, versions: record.versions.filter(version => !removed.has(version.id)) }
      // The deletion and receipt share one atomic publication, so a lost RPC
      // response cannot turn a successful retry into another mutation.
      if (requestId !== undefined) next.cleanupRequests = { ...record.cleanupRequests,
        [requestId]: { expectedVersion, versionIds: selected } }
      atomicWrite(this.recordPath(id), JSON.stringify(next))
      return next
    })
  }
  /** Materialize a verified copy with its original extension for existing previewers. */
  preview(id: string, versionId: string): string {
    return this.locked(id, () => {
    const record = this.read(id)
    const bytes = this.versionBytes(id, versionId)
    const directory = join(this.root, 'previews', validId(id), validId(versionId))
    let target = join(directory, basename(record.path))
    // Windows cannot replace a readonly/open preview. Reuse verified bytes; if
    // altered, create a fresh copy without touching a viewer's existing file.
    if (existsSync(target)) {
      if (lstatSync(target).isFile() && !lstatSync(target).isSymbolicLink() && hash(readFileSync(target)) === hash(bytes)) return target
      target = join(directory, randomUUID(), basename(record.path))
    }
    atomicWrite(target, bytes, 0o400)
    return target
    })
  }
  /** Remove previews only for explicitly deleted versions of this artifact. */
  cleanRemovedPreviews(id: string, versionIds: readonly string[]): void {
    this.locked(id, () => {
      const record = this.read(id)
      const root = join(this.root, 'previews')
      const directory = join(root, validId(id))
      for (const path of [root, directory]) {
        if (!existsSync(path)) return
        const info = lstatSync(path)
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid preview storage directory')
      }
      for (const versionId of new Set(versionIds)) {
        if (record.versions.some(version => version.id === versionId)) continue
        // rm does not traverse symlinks inside the removed tree. An occupied
        // Windows preview may fail here; the caller can retry the same request.
        rmSync(join(directory, validId(versionId)), { recursive: true, force: true })
      }
    })
  }
  private locked<T>(id: string, action: () => T, registryHeld = false): T {
    const releaseRegistry = registryHeld ? () => {} : acquireProjectLock(join(this.root, 'locks', 'registry'))
    try {
      const release = acquireProjectLock(join(this.root, 'locks', validId(id)))
      try { return action() } finally { release() }
    } finally { releaseRegistry() }
  }

  /** Explicit maintenance only. Referenced versions are never aged out. */
  cleanUnreferencedBlobs(): { removed: number; bytes: number } {
    const release = acquireProjectLock(join(this.root, 'locks', 'registry'))
    try {
      const entries = readdirSync(this.root)
      if (entries.some(name => name.endsWith('.json.pending'))) throw new Error('Reconcile interrupted applications before cleaning storage')
      const protectedHashes = new Set(entries.filter(name => /^[a-f0-9-]+\.json$/.test(name))
        .flatMap(name => this.read(name.slice(0, -5)).versions.map(version => version.hash)))
      const directory = join(this.root, 'blobs')
      if (!existsSync(directory)) return { removed: 0, bytes: 0 }
      const candidates = readdirSync(directory).filter(name => /^[a-f0-9]{64}$/.test(name) && !protectedHashes.has(name))
        .map(name => ({ path: this.blobPath(name), stat: lstatSync(this.blobPath(name)) }))
      if (candidates.some(file => !file.stat.isFile() || file.stat.isSymbolicLink())) throw new Error('Invalid blob storage entry')
      let bytes = 0
      for (const candidate of candidates) { unlinkSync(candidate.path); bytes += candidate.stat.size }
      return { removed: candidates.length, bytes }
    } finally { release() }
  }

  /** Validation belongs to the caller; arbitrary model claims are not validation evidence. */
  apply(id: string, expectedVersion: string, candidatePath: string, sourceRunId?: string, restoredFrom?: string, expectedCandidateHash?: string, referenceOwner?: string): ArtifactRecord {
    return this.locked(id, () => {
      const record = this.read(id)
      const pendingPath = `${this.recordPath(id)}.pending`
      if (existsSync(pendingPath)) throw new Error('An interrupted apply must be reconciled first')
      const base = record.versions.find(v => v.id === expectedVersion)
      if (!base || record.currentVersion !== expectedVersion || !isCurrentFile(record)
        || this.snapshot(record.path).digest !== base.hash) throw new ArtifactConflict()
      const candidate = this.snapshot(candidatePath)
      if (expectedCandidateHash !== undefined && candidate.digest !== expectedCandidateHash) throw new ArtifactConflict()
      const next: ArtifactVersion = { ordinal: record.versions.at(-1)!.ordinal! + 1, id: randomUUID(), hash: this.put(candidate.bytes), size: candidate.bytes.length, createdAt: Date.now(), sourceRunId, restoredFrom }
      const after = { ...record, currentVersion: next.id, versions: [...record.versions, next] }
      delete after.lastRestore
      if (referenceOwner !== undefined) {
        if (!referenceOwner) throw new Error('Version reference requires an owner')
        const references = this.references(id)
        if (Object.hasOwn(references, referenceOwner)) throw new Error('Version reference owner already has an applied result')
        // Pin before publishing the apply journal or replacing the target.
        // Interrupted writes may leave an extra conservative pin, never an
        // unprotected result that a cleanup could remove during recovery.
        atomicWrite(`${this.recordPath(id)}.references`, JSON.stringify({ version: 1, references: { ...references, [referenceOwner]: [next.id] } }))
      }
      atomicWrite(pendingPath, JSON.stringify({ version: 1, before: record, after }))
      // Revalidate immediately before the atomic replacement; preserve external edits on conflict.
      if (!isCurrentFile(record) || this.snapshot(record.path).digest !== base.hash) { unlinkSync(pendingPath); throw new ArtifactConflict() }
      atomicWrite(record.path, candidate.bytes, statSync(record.path).mode & 0o777)
      const published = withFileIdentity(after)
      atomicWrite(this.recordPath(id), JSON.stringify(published))
      unlinkSync(pendingPath)
      return published
    })
  }
  reconcile(id: string): ArtifactRecord { return this.reconcileLocked(id, false) }
  private reconcileLocked(id: string, registryHeld: boolean): ArtifactRecord {
    return this.locked(id, () => {
    const path = `${this.recordPath(id)}.pending`
    if (!existsSync(path)) return this.read(id)
    const journal = JSON.parse(readFileSync(path, 'utf8')) as { version: number; operation?: 'restore'; before: ArtifactRecord; after: ArtifactRecord }
    if (journal.version !== 1) throw new Error('Invalid apply journal')
    this.validateRecord(journal.before, id)
    this.validateRecord(journal.after, id)
    const registered = this.read(id)
    const sameHistory = JSON.stringify(journal.after.versions) === JSON.stringify(journal.before.versions)
    const validTransition = journal.operation === 'restore'
      ? sameHistory && journal.after.currentVersion !== journal.before.currentVersion
        && journal.after.lastRestore?.versionId === journal.after.currentVersion
      : journal.operation === undefined && journal.after.versions.length === journal.before.versions.length + 1
        && JSON.stringify(journal.after.versions.slice(0, -1)) === JSON.stringify(journal.before.versions)
    if (journal.before.path !== registered.path || journal.after.path !== registered.path
      || !validTransition
      || ![journal.before.currentVersion, journal.after.currentVersion].includes(registered.currentVersion)) throw new Error('Apply journal identity or version mismatch')
    const actual = this.snapshot(journal.before.path).digest
    const beforeHash = journal.before.versions.find(v => v.id === journal.before.currentVersion)?.hash
    const afterHash = journal.after.versions.find(v => v.id === journal.after.currentVersion)?.hash
    const recovered = actual === afterHash ? journal.after : actual === beforeHash ? journal.before : undefined
    if (!recovered) throw new ArtifactConflict()
    const refreshed = withFileIdentity(recovered)
    atomicWrite(this.recordPath(id), JSON.stringify(refreshed)); unlinkSync(path)
    return refreshed
    }, registryHeld)
  }
  restore(id: string, expectedVersion: string, versionId: string, sourceRunId?: string): ArtifactRecord {
    return this.locked(id, () => {
      const record = this.read(id)
      const pendingPath = `${this.recordPath(id)}.pending`
      if (existsSync(pendingPath)) throw new Error('An interrupted restore must be reconciled first')
      const current = record.versions.find(version => version.id === expectedVersion)
      const target = record.versions.find(version => version.id === versionId)
      if (!target) throw new Error('Artifact version not found')
      if (!current || record.currentVersion !== expectedVersion || !isCurrentFile(record)
        || this.snapshot(record.path).digest !== current.hash) throw new ArtifactConflict()
      if (versionId === expectedVersion) throw new Error('Select a previous version to restore')
      const bytes = this.versionBytes(id, versionId)
      const after: ArtifactRecord = { ...record, currentVersion: versionId,
        lastRestore: { versionId, ...(sourceRunId ? { sourceRunId } : {}) } }
      atomicWrite(pendingPath, JSON.stringify({ version: 1, operation: 'restore', before: record, after }))
      if (!isCurrentFile(record) || this.snapshot(record.path).digest !== current.hash) { unlinkSync(pendingPath); throw new ArtifactConflict() }
      atomicWrite(record.path, bytes, statSync(record.path).mode & 0o777)
      const published = withFileIdentity(after)
      atomicWrite(this.recordPath(id), JSON.stringify(published))
      unlinkSync(pendingPath)
      return published
    })
  }
  relocate(id: string, path: string, expectedVersion: string): ArtifactRecord {
    const release = acquireProjectLock(join(this.root, 'locks', 'registry'))
    try { return this.locked(id, () => {
    const record = this.read(id), canonical = realpathSync(path)
    if (record.currentVersion !== expectedVersion) throw new ArtifactConflict()
    if (existsSync(`${this.recordPath(id)}.pending`)) throw new Error('Reconcile the interrupted apply before relocating')
    for (const name of readdirSync(this.root)) {
      if (!/^[a-f0-9-]+\.json$/.test(name) || name === `${id}.json`) continue
      if (this.read(name.slice(0, -5)).path === canonical) throw new Error('This location already belongs to another managed artifact')
    }
    const current = record.versions.find(v => v.id === record.currentVersion)!
    const snapshot = this.snapshot(canonical)
    const next = snapshot.digest === current.hash ? undefined : { ordinal: record.versions.at(-1)!.ordinal! + 1, id: randomUUID(), hash: this.put(snapshot.bytes), size: snapshot.bytes.length, createdAt: Date.now() }
    const relocated: ArtifactRecord = withFileIdentity({ ...record, path: canonical, previousPaths: [...new Set([...(record.previousPaths ?? []), record.path])], currentVersion: next?.id ?? record.currentVersion,
      versions: next ? [...record.versions, next] : record.versions })
    delete relocated.lastRestore
    atomicWrite(this.recordPath(id), JSON.stringify(relocated)); return relocated
    }, true) } finally { release() }
  }
}
