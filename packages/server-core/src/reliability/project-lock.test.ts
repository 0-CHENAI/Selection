import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireProjectLock } from './project-lock'
test('a second process cannot acquire a project held by a live writer', () => {
  const root = mkdtempSync(join(tmpdir(), 'project-lock-'))
  const release = acquireProjectLock(root)
  try {
    const script = `import { acquireProjectLock } from ${JSON.stringify(new URL('./project-lock.ts', import.meta.url).pathname)}; try { acquireProjectLock(${JSON.stringify(root)}); process.exit(1) } catch (e) { process.stdout.write(e.message) }`
    const child = spawnSync(process.execPath, ['--eval', script], { encoding: 'utf8' })
    expect(child.status).toBe(0)
    expect(child.stdout).toContain('already active')
  } finally { release(); rmSync(root, { recursive: true, force: true }) }
})
test('incomplete lock metadata cannot silently authorize a second writer', () => {
  const root = mkdtempSync(join(tmpdir(), 'project-lock-invalid-'))
  try {
    mkdirSync(join(root, 'writer'))
    writeFileSync(join(root, 'writer', 'owner.json'), '{}')
    expect(() => acquireProjectLock(root)).toThrow('inspection')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('a process crash leaves a tombstone that does not prevent safe reacquisition', () => {
  const root = mkdtempSync(join(tmpdir(), 'project-lock-crash-'))
  try {
    const script = `import { acquireProjectLock } from ${JSON.stringify(new URL('./project-lock.ts', import.meta.url).pathname)}; acquireProjectLock(${JSON.stringify(root)}); process.exit(0)`
    const child = spawnSync(process.execPath, ['--eval', script], { encoding: 'utf8' })
    expect(child.status).toBe(0)
    const release = acquireProjectLock(root)
    expect(() => acquireProjectLock(root)).toThrow('already active')
    release(); release()
    acquireProjectLock(root)()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
