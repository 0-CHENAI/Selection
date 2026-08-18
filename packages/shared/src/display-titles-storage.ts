/**
 * Workspace-scoped display-title overlay persistence.
 *
 * Aliases live in `{workspaceRoot}/display-titles.json` so they survive
 * skill upgrades (SKILL.md frontmatter is never rewritten) and do not
 * change MCP server IDs or skill slugs.
 *
 * Node-only. Renderer code must import helpers from `display-titles.ts`.
 */

import { existsSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { atomicWriteFileSync, readJsonFileSync } from './utils/files.ts'
import {
  DISPLAY_TITLES_FILE,
  DisplayTitleValidationError,
  normalizeDisplayTitle,
  type DisplayTitleKind,
  type DisplayTitlesFile,
} from './display-titles.ts'

function emptyFile(): DisplayTitlesFile {
  return { sources: {}, skills: {} }
}

function sanitizeMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || typeof value !== 'string') continue
    const normalized = normalizeDisplayTitle(value)
    if (normalized.ok && normalized.value) out[id] = normalized.value
  }
  return out
}

function getFilePath(workspaceRoot: string): string {
  return join(workspaceRoot, DISPLAY_TITLES_FILE)
}

let loadedCache: { filePath: string; mtimeMs: number; data: DisplayTitlesFile } | null = null

function invalidateLoadedCache(): void {
  loadedCache = null
}

export function loadDisplayTitles(workspaceRoot: string): DisplayTitlesFile {
  const path = getFilePath(workspaceRoot)
  if (!existsSync(path)) {
    if (loadedCache?.filePath === path) invalidateLoadedCache()
    return emptyFile()
  }
  try {
    const mtimeMs = statSync(path).mtimeMs
    if (loadedCache?.filePath === path && loadedCache.mtimeMs === mtimeMs) {
      return loadedCache.data
    }
    const parsed = readJsonFileSync<unknown>(path)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyFile()
    const data = parsed as { sources?: unknown; skills?: unknown }
    const loaded = {
      sources: sanitizeMap(data.sources),
      skills: sanitizeMap(data.skills),
    }
    loadedCache = { filePath: path, mtimeMs, data: loaded }
    return loaded
  } catch {
    invalidateLoadedCache()
    return emptyFile()
  }
}

function saveDisplayTitles(workspaceRoot: string, data: DisplayTitlesFile): void {
  invalidateLoadedCache()
  const path = getFilePath(workspaceRoot)
  const sources = data.sources
  const skills = data.skills
  if (Object.keys(sources).length === 0 && Object.keys(skills).length === 0) {
    if (existsSync(path)) unlinkSync(path)
    return
  }
  atomicWriteFileSync(path, `${JSON.stringify({ sources, skills }, null, 2)}\n`)
}

export function getDisplayTitle(
  workspaceRoot: string,
  kind: DisplayTitleKind,
  id: string,
): string | undefined {
  const value = loadDisplayTitles(workspaceRoot)[kind][id]
  return value || undefined
}

export function setDisplayTitle(
  workspaceRoot: string,
  kind: DisplayTitleKind,
  id: string,
  raw: string | null | undefined,
  defaultName?: string,
): string | null {
  if (!id.trim()) throw new Error('Display title id is required')
  const normalized = normalizeDisplayTitle(raw, defaultName)
  if (!normalized.ok) throw new DisplayTitleValidationError()

  const data = loadDisplayTitles(workspaceRoot)
  const map = { ...data[kind] }
  if (normalized.value === null) {
    delete map[id]
  } else {
    map[id] = normalized.value
  }
  saveDisplayTitles(workspaceRoot, { ...data, [kind]: map })
  return normalized.value
}

export function clearDisplayTitle(
  workspaceRoot: string,
  kind: DisplayTitleKind,
  id: string,
): void {
  setDisplayTitle(workspaceRoot, kind, id, null)
}

export function copyDisplayTitle(
  fromRoot: string,
  toRoot: string,
  kind: DisplayTitleKind,
  id: string,
): void {
  setDisplayTitle(toRoot, kind, id, getDisplayTitle(fromRoot, kind, id) ?? null)
}
