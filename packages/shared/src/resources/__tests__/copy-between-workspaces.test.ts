import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  copyBetweenWorkspaces,
  credentialWorkspaceIdFromRoot,
  isSafeResourceSlug,
} from '../copy-between-workspaces.ts'

function makeWorkspace(root: string, sources: Array<{ slug: string; name: string; authed?: boolean; authType?: string }>) {
  mkdirSync(join(root, 'sources'), { recursive: true })
  mkdirSync(join(root, 'skills'), { recursive: true })
  writeFileSync(join(root, 'config.json'), JSON.stringify({ id: 'ws', name: 'Test', slug: 'test' }))
  for (const s of sources) {
    const dir = join(root, 'sources', s.slug)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'config.json'), JSON.stringify({
      slug: s.slug,
      name: s.name,
      type: 'api',
      enabled: true,
      isAuthenticated: !!s.authed,
      connectionStatus: s.authed ? 'connected' : 'needs_auth',
      api: { baseUrl: 'https://example.com', authType: s.authType ?? 'header' },
    }, null, 2))
    writeFileSync(join(dir, 'guide.md'), `# ${s.name}`)
  }
}

describe('isSafeResourceSlug', () => {
  it('rejects traversal and hidden names', () => {
    expect(isSafeResourceSlug('../evil')).toBe(false)
    expect(isSafeResourceSlug('a/b')).toBe(false)
    expect(isSafeResourceSlug('.tmp-x')).toBe(false)
    expect(isSafeResourceSlug('..')).toBe(false)
    expect(isSafeResourceSlug('')).toBe(false)
    expect(isSafeResourceSlug('github')).toBe(true)
    expect(isSafeResourceSlug('my-source_1')).toBe(true)
  })
})

