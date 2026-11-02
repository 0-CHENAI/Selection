import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createIsolatedShell } from '../../shared/src/utils/isolated-shell'
import { resolveOfficecliBinary } from '../../shared/src/utils/officecli'
import { createBashToolDefinition } from '@earendil-works/pi-coding-agent'
import { assertIsolatedTool, prepareIsolatedWorkspace } from '../../server-core/src/reliability/isolated-workspace'
import { execFileSync } from 'node:child_process'
import { unzipSync } from 'fflate'

const binary = resolveOfficecliBinary({ env: { ...process.env, CRAFT_OFFICECLI: undefined } })
const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`

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

test.skipIf(process.platform !== 'darwin')('Office native shell denies browser executables even through a nested shell', async () => {
  const { copyFileSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'selection-office-browser-'))
  // A harmless executable verifies exec denial without launching a browser.
  copyFileSync('/bin/echo', join(root, 'Google Chrome'))
  const shell = createIsolatedShell(root, { denyExternalBrowsers: true })
  try {
    expect(shell).toBeDefined()
    let output = ''
    const run = (command: string) => shell!.operations.exec(command, root, { onData: bytes => { output += bytes.toString() } })
    expect((await run('printf normal')).exitCode).toBe(0)
    output = ''
    expect((await run('/bin/bash -c \'"./Google Chrome" browser-started\'')).exitCode).not.toBe(0)
    expect(output).not.toContain('browser-started\n')
    expect(output).toContain('Operation not permitted')
  } finally { shell?.dispose(); rmSync(root, { recursive: true, force: true }) }
})

test.skipIf(process.platform !== 'win32')('Windows native Shell runs Python while containing writes, deletes, metadata edits, and timeouts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'selection-shell-win-'))
  const candidate = join(root, 'candidate with 空格'), outsideDirectory = join(root, 'outside')
  const outside = join(root, 'outside.txt'), metadata = join(candidate, '.git', 'config')
  mkdirSync(candidate, { recursive: true }); mkdirSync(join(candidate, '.git')); mkdirSync(outsideDirectory)
  writeFileSync(outside, 'original'); writeFileSync(metadata, 'original')
  symlinkSync(outsideDirectory, join(candidate, 'linked'), 'junction')
  const shell = createIsolatedShell(candidate)
  try {
    expect(shell).toBeDefined()
    let output = ''
    const run = (command: string, timeout?: number) => shell!.operations.exec(command, candidate, { onData: bytes => { output += bytes.toString() }, timeout })
    expect((await run('python -c "from pathlib import Path; print(\'python-ok\'); Path(\'python.txt\').write_text(\'ok\', encoding=\'utf-8\')"')).exitCode).toBe(0)
    expect(output).toContain('python-ok')
    expect(readFileSync(join(candidate, 'python.txt'), 'utf8')).toBe('ok')
    expect((await run('python -c "from pathlib import Path; Path(r\'../outside.txt\').write_text(\'changed\')"')).exitCode).not.toBe(0)
    expect((await run('python -c "from pathlib import Path; Path(r\'../outside.txt\').unlink()"')).exitCode).not.toBe(0)
    expect((await run('python -c "from pathlib import Path; Path(r\'linked/escape.txt\').write_text(\'changed\')"')).exitCode).not.toBe(0)
    expect((await run('python -c "from pathlib import Path; Path(r\'.git/config\').write_text(\'changed\')"')).exitCode).not.toBe(0)
    expect(readFileSync(outside, 'utf8')).toBe('original')
    expect(readFileSync(metadata, 'utf8')).toBe('original')
    output = ''
    expect((await run('type .git\\config')).exitCode).toBe(0)
    expect(output).toContain('original')
    await expect(run('python -c "import time; time.sleep(30)"', 1)).rejects.toThrow('timeout:1')
    expect((await run('python --version')).exitCode).toBe(0)
  } finally { shell?.dispose(); rmSync(root, { recursive: true, force: true }) }
}, 120_000)

test.skipIf(process.platform !== 'win32')('Windows isolated sub-agent executes Python through the real Pi Bash tool', async () => {
  const root = mkdtempSync(join(tmpdir(), 'selection-subagent-win-'))
  const source = join(root, 'source')
  mkdirSync(source)
  const state = prepareIsolatedWorkspace(source, join(root, 'store'))
  const shell = createIsolatedShell(state.directory)
  try {
    expect(shell).toBeDefined()
    const command = 'python -c "from pathlib import Path; print(\'subagent-python-ok\'); Path(\'subagent.txt\').write_text(\'ok\', encoding=\'utf-8\')"'
    expect(() => assertIsolatedTool(state, 'Bash', { command }, shell!.directory)).not.toThrow()
    const tool = createBashToolDefinition(state.directory, { operations: shell!.operations })
    const context = {
      cwd: state.directory,
      sessionManager: { getSessionId: () => 'windows-subagent', getSessionFile: () => join(state.directory, 'session.jsonl') },
    }
    const result = await tool.execute('windows-subagent-call', { command }, new AbortController().signal, undefined, context as never)
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('subagent-python-ok') })
    expect(readFileSync(join(state.directory, 'subagent.txt'), 'utf8')).toBe('ok')
  } finally { shell?.dispose(); rmSync(root, { recursive: true, force: true }) }
}, 120_000)

test.skipIf(!binary || process.platform !== 'win32')('Windows Office candidate edits reach disk without a model save', async () => {
  const root = mkdtempSync(join(tmpdir(), 'selection-office-win-'))
  const file = join(root, '候选 文档.docx')
  const cli = (...args: string[]) => execFileSync(binary!, args, { env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' }, timeout: 30_000 })
  cli('create', file); cli('close', file)
  const shell = createIsolatedShell(root, { officeDocument: { path: file, binary: binary! } })
  const quote = (value: string) => `"${value}"`
  const wrapper = join(binary!, '..', '..', 'officecli.cmd')
  try {
    expect(shell).toBeDefined()
    let output = ''
    const run = (command: string) => shell!.operations.exec(command, root, { onData: bytes => { output += bytes.toString() }, timeout: 30 })
    expect((await run(`${quote(wrapper)} open ${quote(file)} && ${quote(wrapper)} add ${quote(file)} /body --type p --prop text=Changed`)).exitCode).toBe(0)
    expect(output).toContain('Direct file mode')
    const xml = Object.entries(unzipSync(readFileSync(file))).filter(([name]) => name.endsWith('.xml'))
      .map(([, bytes]) => new TextDecoder().decode(bytes)).join('\n')
    expect(xml).toContain('Changed')
    expect((await run('exit 7')).exitCode).toBe(7)
  } finally { shell?.dispose(); cli('close', file); rmSync(root, { recursive: true, force: true }) }
}, 120_000)

for (const kind of ['docx', 'xlsx', 'pptx']) test.skipIf(!binary || !['darwin', 'linux'].includes(process.platform))(`isolated ${kind} edits reach disk between separate calls without a model save`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'selection-office-transaction-'))
  const file = join(root, `含 空格 ' $() \u0060文档.${kind}`)
  const cli = (...args: string[]) => execFileSync(binary!, args, { env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' }, timeout: 30_000 })
  cli('create', file)
  if (kind === 'docx') cli('add', file, '/body', '--type', 'p', '--prop', 'text=Original')
  if (kind === 'xlsx') cli('set', file, '/Sheet1/A1', '--prop', 'value=Original')
  if (kind === 'pptx') {
    cli('add', file, '/', '--type', 'slide')
    cli('add', file, '/slide[1]', '--type', 'shape', '--prop', 'text=Original')
  }
  cli('close', file)
  const shell = createIsolatedShell(root, { officeDocument: { path: file, binary: binary! }, denyExternalBrowsers: true })
  try {
    if (!shell && process.platform === 'linux') return
    expect(shell).toBeDefined()
    let output = ''
    const run = (command: string) => shell!.operations.exec(command, root, { onData: bytes => { output += bytes.toString() }, timeout: 30 })
    expect((await run(`${quote(binary!)} open ${quote(file)}`)).exitCode).toBe(0)
    const path = kind === 'docx' ? '/body/p[1]' : kind === 'xlsx' ? '/Sheet1/A1' : '/slide[1]/shape[1]'
    const prop = kind === 'xlsx' ? 'value=Changed' : 'text=Changed'
    // exec replaces the model's inner shell; the trusted supervisor still closes.
    expect((await run(`exec ${quote(binary!)} set ${quote(file)} ${quote(path)} --prop ${quote(prop)}`)).exitCode).toBe(0)
    const xml = Object.entries(unzipSync(readFileSync(file))).filter(([name]) => name.endsWith('.xml'))
      .map(([, bytes]) => new TextDecoder().decode(bytes)).join('\n')
    expect(xml).toContain('Changed')
    expect(xml).not.toContain('Original')
    output = ''
    expect((await run(`${quote(binary!)} get ${quote(file)} ${quote(path)} --json`)).exitCode).toBe(0)
    expect(output).toContain('Changed')
    expect(output).not.toContain('previous session ended')
    // Saving must not turn a failed command into a successful tool result.
    expect((await run('exit 7')).exitCode).toBe(7)
  } finally { shell?.dispose(); cli('close', file); rmSync(root, { recursive: true, force: true }) }
}, 60_000)

