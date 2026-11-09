import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href
const PATHS_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', '..', 'utils', 'paths.ts')).href

function runEnsureToolIcons(configDir: string, assetsRoot: string) {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import { setBundledAssetsRoot } from '${PATHS_MODULE_PATH}';
     import { ensureToolIcons } from '${STORAGE_MODULE_PATH}';
     setBundledAssetsRoot(${JSON.stringify(assetsRoot)});
     ensureToolIcons();`,
  ], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (run.exitCode !== 0) {
    throw new Error(`ensureToolIcons failed:\n${run.stderr.toString()}\n${run.stdout.toString()}`)
  }
}

describe('ensureToolIcons (#307)', () => {
  it('refreshes a stale Selection brand icon and leaves other user files alone', () => {
    const assetsRoot = mkdtempSync(join(tmpdir(), 'tool-icons-bundle-'))
    const bundledDir = join(assetsRoot, 'resources', 'tool-icons')
    mkdirSync(bundledDir, { recursive: true })
    const swan = '<svg id="swan" />'
    writeFileSync(join(bundledDir, 'craft-agent.svg'), swan)
    writeFileSync(join(bundledDir, 'git.svg'), '<svg id="git-bundled" />')
    writeFileSync(join(bundledDir, 'tool-icons.json'), JSON.stringify({ version: 1, tools: [] }))

    const configDir = mkdtempSync(join(tmpdir(), 'tool-icons-user-'))
    const userDir = join(configDir, 'tool-icons')
    mkdirSync(userDir, { recursive: true })
    writeFileSync(join(userDir, 'craft-agent.svg'), '<svg id="old-s" />')
    writeFileSync(join(userDir, 'git.svg'), '<svg id="git-custom" />')
    writeFileSync(join(userDir, 'custom-user.svg'), '<svg id="user" />')

    runEnsureToolIcons(configDir, assetsRoot)

    expect(readFileSync(join(userDir, 'craft-agent.svg'), 'utf-8')).toBe(swan)
    expect(readFileSync(join(userDir, 'git.svg'), 'utf-8')).toBe('<svg id="git-custom" />')
    expect(readFileSync(join(userDir, 'custom-user.svg'), 'utf-8')).toBe('<svg id="user" />')
    expect(existsSync(join(userDir, 'tool-icons.json'))).toBe(true)
  })

  it('copies missing bundled files on first run', () => {
    const assetsRoot = mkdtempSync(join(tmpdir(), 'tool-icons-first-run-'))
    const bundledDir = join(assetsRoot, 'resources', 'tool-icons')
    mkdirSync(bundledDir, { recursive: true })
    writeFileSync(join(bundledDir, 'craft-agent.svg'), '<svg id="swan" />')
    writeFileSync(join(bundledDir, 'git.svg'), '<svg id="git" />')

    const configDir = mkdtempSync(join(tmpdir(), 'tool-icons-empty-'))

    runEnsureToolIcons(configDir, assetsRoot)

    const userDir = join(configDir, 'tool-icons')
    expect(readFileSync(join(userDir, 'craft-agent.svg'), 'utf-8')).toBe('<svg id="swan" />')
    expect(readFileSync(join(userDir, 'git.svg'), 'utf-8')).toBe('<svg id="git" />')
  })

  it('does not rewrite a Selection icon that already matches the bundle', () => {
    const assetsRoot = mkdtempSync(join(tmpdir(), 'tool-icons-same-'))
    const bundledDir = join(assetsRoot, 'resources', 'tool-icons')
    mkdirSync(bundledDir, { recursive: true })
    const swan = '<svg id="swan" />'
    writeFileSync(join(bundledDir, 'craft-agent.svg'), swan)

    const configDir = mkdtempSync(join(tmpdir(), 'tool-icons-current-'))
    const dest = join(configDir, 'tool-icons', 'craft-agent.svg')
    mkdirSync(join(configDir, 'tool-icons'), { recursive: true })
    writeFileSync(dest, swan)
    utimesSync(dest, 1_600_000_000, 1_600_000_000)

    runEnsureToolIcons(configDir, assetsRoot)

    expect(readFileSync(dest, 'utf-8')).toBe(swan)
    expect(statSync(dest).mtimeMs).toBe(1_600_000_000_000)
  })

  it('still refreshes the Selection icon when another bundled copy fails', () => {
    const assetsRoot = mkdtempSync(join(tmpdir(), 'tool-icons-sibling-'))
    const bundledDir = join(assetsRoot, 'resources', 'tool-icons')
    mkdirSync(bundledDir, { recursive: true })
    writeFileSync(join(bundledDir, 'craft-agent.svg'), '<svg id="swan" />')
    writeFileSync(join(bundledDir, 'git.svg'), '<svg id="git-bundled" />')

    const configDir = mkdtempSync(join(tmpdir(), 'tool-icons-blocked-'))
    const userDir = join(configDir, 'tool-icons')
    mkdirSync(join(userDir, 'git.svg'), { recursive: true })
    writeFileSync(join(userDir, 'craft-agent.svg'), '<svg id="old-s" />')

    runEnsureToolIcons(configDir, assetsRoot)

    expect(readFileSync(join(userDir, 'craft-agent.svg'), 'utf-8')).toBe('<svg id="swan" />')
    expect(statSync(join(userDir, 'git.svg')).isDirectory()).toBe(true)
  })
})
