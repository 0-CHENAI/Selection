import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FeedbackStore, assertFeedbackAnchor } from './feedback-store'
test('feedback is idempotent and rejects stale or ambiguous selections', () => {
  const root = mkdtempSync(join(tmpdir(), 'feedback-'))
  try {
    const store = new FeedbackStore(root), input = { sessionId: 's', artifactId: 'a', baseVersion: 'v', instruction: 'change' }
    const first = store.create('request', input)
    expect(first.created).toBe(true)
    expect(store.create('request', input)).toEqual({ record: first.record, created: false })
    expect(() => store.create('request', { ...input, instruction: 'different' })).toThrow()
    const bytes = Buffer.from('正文内容'), anchor = { hash: createHash('sha256').update(bytes).digest('hex'), start: 0, end: 2, text: '正文' }
    expect(() => assertFeedbackAnchor(bytes, anchor)).not.toThrow()
    expect(() => assertFeedbackAnchor(Buffer.from('新的正文'), anchor)).toThrow('stale')
    expect(() => assertFeedbackAnchor(bytes, { ...anchor, start: 1 })).toThrow('stale')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('history survives store recreation and is scoped to both session and artifact', () => {
  const root = mkdtempSync(join(tmpdir(), 'feedback-history-'))
  try {
    const store = new FeedbackStore(root)
    const input = { sessionId: 's', artifactId: 'a', baseVersion: 'v', instruction: 'change' }
    const first = store.create('one', input).record
    first.status = 'applied'; first.appliedVersion = 'v2'; store.save(first)
    store.create('other-session', { ...input, sessionId: 'other' })
    store.create('other-artifact', { ...input, artifactId: 'other' })
    const restored = new FeedbackStore(root).list('s', 'a')
    expect(restored).toEqual([first])
    expect(new FeedbackStore(root).list('missing', 'a')).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a competing writer cannot claim the same feedback request', async () => {
  const { acquireProjectLock } = await import('./project-lock')
  const { spawnSync } = await import('node:child_process')
  const root = mkdtempSync(join(tmpdir(), 'feedback-claim-'))
  const input = { sessionId: 's', artifactId: 'a', baseVersion: 'v', instruction: 'change' }
  const id = createHash('sha256').update('s\0request').digest('hex')
  const release = acquireProjectLock(join(root, 'locks', id))
  try {
    const modulePath = new URL('./feedback-store.ts', import.meta.url).pathname
    const script = `import { FeedbackStore } from ${JSON.stringify(modulePath)}; try { new FeedbackStore(${JSON.stringify(root)}).create('request', ${JSON.stringify(input)}); process.exit(2) } catch { process.exit(0) }`
    expect(spawnSync(process.execPath, ['--eval', script]).status).toBe(0)
    release()
    const first = new FeedbackStore(root).create('request', input)
    expect(first.created).toBe(true)
    expect(new FeedbackStore(root).create('request', input)).toEqual({ record: first.record, created: false })
  } finally { release(); rmSync(root, { recursive: true, force: true }) }
})

test('feedback retry preserves the declared validation inputs across reload', () => {
  const root = mkdtempSync(join(tmpdir(), 'feedback-inputs-'))
  try {
    const input = { sessionId: 's', artifactId: 'a', baseVersion: 'v', instruction: 'change', validationInputs: ['package.json', 'check.ts'] }
    const created = new FeedbackStore(root).create('request', input).record
    expect(new FeedbackStore(root).read(created.id).validationInputs).toEqual(input.validationInputs)
    expect(new FeedbackStore(root).create('request', input).created).toBe(false)
    expect(() => new FeedbackStore(root).create('request', { ...input, validationInputs: ['package.json'] })).toThrow('different feedback')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('legacy unresolved feedback protects base and result versions across sessions', () => {
  const root = mkdtempSync(join(tmpdir(), 'feedback-retention-'))
  try {
    const store = new FeedbackStore(root)
    const first = store.create('one', { sessionId: 's', artifactId: 'a', baseVersion: 'base', instruction: 'change' }).record
    first.status = 'applied'; first.appliedVersion = 'result'; store.save(first)
    const other = store.create('two', { sessionId: 'other', artifactId: 'a', baseVersion: 'other-base', instruction: 'change' }).record
    other.status = 'cancelled'; store.save(other)
    expect(store.protectedVersions('a').sort()).toEqual(['base', 'result', 'other-base'].sort())
    first.userResolved = true; store.save(first)
    expect(store.protectedVersions('a')).toEqual(['other-base'])
    expect(store.protectedVersions('unrelated')).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('stale validation cannot overwrite cancellation or apply a candidate', () => {
  const root = mkdtempSync(join(tmpdir(), 'feedback-cas-'))
  try {
    const store = new FeedbackStore(root)
    const record = store.create('request', { sessionId: 's', artifactId: 'a', baseVersion: 'v', instruction: 'change' }).record
    const stale = new FeedbackStore(root).read(record.id)
    record.status = 'cancelled'; store.save(record)
    let applied = false
    stale.status = 'applied'
    expect(() => store.save(stale, () => { applied = true })).toThrow('changed')
    expect(applied).toBe(false)
    expect(store.read(record.id)).toEqual(record)
    expect(stale.revision).toBe(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('candidate application holds the feedback lock until its receipt is published', () => {
  const root = mkdtempSync(join(tmpdir(), 'feedback-apply-lock-'))
  try {
    const store = new FeedbackStore(root)
    const record = store.create('request', { sessionId: 's', artifactId: 'a', baseVersion: 'v', instruction: 'change' }).record
    store.save(record, () => {
      const competing = new FeedbackStore(root).read(record.id)
      competing.status = 'cancelled'
      expect(() => new FeedbackStore(root).save(competing)).toThrow('already active')
      record.status = 'applied'; record.appliedVersion = 'result'
    })
    expect(store.read(record.id).status).toBe('applied')
    expect(record.revision).toBe(2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('legacy feedback gains a revision only when updated', async () => {
  const { writeFileSync, readFileSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'feedback-legacy-cas-'))
  try {
    const store = new FeedbackStore(root)
    const record = store.create('request', { sessionId: 's', artifactId: 'a', baseVersion: 'v', instruction: 'change' }).record
    delete record.revision
    const file = join(root, `${record.id}.json`)
    writeFileSync(file, JSON.stringify(record))
    const legacy = store.read(record.id)
    expect(legacy.revision).toBeUndefined()
    expect(JSON.parse(readFileSync(file, 'utf8')).revision).toBeUndefined()
    legacy.status = 'running'; store.save(legacy)
    expect(store.read(record.id).revision).toBe(1)
    expect(() => store.save(record)).toThrow('changed')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('invalid persisted resolution flags cannot release protected artifact versions', async () => {
  const { writeFileSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'feedback-invalid-resolution-'))
  try {
    const store = new FeedbackStore(root)
    const record = store.create('request', { sessionId: 's', artifactId: 'a', baseVersion: 'v', instruction: 'change' }).record
    for (const patch of [{ userResolved: 'false' }, { userResolved: 1 }, { childSessionId: {} }, { appliedVersion: 4 }, { error: [] }]) {
      writeFileSync(join(root, `${record.id}.json`), JSON.stringify({ ...record, status: 'failed', ...patch }))
      expect(() => store.read(record.id)).toThrow('invalid feedback')
      expect(() => store.protectedVersions('a')).toThrow('invalid feedback')
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