test.skipIf(process.platform !== 'darwin')('Office flush failure is visible and its candidate cannot escape confinement', async () => {
  const root = mkdtempSync(join(tmpdir(), 'selection-office-flush-'))
  const candidate = join(root, 'candidate'); mkdirSync(candidate)
  const file = join(candidate, 'document.docx'), outside = join(root, 'outside.docx')
  writeFileSync(file, 'candidate'); writeFileSync(outside, 'original')
  const fakeBinary = join(root, 'close-fails')
  writeFileSync(fakeBinary, '#!/bin/bash\nprintf "cannot save candidate" >&2\nexit 9\n', { mode: 0o755 })
  expect(() => createIsolatedShell(candidate, { officeDocument: { path: outside, binary: fakeBinary } })).toThrow('escapes')
  const shell = createIsolatedShell(candidate, { officeDocument: { path: file, binary: fakeBinary } })
  try {
    let output = ''
    const result = await shell!.operations.exec('printf work', candidate, { onData: bytes => { output += bytes.toString() } })
    expect(result.exitCode).toBe(9)
    expect(output).toContain('Office candidate flush failed: cannot save candidate')
    expect(readFileSync(outside, 'utf8')).toBe('original')
  } finally { shell?.dispose(); rmSync(root, { recursive: true, force: true }) }
})
