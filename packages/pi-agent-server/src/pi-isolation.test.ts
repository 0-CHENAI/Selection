import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai'
import { getModels } from '@earendil-works/pi-ai/compat'
import { createIsolatedPiSettings, resolveIsolatedAgentDir } from './pi-isolation.ts'

const BUILTIN_EXTENSIONS = ['builtin:mcp', 'builtin:codemode', 'builtin:tool-search', 'builtin:llama.cpp']

function extensionPaths(result: { extensions: Array<{ path: string }>; errors: Array<{ path: string }> }): string[] {
  return [
    ...result.extensions.map(extension => extension.path),
    ...result.errors.map(error => error.path),
  ]
}

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

  it('does not load Pi built-in extensions on an isolated session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-pi-builtins-'))
    const agentDir = resolveIsolatedAgentDir({ sessionPath: join(root, 'session') })
    const settings = createIsolatedPiSettings()
    const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings })
    await loader.reload()

    const paths = extensionPaths(loader.getExtensions())
    for (const builtin of BUILTIN_EXTENSIONS) {
      expect(paths).not.toContain(builtin)
    }
    expect(loader.getSkills().skills.map(skill => skill.filePath).join('\n')).not.toContain(join(root, '.pi'))
  })

  it('creates an isolated Pi session without built-in extensions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-pi-session-'))
    const agentDir = resolveIsolatedAgentDir({ sessionPath: join(root, 'session') })
    const settings = createIsolatedPiSettings()
    const xaiModel = getModels('xai').find(model => model.id === 'grok-4.7')
    expect(xaiModel).toBeDefined()

    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      modelsStore: new InMemoryModelsStore(),
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    const listed = modelRuntime.getModels('xai').map(model => model.id)
    expect(listed).toContain('grok-4.7')

    const { session, extensionsResult } = await createAgentSession({
      cwd: root,
      agentDir,
      settingsManager: settings,
      sessionManager: SessionManager.inMemory(root),
      modelRuntime,
      model: xaiModel,
      thinkingLevel: 'off',
      tools: [],
    })
    try {
      expect(session.model?.provider).toBe('xai')
      expect(session.model?.id).toBe('grok-4.7')
      const paths = extensionPaths(extensionsResult)
      for (const builtin of BUILTIN_EXTENSIONS) {
        expect(paths).not.toContain(builtin)
      }
    } finally {
      session.dispose()
    }
  })
})
