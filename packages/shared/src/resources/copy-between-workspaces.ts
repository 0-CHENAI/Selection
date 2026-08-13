/**
 * Copy workspace resources (sources / skills) between local workspaces.
 *
 * Unlike export→import bundles, this is a direct filesystem copy that preserves
 * headers, env stubs, auth state fields, and (optionally) credential-store secrets.
 * Intended for single-user local transfers — not for portable/shareable bundles.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  statSync,
} from 'fs'
import { join, basename } from 'path'
import { getWorkspaceSourcesPath, getWorkspaceSkillsPath } from '../workspaces/storage.ts'
import { getSourcePath } from '../sources/storage.ts'
import { isBuiltinSource } from '../sources/builtin-sources.ts'
import { resolveFsPath } from '../utils/paths.ts'
import { stagedDirectoryReplace } from '../utils/fs-stage.ts'
import type { ResourceImportMode, ImportBucketResult, ResourceImportResult } from './types.ts'
import type { FolderSourceConfig } from '../sources/types.ts'

export interface CopyBetweenWorkspacesOptions {
  fromRootPath: string
  toRootPath: string
  /** Credential scope keys = basename(workspace root) */
  fromCredentialWorkspaceId: string
  toCredentialWorkspaceId: string
  /** Source slugs to copy, or 'all' */
  sources?: string[] | 'all'
  /** Skill slugs to copy, or 'all' */
  skills?: string[] | 'all'
  mode: ResourceImportMode
  /** Copy credential-store secrets for sources (default true) */
  includeCredentials?: boolean
}

export interface CopyBetweenWorkspacesDeps {
  /**
   * Copy all source credential types from one workspace scope to another for a slug.
   * @returns true if at least one credential was copied
   */
  copySourceCredentials: (
    fromWorkspaceId: string,
    toWorkspaceId: string,
    sourceSlug: string,
  ) => Promise<boolean>
  /** Clear all credential types for a source in a workspace (used on overwrite) */
  clearSourceCredentials: (workspaceId: string, sourceSlug: string) => Promise<void>
}

function emptyBucket(): ImportBucketResult {
  return { imported: [], skipped: [], failed: [], warnings: [] }
}

/**
 * Reject path traversal and hidden/tmp directory names.
 * Source/skill folder names must be single path segments.
 */
export function isSafeResourceSlug(slug: string): boolean {
  if (!slug || slug.length > 200) return false
  if (slug === '.' || slug === '..') return false
  if (slug.startsWith('.')) return false
  if (slug.includes('/') || slug.includes('\\') || slug.includes('\0')) return false
  // Windows reserved / drive-like
  if (/^[a-zA-Z]:/.test(slug)) return false
  return true
}

function listSubdirs(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isSafeResourceSlug(e.name))
    .map((e) => e.name)
}

function resolveSelection(dir: string, selection: string[] | 'all'): string[] {
  if (selection === 'all') return listSubdirs(dir)
  return selection
}

function requiresAuth(config: FolderSourceConfig): boolean {
  const authType = config.mcp?.authType || config.api?.authType
  return Boolean(authType && authType !== 'none')
}

/**
 * Adjust auth flags on the copied config.json so UI state matches credentials.
 *
 * - includeCredentials + store secrets landed → mark connected
 * - credentials intentionally not copied + source requires auth → needs_auth
 *   (avoids "connected" badge with no usable secrets)
 * - otherwise leave filesystem copy as-is (e.g. header-only / no-auth sources)
 */
