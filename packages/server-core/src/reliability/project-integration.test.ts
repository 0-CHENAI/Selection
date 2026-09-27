import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectIntegration } from './project-integration'
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'integration-')), project = join(root, 'project'), storage = join(root, 'storage')
  mkdirSync(project); writeFileSync(join(project, 'a'), 'a'); writeFileSync(join(project, 'b'), 'b')
  return { root, project, storage, changes: [{ path: 'a', expectedHash: hash('a'), content: Buffer.from('A') }, { path: 'b', expectedHash: hash('b'), content: Buffer.from('B') }] }
}
test('a completed transaction can be acknowledged after the current pointer advances without replaying writes', () => {
  const f = fixture()
  try {
    const store = new ProjectIntegration(f.project, f.storage)
    const first = store.apply([f.changes[0]!])
    const second = store.apply([f.changes[1]!])
    // Delivery replay remains responsible for checking output hashes; recovery must not restore them.
    writeFileSync(join(f.project, 'a'), 'external')
    const journalPath = join(f.storage, hash(realpathSync(f.project)), 'integration.json')
    const before = readFileSync(journalPath, 'utf8')
    new ProjectIntegration(f.project, f.storage).recover('complete', first)
    expect(readFileSync(join(f.project, 'a'), 'utf8')).toBe('external')
    expect(readFileSync(join(f.project, 'b'), 'utf8')).toBe('B')
    expect(readFileSync(journalPath, 'utf8')).toBe(before)
    expect(JSON.parse(before).id).toBe(second)
    expect(() => store.recover('rollback', first)).toThrow('identity changed')
    expect(() => store.recover('complete', '../integration')).toThrow('identity changed')
    expect(() => store.apply([{ path: 'b', expectedHash: hash('B'), content: Buffer.from('C') }], undefined, () => {
      throw new Error('crash before writes')
    })).toThrow('crash before writes')
    expect(() => store.recover('complete', first)).toThrow('identity changed')
    expect(readFileSync(join(f.project, 'b'), 'utf8')).toBe('B')
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
for (const action of ['complete', 'rollback'] as const) test(`restart can ${action} a partially applied transaction`, () => {
  const f = fixture()
  try {
    const store = new ProjectIntegration(f.project, f.storage)
    expect(() => store.apply(f.changes, () => { throw new Error('crash') })).toThrow('crash')
    expect(() => store.apply(f.changes)).toThrow('Recover')
    new ProjectIntegration(f.project, f.storage).recover(action)
    expect(readFileSync(join(f.project, 'a'), 'utf8')).toBe(action === 'complete' ? 'A' : 'a')
    expect(readFileSync(join(f.project, 'b'), 'utf8')).toBe(action === 'complete' ? 'B' : 'b')
    new ProjectIntegration(f.project, f.storage).recover(action)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
test('external edits block recovery without overwriting any file', () => {
  const f = fixture()
  try {
    const store = new ProjectIntegration(f.project, f.storage)
    expect(() => store.apply(f.changes, () => { throw new Error('crash') })).toThrow()
    writeFileSync(join(f.project, 'b'), 'external')
    expect(() => store.recover('rollback')).toThrow('changed outside')
    expect(readFileSync(join(f.project, 'a'), 'utf8')).toBe('A')
    expect(readFileSync(join(f.project, 'b'), 'utf8')).toBe('external')
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
test('path aliases, escape paths and same-project concurrent integration are refused', () => {
  const f = fixture()
  try {
    const store = new ProjectIntegration(f.project, f.storage)
    expect(() => store.apply([f.changes[0]!, { ...f.changes[0]!, path: './a' }])).toThrow('Duplicate')
    expect(() => store.apply([{ path: '../outside', expectedHash: null, content: Buffer.from('no') }])).toThrow('outside')
    store.apply(f.changes, () => { expect(() => new ProjectIntegration(f.project, f.storage).apply([])).toThrow('already active') })
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
test('an actual writer process exit after the first replacement recovers from disk', async () => {
  const { spawnSync } = await import('node:child_process')
  const f = fixture()
  try {
    const modulePath = new URL('./project-integration.ts', import.meta.url).pathname
    const script = `import { ProjectIntegration } from ${JSON.stringify(modulePath)}; new ProjectIntegration(${JSON.stringify(f.project)}, ${JSON.stringify(f.storage)}).apply([{path:'a',expectedHash:${JSON.stringify(hash('a'))},content:Buffer.from('A')},{path:'b',expectedHash:${JSON.stringify(hash('b'))},content:Buffer.from('B')}], () => process.exit(73));`
    expect(spawnSync(process.execPath, ['--eval', script]).status).toBe(73)
    const restarted = new ProjectIntegration(f.project, f.storage)
    restarted.recover('complete')
    expect(readFileSync(join(f.project, 'a'), 'utf8')).toBe('A')
    expect(readFileSync(join(f.project, 'b'), 'utf8')).toBe('B')
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('recovery rejects another transaction identity and aliased journal targets before writing', () => {
  const f = fixture()
  try {
    const store = new ProjectIntegration(f.project, f.storage)
    expect(() => store.apply(f.changes, () => { throw new Error('crash') })).toThrow('crash')
    const journalPath = join(f.storage, hash(realpathSync(f.project)), 'integration.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
    expect(() => store.recover('complete', 'different-operation')).toThrow('identity changed')
    expect(readFileSync(join(f.project, 'b'), 'utf8')).toBe('b')
    journal.entries.push({ ...journal.entries[0], path: realpathSync(f.project) + '/./a' })
    writeFileSync(journalPath, JSON.stringify(journal))
    expect(() => store.recover('complete', journal.id)).toThrow('Duplicate integration journal target')
    expect(readFileSync(join(f.project, 'b'), 'utf8')).toBe('b')
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('prepared identity is durable before target writes and resumes the same transaction', () => {
  const f = fixture()
  try {
    let preparedId = ''
    const store = new ProjectIntegration(f.project, f.storage)
    expect(() => store.apply(f.changes, undefined, id => {
      preparedId = id
      expect(readFileSync(join(f.project, 'a'), 'utf8')).toBe('a')
      throw new Error('receipt persistence interrupted')
    })).toThrow('receipt persistence interrupted')
    expect(preparedId.length).toBeGreaterThan(0)
    expect(readFileSync(join(f.project, 'b'), 'utf8')).toBe('b')
    new ProjectIntegration(f.project, f.storage).recover('complete', preparedId)
    expect(readFileSync(join(f.project, 'a'), 'utf8')).toBe('A')
    expect(readFileSync(join(f.project, 'b'), 'utf8')).toBe('B')
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