describe('copyBetweenWorkspaces', () => {
  let base: string
  let fromRoot: string
  let toRoot: string
  const creds = new Map<string, unknown>()

  beforeEach(() => {
    base = join(tmpdir(), `copy-ws-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fromRoot = join(base, 'from-ws')
    toRoot = join(base, 'to-ws')
    mkdirSync(fromRoot, { recursive: true })
    mkdirSync(toRoot, { recursive: true })
    makeWorkspace(fromRoot, [
      { slug: 'github', name: 'GitHub', authed: true },
      { slug: 'linear', name: 'Linear', authed: false },
    ])
    makeWorkspace(toRoot, [])
    creds.clear()
    creds.set('source_apikey::from-ws::github', { value: 'secret-token' })
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  const deps = {
    copySourceCredentials: async (fromWs: string, toWs: string, slug: string) => {
      const fromKey = `source_apikey::${fromWs}::${slug}`
      const val = creds.get(fromKey)
      if (val) {
        creds.set(`source_apikey::${toWs}::${slug}`, val)
        return true
      }
      return false
    },
    clearSourceCredentials: async (ws: string, slug: string) => {
      for (const key of [...creds.keys()]) {
        if (key.includes(`::${ws}::${slug}`)) creds.delete(key)
      }
    },
  }

  it('copies source folders and credentials', async () => {
    const result = await copyBetweenWorkspaces(
      {
        fromRootPath: fromRoot,
        toRootPath: toRoot,
        fromCredentialWorkspaceId: credentialWorkspaceIdFromRoot(fromRoot),
        toCredentialWorkspaceId: credentialWorkspaceIdFromRoot(toRoot),
        sources: ['github'],
        mode: 'skip',
        includeCredentials: true,
      },
      deps,
    )

    expect(result.sources.imported).toEqual(['github'])
    expect(existsSync(join(toRoot, 'sources', 'github', 'config.json'))).toBe(true)
    expect(existsSync(join(toRoot, 'sources', 'github', 'guide.md'))).toBe(true)
    expect(creds.get('source_apikey::to-ws::github')).toEqual({ value: 'secret-token' })

    const cfg = JSON.parse(readFileSync(join(toRoot, 'sources', 'github', 'config.json'), 'utf-8'))
    expect(cfg.isAuthenticated).toBe(true)
    expect(cfg.connectionStatus).toBe('connected')
  })

  it('clears auth flags when credentials are not copied', async () => {
    const result = await copyBetweenWorkspaces(
      {
        fromRootPath: fromRoot,
        toRootPath: toRoot,
        fromCredentialWorkspaceId: 'from-ws',
        toCredentialWorkspaceId: 'to-ws',
        sources: ['github'],
        mode: 'skip',
        includeCredentials: false,
      },
      deps,
    )

    expect(result.sources.imported).toEqual(['github'])
    expect(creds.has('source_apikey::to-ws::github')).toBe(false)
    const cfg = JSON.parse(readFileSync(join(toRoot, 'sources', 'github', 'config.json'), 'utf-8'))
    expect(cfg.isAuthenticated).toBe(false)
    expect(cfg.connectionStatus).toBe('needs_auth')
  })

  it('skips existing sources when mode is skip', async () => {
    makeWorkspace(toRoot, [{ slug: 'github', name: 'Existing' }])
    const result = await copyBetweenWorkspaces(
      {
        fromRootPath: fromRoot,
        toRootPath: toRoot,
        fromCredentialWorkspaceId: 'from-ws',
        toCredentialWorkspaceId: 'to-ws',
        sources: ['github'],
        mode: 'skip',
      },
      deps,
    )
    expect(result.sources.skipped).toEqual(['github'])
    expect(result.sources.imported).toEqual([])
  })

  it('overwrites existing sources when mode is overwrite', async () => {
    makeWorkspace(toRoot, [{ slug: 'github', name: 'Old' }])
    creds.set('source_apikey::to-ws::github', { value: 'old-secret' })
    const result = await copyBetweenWorkspaces(
      {
        fromRootPath: fromRoot,
        toRootPath: toRoot,
        fromCredentialWorkspaceId: 'from-ws',
        toCredentialWorkspaceId: 'to-ws',
        sources: ['github'],
        mode: 'overwrite',
        includeCredentials: true,
      },
      deps,
    )
    expect(result.sources.imported).toEqual(['github'])
    const cfg = JSON.parse(readFileSync(join(toRoot, 'sources', 'github', 'config.json'), 'utf-8'))
    expect(cfg.name).toBe('GitHub')
    expect(creds.get('source_apikey::to-ws::github')).toEqual({ value: 'secret-token' })
  })

  it('copies all sources when selection is all', async () => {
    const result = await copyBetweenWorkspaces(
      {
        fromRootPath: fromRoot,
        toRootPath: toRoot,
        fromCredentialWorkspaceId: 'from-ws',
        toCredentialWorkspaceId: 'to-ws',
        sources: 'all',
        mode: 'skip',
        includeCredentials: false,
      },
      deps,
    )
    expect(result.sources.imported.sort()).toEqual(['github', 'linear'])
    expect(creds.has('source_apikey::to-ws::github')).toBe(false)
  })

  it('rejects path-traversal slugs', async () => {
    const result = await copyBetweenWorkspaces(
      {
        fromRootPath: fromRoot,
        toRootPath: toRoot,
        fromCredentialWorkspaceId: 'from-ws',
        toCredentialWorkspaceId: 'to-ws',
        sources: ['../evil'],
        mode: 'skip',
      },
      deps,
    )
    expect(result.sources.failed).toHaveLength(1)
    expect(result.sources.failed[0]!.error).toContain('Invalid')
  })

  it('copies skills', async () => {
    const skillDir = join(fromRoot, 'skills', 'commit')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: Commit\n---\nbody')

    const result = await copyBetweenWorkspaces(
      {
        fromRootPath: fromRoot,
        toRootPath: toRoot,
        fromCredentialWorkspaceId: 'from-ws',
        toCredentialWorkspaceId: 'to-ws',
        skills: ['commit'],
        mode: 'skip',
      },
      deps,
    )
    expect(result.skills.imported).toEqual(['commit'])
    expect(existsSync(join(toRoot, 'skills', 'commit', 'SKILL.md'))).toBe(true)
  })

  it('keeps previous target if staged copy would fail for missing source', async () => {
    makeWorkspace(toRoot, [{ slug: 'github', name: 'KeepMe' }])
    const result = await copyBetweenWorkspaces(
      {
        fromRootPath: fromRoot,
        toRootPath: toRoot,
        fromCredentialWorkspaceId: 'from-ws',
        toCredentialWorkspaceId: 'to-ws',
        sources: ['does-not-exist'],
        mode: 'overwrite',
      },
      deps,
    )
    expect(result.sources.failed).toHaveLength(1)
    const cfg = JSON.parse(readFileSync(join(toRoot, 'sources', 'github', 'config.json'), 'utf-8'))
    expect(cfg.name).toBe('KeepMe')
  })
})
