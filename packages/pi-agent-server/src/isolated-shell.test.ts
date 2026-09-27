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
