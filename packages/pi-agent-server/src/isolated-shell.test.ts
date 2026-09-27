import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createIsolatedShell } from '../../shared/src/utils/isolated-shell'

test.skipIf(process.platform !== 'darwin')('native Shell writes candidates but cannot modify originals, metadata, or linked files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'selection-shell-'))
  const candidate = join(root, 'candidate'), original = join(root, 'original')
  mkdirSync(candidate); mkdirSync(join(candidate, '.git')); writeFileSync(original, 'original')
  symlinkSync(original, join(candidate, 'linked'))
  const shell = createIsolatedShell(candidate)
  try {
    expect(shell).toBeDefined()
    const output: Buffer[] = []
    const run = (command: string) => shell!.operations.exec(command, candidate, { onData: bytes => output.push(bytes) })
    expect((await run('printf changed > answer.txt')).exitCode).toBe(0)
    expect(readFileSync(join(candidate, 'answer.txt'), 'utf8')).toBe('changed')
    expect((await run('printf broken > ../original')).exitCode).not.toBe(0)
    expect((await run('printf broken > linked')).exitCode).not.toBe(0)
    expect((await run('printf broken > .git/config')).exitCode).not.toBe(0)
    expect(readFileSync(original, 'utf8')).toBe('original')
  } finally { shell?.dispose(); rmSync(root, { recursive: true, force: true }) }
})

test.skipIf(!['darwin', 'linux'].includes(process.platform))('native Shell respects nested cwd and reports output handler failures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'selection-shell-cwd-'))
  const nested = join(root, 'nested'); mkdirSync(nested)
  const shell = createIsolatedShell(root)
  try {
    // Linux CI may lack the kernel permission needed by bwrap.
    if (!shell && process.platform === 'linux') return
    expect(shell).toBeDefined()
    await shell!.operations.exec('printf nested > result.txt', nested, { onData: () => {} })
    expect(readFileSync(join(nested, 'result.txt'), 'utf8')).toBe('nested')
    const failure = new Error('output disk full')
    await expect(shell!.operations.exec('printf output; sleep 30', nested, { onData: () => { throw failure } })).rejects.toBe(failure)
    expect((await shell!.operations.exec('exit 0', nested, { onData: () => {} })).exitCode).toBe(0)
  } finally { shell?.dispose(); rmSync(root, { recursive: true, force: true }) }
})
