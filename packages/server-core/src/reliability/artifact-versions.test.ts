import { createHash } from 'node:crypto'
import { expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactVersions } from './artifact-versions'

test('an existing primary file never borrows an alternative file identity, including a reused relocation path', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-primary-identity-'))
  try {
    const original = join(root, 'report.html'), other = join(root, 'other.html'), moved = join(root, 'moved.html')
    writeFileSync(original, 'same'); writeFileSync(other, 'same'); writeFileSync(moved, 'same')
    const store = new ArtifactVersions(join(root, 'store'), 'host', 'workspace')
    const alternate = store.register(other)
    const primary = store.register(original, undefined, [other])
    expect(primary.id).not.toBe(alternate.id)
    expect(primary.path).not.toBe(alternate.path)
    expect(store.register(original, undefined, [other]).id).toBe(primary.id)
    rmSync(original)
    store.relocate(primary.id, moved, primary.currentVersion)
    writeFileSync(original, 'new file at the old location')
    const replacement = store.register(original, undefined, [moved])
    expect(replacement.id).not.toBe(primary.id)
    expect(store.versionBytes(replacement.id, replacement.currentVersion).toString()).toBe('new file at the old location')
    expect(store.read(primary.id).versions).toHaveLength(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('same-name, same-type and mixed-type files keep independent histories and preview identities after reload', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-multiple-files-'))
  try {
    mkdirSync(join(root, 'a')); mkdirSync(join(root, 'b'))
    const paths = [join(root, 'a', 'report.html'), join(root, 'b', 'report.html'), join(root, 'a', 'report.txt'), join(root, 'a', 'image.png')]
    const originals = [Buffer.from('same'), Buffer.from('same'), Buffer.from('same'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1])]
    const changed = paths.map((_, index) => Buffer.from(`changed-${index}`))
    const storage = join(root, 'store')
    const store = new ArtifactVersions(storage, 'host', 'workspace')
    const first = paths.map((path, index) => { writeFileSync(path, originals[index]!); return store.register(path) })
    expect(new Set(first.map(record => record.id)).size).toBe(paths.length)
    expect(new Set(first.map(record => record.currentVersion)).size).toBe(paths.length)
    expect(new Set(first.slice(0, 3).map(record => record.versions[0]!.hash)).size).toBe(1)
    const alias = join(root, 'alias.html')
    symlinkSync(paths[0]!, alias)
    expect(store.register(alias).id).toBe(first[0]!.id)
    for (const index of [1, 3, 0, 2]) {
      writeFileSync(paths[index]!, changed[index]!)
      store.capture(first[index]!.id, `run-${index}`, `edit-${index}`)
    }
    writeFileSync(paths[0]!, 'third version for file 0')
    store.capture(first[0]!.id)
    const reloaded = new ArtifactVersions(storage, 'host', 'workspace')
    expect(first.map(record => reloaded.read(record.id).versions.length)).toEqual([3, 2, 2, 2])
    for (const [index, record] of first.entries()) {
      expect(reloaded.register(paths[index]!).id).toBe(record.id)
      expect(reloaded.versionBytes(record.id, record.currentVersion)).toEqual(originals[index]!)
      expect(readFileSync(reloaded.preview(record.id, record.currentVersion))).toEqual(originals[index]!)
      const updated = reloaded.read(record.id).versions[1]!
      expect(updated).toMatchObject({ ordinal: 2, sourceRunId: `run-${index}`, summary: `edit-${index}` })
      expect(reloaded.versionBytes(record.id, updated.id)).toEqual(changed[index]!)
      expect(() => reloaded.preview(record.id, first[(index + 1) % first.length]!.currentVersion)).toThrow('not found')
    }
    expect(reloaded.preview(first[0]!.id, first[0]!.currentVersion)).not.toBe(reloaded.preview(first[1]!.id, first[1]!.currentVersion))
    const beforeOtherFiles = paths.slice(1).map(path => readFileSync(path))
    const beforeOtherHistories = first.slice(1).map(record => reloaded.read(record.id))
    const restored = reloaded.restore(first[0]!.id, reloaded.read(first[0]!.id).currentVersion, first[0]!.currentVersion)
    expect(restored.versions).toHaveLength(4)
    expect(readFileSync(paths[0]!)).toEqual(originals[0]!)
    expect(paths.slice(1).map(path => readFileSync(path))).toEqual(beforeOtherFiles)
    expect(first.slice(1).map(record => reloaded.read(record.id))).toEqual(beforeOtherHistories)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('shared content cleanup cannot remove another file snapshot and workspace identities cannot be crossed', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-shared-content-'))
  try {
    const storage = join(root, 'store'), a = join(root, 'a.txt'), b = join(root, 'b.html')
    writeFileSync(a, 'shared'); writeFileSync(b, 'shared')
    const store = new ArtifactVersions(storage, 'host', 'workspace')
    const firstA = store.register(a), firstB = store.register(b)
    writeFileSync(a, 'changed a')
    const secondA = store.capture(firstA.id)
    store.removeVersions(firstA.id, secondA.currentVersion, [firstA.currentVersion])
    expect(store.cleanUnreferencedBlobs()).toEqual({ removed: 0, bytes: 0 })
    expect(store.versionBytes(firstB.id, firstB.currentVersion).toString()).toBe('shared')
    expect(() => new ArtifactVersions(storage, 'host', 'other-workspace').read(firstA.id)).toThrow('invalid artifact record')
    expect(() => new ArtifactVersions(storage, 'other-host', 'workspace').read(firstA.id)).toThrow('invalid artifact record')
    const otherStore = new ArtifactVersions(join(root, 'other-store'), 'host', 'other-workspace')
    const separate = otherStore.register(a)
    expect(separate.id).not.toBe(firstA.id)
    expect(() => otherStore.read(firstA.id)).toThrow()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('missing recovery candidates find only exact stored identities and reject ambiguous artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-missing-candidates-'))
  try {
    const firstPath = join(root, 'one.txt'), secondPath = join(root, 'two.txt')
    writeFileSync(firstPath, 'one'); writeFileSync(secondPath, 'two')
    const store = new ArtifactVersions(join(root, 'store'), 'host', 'workspace')
    const first = store.register(firstPath), second = store.register(secondPath)
    rmSync(firstPath); rmSync(secondPath)
    expect(store.register(join(root, 'missing.txt'), undefined, [firstPath])).toEqual(first)
    expect(() => store.register(firstPath, undefined, [secondPath])).toThrow('ambiguous')
    expect(store.read(second.id)).toEqual(second)
    expect(() => store.register(join(root, 'unregistered.txt'))).toThrow()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('versions preserve content, reject external edits and restore as a new version', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifacts-'))
  try {
    const file = join(root, '报告.txt'), candidate = join(root, 'candidate.txt')
    writeFileSync(file, 'original'); writeFileSync(candidate, 'changed')
    const store = new ArtifactVersions(join(root, 'store'), 'host', 'workspace')
    const first = store.register(file)
    const second = store.apply(first.id, first.currentVersion, candidate)
    expect(readFileSync(file, 'utf8')).toBe('changed')
    expect(store.versionBytes(first.id, first.currentVersion).toString()).toBe('original')
    writeFileSync(file, 'external')
    expect(() => store.restore(first.id, second.currentVersion, first.currentVersion)).toThrow('changed outside')
    expect(readFileSync(file, 'utf8')).toBe('external')
    writeFileSync(file, 'changed')
    const third = store.restore(first.id, second.currentVersion, first.currentVersion)
    expect(third.versions).toHaveLength(3)
    expect(readFileSync(file, 'utf8')).toBe('original')
    expect(third.currentVersion).not.toBe(first.currentVersion)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('reconcile recovers a crash after target replacement without writing over a later external edit', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-crash-'))
  try {
    const file = join(root, 'file.txt'), candidate = join(root, 'next.txt'), storage = join(root, 'store')
    writeFileSync(file, 'before'); writeFileSync(candidate, 'after')
    const store = new ArtifactVersions(storage, 'host', 'workspace')
    const before = store.register(file)
    const after = store.apply(before.id, before.currentVersion, candidate)
    // Emulate power loss between target rename and registry publication.
    writeFileSync(join(storage, `${before.id}.json`), JSON.stringify(before))
    writeFileSync(join(storage, `${before.id}.json.pending`), JSON.stringify({ version: 1, before, after }))
    expect(new ArtifactVersions(storage, 'host', 'workspace').reconcile(before.id).currentVersion).toBe(after.currentVersion)
    writeFileSync(join(storage, `${before.id}.json.pending`), JSON.stringify({ version: 1, before, after }))
    writeFileSync(file, 'external edit after crash')
    expect(() => store.reconcile(before.id)).toThrow('changed outside')
    expect(readFileSync(file, 'utf8')).toBe('external edit after crash')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('relocation preserves identity when the file is opened at its new location', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-relocate-'))
  try {
    const original = join(root, 'original.txt'), moved = join(root, 'moved.txt')
    writeFileSync(original, 'body'); writeFileSync(moved, 'body')
    const store = new ArtifactVersions(join(root, 'store'), 'host', 'workspace')
    const first = store.register(original)
    store.relocate(first.id, moved, first.currentVersion)
    expect(store.register(moved).id).toBe(first.id)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('malformed journal cannot replace a different artifact registry', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-journal-'))
  try {
    const file = join(root, 'file.txt'), storage = join(root, 'store')
    writeFileSync(file, 'body')
    const store = new ArtifactVersions(storage, 'host', 'workspace')
    const before = store.register(file)
    const foreign = { ...before, workspaceId: 'another', path: join(root, 'other.txt') }
    writeFileSync(join(storage, `${before.id}.json.pending`), JSON.stringify({ version: 1, before, after: foreign }))
    expect(() => store.reconcile(before.id)).toThrow()
    expect(store.read(before.id)).toEqual(before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('historical previews preserve the original extension and never replace the current artifact', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-preview-'))
  try {
    const file = join(root, '报告.txt'), candidate = join(root, 'next.txt'), storage = join(root, 'store')
    writeFileSync(file, 'original'); writeFileSync(candidate, 'revised')
    const store = new ArtifactVersions(storage, 'host', 'workspace')
    const initial = store.register(file)
    const updated = store.apply(initial.id, initial.currentVersion, candidate)
    const preview = store.preview(initial.id, initial.currentVersion)
    expect(preview.endsWith('报告.txt')).toBe(true)
    expect(readFileSync(preview, 'utf8')).toBe('original')
    expect(store.preview(initial.id, initial.currentVersion)).toBe(preview)
    chmodSync(preview, 0o600)
    writeFileSync(preview, 'viewer modified copy')
    chmodSync(preview, 0o400)
    const replacement = store.preview(initial.id, initial.currentVersion)
    expect(replacement).not.toBe(preview)
    expect(readFileSync(replacement, 'utf8')).toBe('original')
    expect(readFileSync(preview, 'utf8')).toBe('viewer modified copy')
    expect(readFileSync(file, 'utf8')).toBe('revised')
    expect(store.read(initial.id).currentVersion).toBe(updated.currentVersion)
    writeFileSync(join(storage, 'blobs', initial.versions[0]!.hash), 'corrupted')
    expect(() => store.preview(initial.id, initial.currentVersion)).toThrow('damaged')
    expect(() => store.preview(initial.id, '../../outside')).toThrow()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('relocation cannot assign two artifact identities to one managed path', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-relocate-identity-'))
  try {
    const a = join(root,'a.txt'), b = join(root,'b.txt');writeFileSync(a,'same');writeFileSync(b,'same')
    const store = new ArtifactVersions(join(root,'store'),'host','workspace')
    const first = store.register(a), second = store.register(b)
    expect(() => store.relocate(first.id,b,first.currentVersion)).toThrow('already belongs')
    expect(store.register(b).id).toBe(second.id)
    expect(store.read(first.id).path).toBe(first.path)
  } finally {rmSync(root,{recursive:true,force:true})}
})
test('a candidate changed after validation is not applied', () => {
  const root=mkdtempSync(join(tmpdir(),'artifact-candidate-race-'))
  try {
    const file=join(root,'file.txt'), candidate=join(root,'candidate.txt');writeFileSync(file,'original');writeFileSync(candidate,'validated')
    const store=new ArtifactVersions(join(root,'store'),'host','workspace'), first=store.register(file)
    writeFileSync(candidate,'unvalidated replacement')
    expect(()=>store.apply(first.id,first.currentVersion,candidate,undefined,undefined,createHash('sha256').update('validated').digest('hex'))).toThrow('changed outside')
    expect(readFileSync(file,'utf8')).toBe('original')
    expect(store.read(first.id).versions).toHaveLength(1)
  } finally {rmSync(root,{recursive:true,force:true})}
})

test('a corrupt shared content blob cannot be reused by a new version', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-corrupt-reuse-'))
  try {
    const file = join(root, 'file.txt'), candidate = join(root, 'candidate.txt'), storage = join(root, 'store')
    writeFileSync(file, 'base'); writeFileSync(candidate, 'candidate')
    const store = new ArtifactVersions(storage, 'host', 'workspace')
    const initial = store.register(file)
    const next = store.apply(initial.id, initial.currentVersion, candidate)
    writeFileSync(join(storage, 'blobs', next.versions.at(-1)!.hash), 'corruption')
    expect(() => store.apply(next.id, next.currentVersion, candidate)).toThrow('damaged')
    expect(readFileSync(file, 'utf8')).toBe('candidate')
    expect(store.read(next.id).versions).toHaveLength(2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a missing registered path retains its identity for explicit relocation', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-missing-'))
  try {
    const old = join(root, 'old.txt'), moved = join(root, 'moved.txt')
    writeFileSync(old, 'content')
    const store = new ArtifactVersions(join(root, 'store'), 'host', 'workspace')
    const initial = store.register(old)
    rmSync(old); writeFileSync(moved, 'content')
    expect(store.register(old).id).toBe(initial.id)
    expect(store.relocate(initial.id, moved, initial.currentVersion).currentVersion).toBe(initial.currentVersion)
    expect(store.register(old).id).toBe(initial.id)
    expect(store.register(old).path).toBe(store.read(initial.id).path)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('relocation to different content creates a version without overwriting either file', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-relocate-version-'))
  try {
    const original = join(root, 'original.txt'), chosen = join(root, 'chosen.txt')
    writeFileSync(original, 'original'); writeFileSync(chosen, 'changed')
    const store = new ArtifactVersions(join(root, 'store'), 'host', 'workspace')
    const initial = store.register(original)
    const relocated = store.relocate(initial.id, chosen, initial.currentVersion)
    expect(relocated.id).toBe(initial.id)
    expect(relocated.versions).toHaveLength(2)
    expect(store.versionBytes(initial.id, initial.currentVersion).toString()).toBe('original')
    expect(store.versionBytes(initial.id, relocated.currentVersion).toString()).toBe('changed')
    expect(readFileSync(original, 'utf8')).toBe('original')
    expect(readFileSync(chosen, 'utf8')).toBe('changed')
    expect(() => store.relocate(initial.id, original, initial.currentVersion)).toThrow('changed outside')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('explicit blob cleanup preserves every version and refuses pending application', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-cleanup-'))
  try {
    const file = join(root, 'file.txt'), candidate = join(root, 'candidate.txt'), storage = join(root, 'store')
    writeFileSync(file, 'original'); writeFileSync(candidate, 'updated')
    const store = new ArtifactVersions(storage, 'host', 'workspace')
    const first = store.register(file)
    const second = store.apply(first.id, first.currentVersion, candidate)
    const orphan = Buffer.from('orphan')
    const digest = createHash('sha256').update(orphan).digest('hex')
    writeFileSync(join(storage, 'blobs', digest), orphan)
    writeFileSync(join(storage, `${first.id}.json.pending`), '{}')
    expect(() => store.cleanUnreferencedBlobs()).toThrow('Reconcile')
    expect(readFileSync(join(storage, 'blobs', digest))).toEqual(orphan)
    rmSync(join(storage, `${first.id}.json.pending`))
    expect(store.cleanUnreferencedBlobs()).toEqual({ removed: 1, bytes: orphan.length })
    expect(store.versionBytes(first.id, first.currentVersion).toString()).toBe('original')
    expect(store.versionBytes(first.id, second.currentVersion).toString()).toBe('updated')
    expect(store.cleanUnreferencedBlobs()).toEqual({ removed: 0, bytes: 0 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('version reference ownership survives restart and cannot be silently rebound', () => {
  const root = mkdtempSync(join(tmpdir(), 'version-pins-'))
  try {
    const file = join(root, 'file.txt'), candidate = join(root, 'candidate.txt'), storage = join(root, 'store')
    writeFileSync(file, 'base'); writeFileSync(candidate, 'updated')
    const store = new ArtifactVersions(storage, 'host', 'workspace')
    const base = store.register(file)
    store.pinVersions(base.id, 'feedback:one', [base.currentVersion])
    const updated = store.apply(base.id, base.currentVersion, candidate)
    const restored = new ArtifactVersions(storage, 'host', 'workspace')
    expect(restored.protectedVersionIds(base.id).sort()).toEqual([base.currentVersion, updated.currentVersion].sort())
    expect(() => restored.pinVersions(base.id, 'feedback:one', [updated.currentVersion])).toThrow('different versions')
    restored.pinVersions(base.id, 'feedback:one', [base.currentVersion])
    restored.releaseVersions(base.id, 'feedback:one')
    expect(restored.protectedVersionIds(base.id)).toEqual([updated.currentVersion])
    restored.releaseVersions(base.id, 'feedback:one')
    expect(() => restored.pinVersions(base.id, 'other', ['missing'])).toThrow('does not exist')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('applied feedback result remains protected after a later version replaces it', () => {
  const root = mkdtempSync(join(tmpdir(), 'result-pins-'))
  try {
    const file = join(root, 'file.txt'), candidate = join(root, 'candidate.txt'), storage = join(root, 'store')
    writeFileSync(file, 'base'); writeFileSync(candidate, 'feedback result')
    const store = new ArtifactVersions(storage, 'host', 'workspace')
    const base = store.register(file)
    const result = store.apply(base.id, base.currentVersion, candidate, 'feedback-run', undefined, undefined, 'feedback-result:one')
    writeFileSync(candidate, 'later edit')
    const latest = store.apply(base.id, result.currentVersion, candidate)
    const reloaded = new ArtifactVersions(storage, 'host', 'workspace')
    expect(reloaded.protectedVersionIds(base.id).sort()).toEqual([result.currentVersion, latest.currentVersion].sort())
    expect(() => reloaded.apply(base.id, latest.currentVersion, candidate, undefined, undefined, undefined, 'feedback-result:one')).toThrow('already has')
    expect(reloaded.read(base.id).currentVersion).toBe(latest.currentVersion)
    reloaded.releaseVersions(base.id, 'feedback-result:one')
    expect(reloaded.protectedVersionIds(base.id)).toEqual([latest.currentVersion])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('explicit history removal enforces references, expected version and restores', () => {
  const root = mkdtempSync(join(tmpdir(), 'version-removal-'))
  try {
    const file = join(root, 'file.txt'), candidate = join(root, 'candidate.txt'), storage = join(root, 'store')
    writeFileSync(file, 'base'); writeFileSync(candidate, 'updated')
    const store = new ArtifactVersions(storage, 'host', 'workspace')
    const base = store.register(file)
    const second = store.apply(base.id, base.currentVersion, candidate)
    store.pinVersions(base.id, 'feedback', [base.currentVersion])
    expect(() => store.removeVersions(base.id, second.currentVersion, [base.currentVersion])).toThrow('referenced')
    expect(() => store.removeVersions(base.id, second.currentVersion, [second.currentVersion])).toThrow('current')
    store.releaseVersions(base.id, 'feedback')
    expect(() => store.removeVersions(base.id, base.currentVersion, [base.currentVersion])).toThrow('changed')
    const restored = store.restore(base.id, second.currentVersion, base.currentVersion)
    expect(() => store.removeVersions(base.id, restored.currentVersion, [base.currentVersion])).toThrow('referenced')
    const result = store.removeVersions(base.id, restored.currentVersion, [second.currentVersion])
    expect(result.versions.map(version => version.id)).toEqual([base.currentVersion, restored.currentVersion])
    expect(readFileSync(file, 'utf8')).toBe('base')
    expect(store.cleanUnreferencedBlobs().removed).toBe(1)
    expect(store.versionBytes(base.id, base.currentVersion).toString()).toBe('base')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('cleanup retries survive reload and later edits without deleting another version', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-cleanup-retry-'))
  try {
    const file = join(root, 'file.txt'), candidate = join(root, 'candidate.txt'), storage = join(root, 'store')
    writeFileSync(file, 'first'); writeFileSync(candidate, 'second')
    const store = new ArtifactVersions(storage, 'host', 'workspace')
    const first = store.register(file)
    const second = store.apply(first.id, first.currentVersion, candidate)
    store.removeVersions(first.id, second.currentVersion, [first.currentVersion], [], 'request-1')
    writeFileSync(candidate, 'third')
    const third = store.apply(first.id, second.currentVersion, candidate)
    const reloaded = new ArtifactVersions(storage, 'host', 'workspace')
    expect(reloaded.removeVersions(first.id, second.currentVersion, [first.currentVersion], [], 'request-1')).toEqual(third)
    expect(() => reloaded.removeVersions(first.id, third.currentVersion, [second.currentVersion], [], 'request-1')).toThrow('different versions')
    expect(reloaded.read(first.id).versions).toHaveLength(2)
    expect(readFileSync(file, 'utf8')).toBe('third')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('history cleanup preserves ordinal gaps and assigns legacy ordinals without rewriting reads', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-ordinals-'))
  try {
    const file = join(root, 'file.txt'), candidate = join(root, 'candidate.txt'), storage = join(root, 'store')
    writeFileSync(file, 'first'); writeFileSync(candidate, 'second')
    const store = new ArtifactVersions(storage, 'host', 'workspace')
    const first = store.register(file)
    const second = store.apply(first.id, first.currentVersion, candidate)
    const recordPath = join(storage, `${first.id}.json`)
    const legacy = { ...second, versions: second.versions.map(({ ordinal, ...version }) => version) }
    writeFileSync(recordPath, JSON.stringify(legacy))
    expect(store.read(first.id).versions.map(v => v.ordinal)).toEqual([1, 2])
    expect(JSON.parse(readFileSync(recordPath, 'utf8'))).toEqual(legacy)
    store.removeVersions(first.id, second.currentVersion, [first.currentVersion], [], 'remove-first')
    writeFileSync(candidate, 'third')
    const third = store.apply(first.id, second.currentVersion, candidate)
    expect(third.versions.map(v => v.ordinal)).toEqual([2, 3])
    expect(new ArtifactVersions(storage, 'host', 'workspace').read(first.id).versions.map(v => v.ordinal)).toEqual([2, 3])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('explicit preview cleanup preserves retained versions and external symlink targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-preview-cleanup-'))
  try {
    const file = join(root, 'file.txt'), candidate = join(root, 'candidate.txt'), storage = join(root, 'store')
    writeFileSync(file, 'old'); writeFileSync(candidate, 'new')
    const store = new ArtifactVersions(storage, 'host', 'workspace')
    const first = store.register(file)
    const oldPreview = store.preview(first.id, first.currentVersion)
    const second = store.apply(first.id, first.currentVersion, candidate)
    const currentPreview = store.preview(first.id, second.currentVersion)
    store.cleanRemovedPreviews(first.id, [first.currentVersion])
    expect(readFileSync(oldPreview, 'utf8')).toBe('old')
    const external = join(root, 'external.txt')
    writeFileSync(external, 'external')
    symlinkSync(external, join(storage, 'previews', first.id, first.currentVersion, 'external-link'))
    store.removeVersions(first.id, second.currentVersion, [first.currentVersion], [], 'delete')
    store.cleanRemovedPreviews(first.id, [first.currentVersion, second.currentVersion])
    expect(() => readFileSync(oldPreview)).toThrow()
    expect(readFileSync(external, 'utf8')).toBe('external')
    expect(readFileSync(currentPreview, 'utf8')).toBe('new')
    expect(() => store.preview(first.id, first.currentVersion)).toThrow('not found')
    expect(readFileSync(file, 'utf8')).toBe('new')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('recovery rejects invalid version ordering before publishing a journal', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-order-journal-'))
  try {
    const file = join(root, 'file.txt'), candidate = join(root, 'candidate.txt'), storage = join(root, 'store')
    writeFileSync(file, 'before'); writeFileSync(candidate, 'after')
    const store = new ArtifactVersions(storage, 'host', 'workspace')
    const before = store.register(file)
    const after = store.apply(before.id, before.currentVersion, candidate)
    after.versions[1]!.ordinal = after.versions[0]!.ordinal
    writeFileSync(join(storage, `${before.id}.json`), JSON.stringify(before))
    writeFileSync(join(storage, `${before.id}.json.pending`), JSON.stringify({ version: 1, before, after }))
    expect(() => store.reconcile(before.id)).toThrow('version order')
    expect(store.read(before.id)).toEqual(before)
    expect(readFileSync(file, 'utf8')).toBe('after')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
