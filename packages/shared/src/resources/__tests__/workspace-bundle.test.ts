import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  WORKSPACE_BUNDLE_KIND,
  exportWorkspace,
  importWorkspace,
  validateWorkspaceBundle,
} from '../workspace-bundle'
import type { WorkspaceBundle } from '../workspace-bundle'
import type { FolderSourceConfig } from '../../sources/types'
import type { AutomationMatcher } from '../../automations/types'

// ============================================================
// Helpers
// ============================================================

function createTestWorkspace(rootDir: string, name = 'Test Workspace'): string {
  const wsDir = join(rootDir, 'workspace-src')
  mkdirSync(join(wsDir, 'sources'), { recursive: true })
  mkdirSync(join(wsDir, 'skills'), { recursive: true })
  mkdirSync(join(wsDir, 'sessions'), { recursive: true })

  const config = {
    id: 'ws_src12345',
    name,
    slug: 'workspace-src',
    defaults: {
      permissionMode: 'ask',
      enabledSourceSlugs: [],
    },
    localMcpServers: { enabled: true },
    createdAt: 1000,
    updatedAt: 2000,
  }
  writeFileSync(join(wsDir, 'config.json'), JSON.stringify(config, null, 2))
  return wsDir
}

function createTestSource(wsDir: string, slug: string): void {
  const sourceDir = join(wsDir, 'sources', slug)
  mkdirSync(sourceDir, { recursive: true })

  const config: FolderSourceConfig = {
    id: `${slug}_abc123`,
    name: slug,
    slug,
    enabled: true,
    provider: 'custom',
    type: 'api',
    api: { baseUrl: 'https://api.example.com', authType: 'bearer' },
    isAuthenticated: true,
    connectionStatus: 'connected',
    lastTestedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  writeFileSync(join(sourceDir, 'config.json'), JSON.stringify(config, null, 2))
  writeFileSync(join(sourceDir, 'guide.md'), `# ${slug}\n`)
}

function createTestSkill(wsDir: string, slug: string): void {
  const skillDir = join(wsDir, 'skills', slug)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${slug}\ndescription: Test\n---\n\nBody.\n`)
}

function createTestAutomations(wsDir: string): void {
  const automations: Record<string, AutomationMatcher[]> = {
    SchedulerTick: [
      {
        id: 'abc123',
        name: 'daily',
        cron: '0 9 * * *',
        actions: [{ type: 'prompt', prompt: 'standup' }],
      } as AutomationMatcher,
    ],
  }
  writeFileSync(join(wsDir, 'automations.json'), JSON.stringify({ version: 2, automations }, null, 2))
}

function createTestStatusesAndLabels(wsDir: string): void {
  mkdirSync(join(wsDir, 'statuses', 'icons'), { recursive: true })
  writeFileSync(join(wsDir, 'statuses', 'config.json'), JSON.stringify({ statuses: [] }))
  writeFileSync(join(wsDir, 'statuses', 'icons', 'todo.svg'), '<svg/>')

  mkdirSync(join(wsDir, 'labels'), { recursive: true })
  writeFileSync(join(wsDir, 'labels', 'config.json'), JSON.stringify({ labels: [] }))
}

function createTestSession(wsDir: string, sessionId: string): void {
  const sessionDir = join(wsDir, 'sessions', sessionId)
  mkdirSync(join(sessionDir, 'attachments'), { recursive: true })

  const header = { id: sessionId, createdAt: 1000, workspaceRootPath: '/old/machine/path' }
  writeFileSync(
    join(sessionDir, 'session.jsonl'),
    JSON.stringify(header) + '\n' + JSON.stringify({ type: 'message', role: 'user', content: 'hi' }) + '\n',
  )
  writeFileSync(join(sessionDir, 'attachments', 'note.txt'), 'attachment content')
  // tmp/ should be skipped on export
  mkdirSync(join(sessionDir, 'tmp'), { recursive: true })
  writeFileSync(join(sessionDir, 'tmp', 'scratch.txt'), 'scratch')
}

// ============================================================
// Tests
// ============================================================

describe('workspace-bundle', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `workspace-bundle-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true })
    }
  })

  // ============================================================
  // Export
  // ============================================================

  describe('exportWorkspace', () => {
    it('throws when the path is not a valid workspace', () => {
      expect(() => exportWorkspace(join(tmpDir, 'nonexistent'))).toThrow()
    })

    it('exports config without identity/timestamps and with runtime state stripped', () => {
      const wsDir = createTestWorkspace(tmpDir)
      createTestSource(wsDir, 'my-api')

      const { bundle } = exportWorkspace(wsDir)

      expect(bundle.kind).toBe(WORKSPACE_BUNDLE_KIND)
      expect(bundle.version).toBe(1)
      expect(bundle.config.name).toBe('Test Workspace')
      expect((bundle.config as Record<string, unknown>).id).toBeUndefined()
      expect((bundle.config as Record<string, unknown>).createdAt).toBeUndefined()
      expect(bundle.config.defaults?.permissionMode).toBe('ask')

      // Source config is sanitized
      const source = bundle.resources.sources![0]!
      expect(source.slug).toBe('my-api')
      expect(source.config.isAuthenticated).toBe(false)
      expect(source.config.connectionStatus).toBe('needs_auth')
    })

    it('exports statuses, labels and loose top-level files but not runtime logs', () => {
      const wsDir = createTestWorkspace(tmpDir)
      createTestStatusesAndLabels(wsDir)
      writeFileSync(join(wsDir, 'theme.json'), JSON.stringify({ theme: 'dark' }))
      writeFileSync(join(wsDir, 'views.json'), JSON.stringify({ views: [] }))
      writeFileSync(join(wsDir, 'events.jsonl'), '{"event":"x"}\n')
      writeFileSync(join(wsDir, 'automations-history.jsonl'), '{"run":1}\n')

      const { bundle } = exportWorkspace(wsDir)

      expect(bundle.statuses.map(f => f.relativePath).sort()).toEqual(['config.json', 'icons/todo.svg'])
      expect(bundle.labels.map(f => f.relativePath)).toEqual(['config.json'])

      const topFiles = bundle.files.map(f => f.relativePath)
      expect(topFiles).toContain('theme.json')
      expect(topFiles).toContain('views.json')
      expect(topFiles).not.toContain('config.json')
      expect(topFiles).not.toContain('events.jsonl')
      expect(topFiles).not.toContain('automations-history.jsonl')
    })

    it('excludes sessions by default and includes them (minus tmp/) on demand', () => {
      const wsDir = createTestWorkspace(tmpDir)
      createTestSession(wsDir, 'sess-1')

      const without = exportWorkspace(wsDir)
      expect(without.bundle.sessions).toBeUndefined()

      const withSessions = exportWorkspace(wsDir, { includeSessions: true })
      expect(withSessions.bundle.sessions).toHaveLength(1)
      const files = withSessions.bundle.sessions![0]!.files.map(f => f.relativePath)
      expect(files).toContain('session.jsonl')
      expect(files).toContain('attachments/note.txt')
      expect(files).not.toContain('tmp/scratch.txt')
    })

    it('exports automations via the resources machinery', () => {
      const wsDir = createTestWorkspace(tmpDir)
      createTestAutomations(wsDir)

      const { bundle } = exportWorkspace(wsDir)
      expect(bundle.resources.automations).toHaveLength(1)
      expect(bundle.resources.automations![0]!.event).toBe('SchedulerTick')
    })
  })

  // ============================================================
  // Validation
  // ============================================================

  describe('validateWorkspaceBundle', () => {
    it('rejects non-workspace bundles', () => {
      expect(validateWorkspaceBundle(null).valid).toBe(false)
      expect(validateWorkspaceBundle({ kind: 'something-else' }).valid).toBe(false)
      expect(validateWorkspaceBundle({ version: 2 }).valid).toBe(false)
    })

    it('accepts a real export round-trip', () => {
      const wsDir = createTestWorkspace(tmpDir)
      const { bundle } = exportWorkspace(wsDir)
      const result = validateWorkspaceBundle(bundle)
      expect(result.errors).toEqual([])
      expect(result.valid).toBe(true)
    })

    it('rejects sessions with unsafe ids', () => {
      const wsDir = createTestWorkspace(tmpDir)
      const { bundle } = exportWorkspace(wsDir)
      bundle.sessions = [{ id: '../evil', files: [] }]
      expect(validateWorkspaceBundle(bundle).valid).toBe(false)
    })
  })

  // ============================================================
  // Import
  // ============================================================

  describe('importWorkspace', () => {
    async function roundTrip(
      wsDir: string,
      exportOptions?: { includeSessions?: boolean },
      importOptions?: { name?: string },
    ) {
      const { bundle } = exportWorkspace(wsDir, exportOptions)
      const targetParent = join(tmpDir, 'target')
      mkdirSync(targetParent, { recursive: true })
      const result = await importWorkspace(targetParent, bundle, importOptions)
      return { bundle, result }
    }

    it('creates a new workspace with fresh id and restored content', async () => {
      const wsDir = createTestWorkspace(tmpDir)
      createTestSource(wsDir, 'my-api')
      createTestSkill(wsDir, 'my-skill')
      createTestAutomations(wsDir)
      createTestStatusesAndLabels(wsDir)
      writeFileSync(join(wsDir, 'theme.json'), JSON.stringify({ theme: 'dark' }))

      const { result } = await roundTrip(wsDir)

      expect(result.workspaceId).toMatch(/^ws_/)
      expect(result.workspaceId).not.toBe('ws_src12345')

      const newConfig = JSON.parse(readFileSync(join(result.workspacePath, 'config.json'), 'utf-8'))
      expect(newConfig.name).toBe('Test Workspace')
      expect(newConfig.slug).toBe('test-workspace')
      expect(newConfig.defaults.permissionMode).toBe('ask')

      // Resources imported
      expect(result.resources.sources.imported).toEqual(['my-api'])
      expect(result.resources.skills.imported).toEqual(['my-skill'])
      expect(result.resources.automations.imported).toEqual(['daily'])
      expect(existsSync(join(result.workspacePath, 'sources', 'my-api', 'guide.md'))).toBe(true)
      expect(existsSync(join(result.workspacePath, 'skills', 'my-skill', 'SKILL.md'))).toBe(true)
      expect(existsSync(join(result.workspacePath, 'automations.json'))).toBe(true)

      // Statuses / labels / loose files restored
      expect(existsSync(join(result.workspacePath, 'statuses', 'icons', 'todo.svg'))).toBe(true)
      expect(existsSync(join(result.workspacePath, 'labels', 'config.json'))).toBe(true)
      expect(existsSync(join(result.workspacePath, 'theme.json'))).toBe(true)
    })

    it('restores sessions and rewrites workspaceRootPath in the header', async () => {
      const wsDir = createTestWorkspace(tmpDir)
      createTestSession(wsDir, 'sess-1')

      const { result } = await roundTrip(wsDir, { includeSessions: true })

      expect(result.sessions.imported).toEqual(['sess-1'])
      const sessionFile = join(result.workspacePath, 'sessions', 'sess-1', 'session.jsonl')
      const firstLine = readFileSync(sessionFile, 'utf-8').split('\n')[0]!
      const header = JSON.parse(firstLine)
      expect(header.workspaceRootPath).toBe(result.workspacePath)
      // Rest of the file preserved
      expect(readFileSync(sessionFile, 'utf-8')).toContain('"role":"user"')
      expect(existsSync(join(result.workspacePath, 'sessions', 'sess-1', 'attachments', 'note.txt'))).toBe(true)
      expect(existsSync(join(result.workspacePath, 'sessions', 'sess-1', 'tmp'))).toBe(false)
    })

    it('gives the folder a unique suffix on name collision', async () => {
      const wsDir = createTestWorkspace(tmpDir)
      const { bundle } = exportWorkspace(wsDir)

      const targetParent = join(tmpDir, 'target')
      mkdirSync(join(targetParent, 'test-workspace'), { recursive: true })

      const result = await importWorkspace(targetParent, bundle)
      expect(result.workspacePath).toBe(join(targetParent, 'test-workspace-2'))
      const newConfig = JSON.parse(readFileSync(join(result.workspacePath, 'config.json'), 'utf-8'))
      expect(newConfig.slug).toBe('test-workspace-2')
    })

    it('honors the name override option', async () => {
      const wsDir = createTestWorkspace(tmpDir)
      const { result } = await roundTrip(wsDir, undefined, { name: 'Imported Copy' })
      const newConfig = JSON.parse(readFileSync(join(result.workspacePath, 'config.json'), 'utf-8'))
      expect(newConfig.name).toBe('Imported Copy')
    })

    it('re-importing the same bundle creates a second workspace instead of failing', async () => {
      const wsDir = createTestWorkspace(tmpDir)
      const { bundle } = exportWorkspace(wsDir)
      const targetParent = join(tmpDir, 'target')

      const first = await importWorkspace(targetParent, bundle)
      const second = await importWorkspace(targetParent, bundle)

      expect(first.workspacePath).not.toBe(second.workspacePath)
      expect(first.workspaceId).not.toBe(second.workspaceId)
      expect(existsSync(first.workspacePath)).toBe(true)
      expect(existsSync(second.workspacePath)).toBe(true)
    })

    it('throws on an invalid bundle', async () => {
      const targetParent = join(tmpDir, 'target')
      await expect(
        importWorkspace(targetParent, { kind: 'nope' } as unknown as WorkspaceBundle),
      ).rejects.toThrow('Invalid workspace bundle')
    })
  })
})
