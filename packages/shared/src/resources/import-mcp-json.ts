/**
 * Import Claude Desktop / Cursor MCP JSON into Selection MCP sources (#82).
 */

import { existsSync, readdirSync } from 'fs'
import { createSource, deleteSource, saveSourceConfig } from '../sources/storage.ts'
import type { CreateSourceInput, McpSourceConfig, McpTransport } from '../sources/types.ts'
import { getWorkspaceSourcesPath } from '../workspaces/storage.ts'
import { isSafeResourceSlug } from './copy-between-workspaces.ts'
import { sanitizeSourceConfig } from './resource-bundle.ts'
import type { ResourceRedaction } from './types.ts'

export type ExternalImportAction = 'skip' | 'overwrite' | 'rename'

export interface McpImportCandidate {
  key: string
  name: string
  suggestedSlug: string
  conflict: boolean
  mcp: McpSourceConfig
  redactions: string[]
  needsAuth: boolean
  cwdDropped?: string
}

export interface McpImportDecision {
  key: string
  action: ExternalImportAction
  renameTo?: string
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50)
  return slug || 'mcp'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function isServerObject(value: unknown): boolean {
  const record = asRecord(value)
  if (!record) return false
  return (typeof record.command === 'string' && record.command.trim().length > 0)
    || (typeof record.url === 'string' && record.url.trim().length > 0)
}

function collectServerEntries(parsed: unknown): Array<{ name: string; raw: Record<string, unknown> }> {
  const mcpServers = asRecord(parsed)?.mcpServers
  if (asRecord(mcpServers)) {
    return Object.entries(mcpServers as Record<string, unknown>)
      .filter(([, value]) => isServerObject(value))
      .map(([name, value]) => ({ name, raw: asRecord(value)! }))
  }
  if (Array.isArray(parsed)) {
    return parsed
      .filter(isServerObject)
      .map((value, index) => {
        const raw = asRecord(value)!
        const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `mcp-${index + 1}`
        return { name, raw }
      })
  }
  if (isServerObject(parsed)) {
    const raw = asRecord(parsed)!
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'mcp'
    return [{ name, raw }]
  }
  return []
}

function mapTransport(raw: Record<string, unknown>): McpTransport {
  const explicit = raw.transport ?? raw.type
  if (explicit === 'sse' || explicit === 'http' || explicit === 'stdio') return explicit
  if (typeof raw.command === 'string' && raw.command.trim()) return 'stdio'
  if (explicit === 'streamable-http') return 'http'
  return 'http'
}

function mapServer(name: string, raw: Record<string, unknown>): { mcp: McpSourceConfig; cwdDropped?: string } {
  const transport = mapTransport(raw)
  const mcp: McpSourceConfig = { transport }
  if (transport === 'stdio') {
    mcp.command = String(raw.command)
    if (Array.isArray(raw.args)) mcp.args = raw.args.map(String)
  } else if (typeof raw.url === 'string') {
    mcp.url = raw.url
  }
  if (asRecord(raw.env)) mcp.env = Object.fromEntries(
    Object.entries(asRecord(raw.env)!).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
  if (asRecord(raw.headers)) mcp.headers = Object.fromEntries(
    Object.entries(asRecord(raw.headers)!).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
  const cwd = typeof raw.cwd === 'string' ? raw.cwd : undefined
  return { mcp, cwdDropped: cwd }
}

function existingSourceSlugs(workspaceRootPath: string): Set<string> {
  const dir = getWorkspaceSourcesPath(workspaceRootPath)
  const slugs = new Set<string>()
  if (!existsSync(dir)) return slugs
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && isSafeResourceSlug(entry.name)) slugs.add(entry.name)
  }
  return slugs
}

export function parseMcpImportJson(raw: string, workspaceRootPath: string): McpImportCandidate[] {
  if (!raw.trim()) {
    throw new Error('The MCP JSON file is empty')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('The selected file is not valid JSON')
  }

  const entries = collectServerEntries(parsed)
  if (entries.length === 0) {
    throw new Error('No MCP servers were found in this JSON')
  }

  const existing = existingSourceSlugs(workspaceRootPath)

  return entries.map(({ name, raw }, index) => {
    const { mcp: mapped, cwdDropped } = mapServer(name, raw)
    const draft = {
      id: `preview-${index}`,
      name,
      slug: slugify(name),
      enabled: true,
      provider: name,
      type: 'mcp' as const,
      mcp: mapped,
    }
    const redactions: ResourceRedaction[] = []
    const sanitized = sanitizeSourceConfig(draft, redactions).config
    const mcp = sanitized.mcp || mapped
    const strippedEnv = Boolean(mapped.env && Object.keys(mapped.env).length > 0 && !mcp.env)
    const needsAuth = strippedEnv
      || (mcp.authType !== undefined && mcp.authType !== 'none')
      || redactions.some(item => item.reason === 'credential' || item.reason === 'secret-header' || item.reason === 'secret-env')
    const suggestedSlug = slugify(name)
    return {
      key: `${suggestedSlug}:${index}`,
      name,
      suggestedSlug,
      conflict: existing.has(suggestedSlug),
      mcp,
      redactions: [...new Set(redactions.map(item => item.path))],
      needsAuth,
      ...(cwdDropped ? { cwdDropped } : {}),
    }
  })
}

export async function importMcpCandidates(
  workspaceRootPath: string,
  candidates: McpImportCandidate[],
  decisions: McpImportDecision[],
): Promise<{ imported: string[]; skipped: string[] }> {
  const imported: string[] = []
  const skipped: string[] = []
  const decisionByKey = new Map(decisions.map(item => [item.key, item]))

  for (const candidate of candidates) {
    const decision = decisionByKey.get(candidate.key)
    const action = decision?.action ?? (candidate.conflict ? 'skip' : 'overwrite')
    if (action === 'skip') {
      skipped.push(candidate.name)
      continue
    }

    let name = candidate.name
    if (action === 'rename') {
      const renamed = decision?.renameTo?.trim()
      if (!renamed) throw new Error(`Rename is required for ${candidate.name}`)
      name = renamed
    } else if (
      action === 'overwrite'
      && existingSourceSlugs(workspaceRootPath).has(candidate.suggestedSlug)
    ) {
      deleteSource(workspaceRootPath, candidate.suggestedSlug)
    }

    const input: CreateSourceInput = {
      name,
      provider: name,
      type: 'mcp',
      mcp: candidate.mcp,
      enabled: !candidate.needsAuth,
    }
    const created = await createSource(workspaceRootPath, input)
    if (candidate.needsAuth) {
      created.enabled = false
      created.connectionStatus = 'needs_auth'
      saveSourceConfig(workspaceRootPath, created)
    }
    imported.push(created.slug)
  }

  return { imported, skipped }
}