function applyAuthAfterCopy(
  targetSourceDir: string,
  includeCredentials: boolean,
  hadCredentials: boolean,
): void {
  const configPath = join(targetSourceDir, 'config.json')
  if (!existsSync(configPath)) return
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as FolderSourceConfig

    if (includeCredentials && hadCredentials) {
      config.isAuthenticated = true
      config.connectionStatus = 'connected'
      config.connectionError = undefined
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
      return
    }

    if (!includeCredentials && requiresAuth(config)) {
      config.isAuthenticated = false
      config.connectionStatus = 'needs_auth'
      config.connectionError = undefined
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Copy sources and skills between two local workspace roots.
 */
export async function copyBetweenWorkspaces(
  options: CopyBetweenWorkspacesOptions,
  deps: CopyBetweenWorkspacesDeps,
): Promise<ResourceImportResult> {
  // Resolve + NFC-normalize roots so Chinese folder paths work reliably on
  // macOS (NFD filesystem) and when paths were stored with ~ / mixed seps.
  const normalized: CopyBetweenWorkspacesOptions = {
    ...options,
    fromRootPath: resolveFsPath(options.fromRootPath),
    toRootPath: resolveFsPath(options.toRootPath),
  }

  const includeCredentials = normalized.includeCredentials !== false
  const sourcesResult = normalized.sources !== undefined
    ? await copySources(normalized, deps, includeCredentials)
    : emptyBucket()
  const skillsResult = normalized.skills !== undefined
    ? copySkills(normalized)
    : emptyBucket()

  return {
    sources: sourcesResult,
    skills: skillsResult,
    automations: emptyBucket(),
  }
}

async function copySources(
  options: CopyBetweenWorkspacesOptions,
  deps: CopyBetweenWorkspacesDeps,
  includeCredentials: boolean,
): Promise<ImportBucketResult> {
  const result = emptyBucket()
  const fromDir = getWorkspaceSourcesPath(options.fromRootPath)
  const toDir = getWorkspaceSourcesPath(options.toRootPath)
  const slugs = resolveSelection(fromDir, options.sources!)

  if (!existsSync(toDir)) {
    mkdirSync(toDir, { recursive: true })
  }

  for (const slug of slugs) {
    try {
      if (!isSafeResourceSlug(slug)) {
        result.failed.push({ id: slug, error: 'Invalid source slug' })
        continue
      }

      if (isBuiltinSource(slug)) {
        result.failed.push({ id: slug, error: 'Cannot copy builtin source slug' })
        continue
      }

      const fromPath = getSourcePath(options.fromRootPath, slug)
      if (!existsSync(fromPath)) {
        result.failed.push({ id: slug, error: 'Source not found in source workspace' })
        continue
      }

      // Guard against accidental file (not directory) at source path
      if (!statSync(fromPath).isDirectory()) {
        result.failed.push({ id: slug, error: 'Source path is not a directory' })
        continue
      }

      const toPath = getSourcePath(options.toRootPath, slug)
      const exists = existsSync(toPath)

      if (exists && options.mode === 'skip') {
        result.skipped.push(slug)
        continue
      }

      // Clear target credentials before replacing (overwrite only; new copy has none)
      if (exists) {
        try {
          await deps.clearSourceCredentials(options.toCredentialWorkspaceId, slug)
        } catch (err) {
          result.warnings.push(`Source '${slug}': failed to clear target credentials: ${err}`)
        }
      }

      // Stage then rename (Windows-safe fallback for Chinese paths)
      stagedDirectoryReplace(fromPath, toPath)

      let hadCreds = false
      if (includeCredentials) {
        try {
          hadCreds = await deps.copySourceCredentials(
            options.fromCredentialWorkspaceId,
            options.toCredentialWorkspaceId,
            slug,
          )
        } catch (err) {
          result.warnings.push(`Source '${slug}': failed to copy credentials: ${err}`)
        }
      }

      applyAuthAfterCopy(toPath, includeCredentials, hadCreds)
      result.imported.push(slug)
    } catch (err) {
      result.failed.push({
        id: slug,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}

function copySkills(options: CopyBetweenWorkspacesOptions): ImportBucketResult {
  const result = emptyBucket()
  const fromDir = getWorkspaceSkillsPath(options.fromRootPath)
  const toDir = getWorkspaceSkillsPath(options.toRootPath)
  const slugs = resolveSelection(fromDir, options.skills!)

  if (!existsSync(toDir)) {
    mkdirSync(toDir, { recursive: true })
  }

  for (const slug of slugs) {
    try {
      if (!isSafeResourceSlug(slug)) {
        result.failed.push({ id: slug, error: 'Invalid skill slug' })
        continue
      }

      const fromPath = join(fromDir, slug)
      if (!existsSync(fromPath)) {
        result.failed.push({ id: slug, error: 'Skill not found in source workspace' })
        continue
      }

      const toPath = join(toDir, slug)
      const exists = existsSync(toPath)

      if (exists && options.mode === 'skip') {
        result.skipped.push(slug)
        continue
      }

      // Stage then rename (Windows-safe fallback for Chinese paths)
      stagedDirectoryReplace(fromPath, toPath)
      result.imported.push(slug)
    } catch (err) {
      result.failed.push({
        id: slug,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}

/** Credential scope id used by the source credential store for a workspace root. */
export function credentialWorkspaceIdFromRoot(rootPath: string): string {
  return basename(rootPath)
}
