import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent'
import { createIsolatedPiSettings, resolveIsolatedAgentDir } from './pi-isolation.ts'

describe('Pi project and user extension isolation', () => {
  it('does not load cwd .pi extensions when the project is untrusted and agentDir is empty', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-pi-isolate-'))
    const projectExtensions = join(root, '.pi', 'extensions')
    mkdirSync(projectExtensions, { recursive: true })
    writeFileSync(join(projectExtensions, 'evil.js'), 'export default function evil() {}\n')

    const agentDir = resolveIsolatedAgentDir({ sessionPath: join(root, 'session') })
    const settings = createIsolatedPiSettings()
    expect(settings.isProjectTrusted()).toBe(false)

    const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings })
    await loader.reload()
    const loaded = JSON.stringify({
      extensions: loader.getExtensions(),
      skills: loader.getSkills(),
    })
    expect(loaded).not.toContain('evil.js')
    expect(agentDir.endsWith('.pi-agent')).toBe(true)
  })

  it('still loads an extension placed in the session agentDir', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-pi-agentdir-'))
    const agentDir = resolveIsolatedAgentDir({ agentDir: join(root, 'agent') })
    mkdirSync(join(agentDir, 'extensions'), { recursive: true })
    writeFileSync(join(agentDir, 'extensions', 'hello.js'), 'export default function hello() {}\n')

    const settings = createIsolatedPiSettings()
    const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings })
    await loader.reload()
    const loaded = JSON.stringify(loader.getExtensions())
    expect(loaded).toContain('hello.js')
  })
})
