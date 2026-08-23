/**
 * Import Agent Skills from SKILL.md or a Zip package (#82).
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { unzipSync } from 'fflate'
import matter from 'gray-matter'
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts'
import { invalidateSkillsCache, loadSkillBySlug } from '../skills/storage.ts'
import { isSafeResourceSlug } from './copy-between-workspaces.ts'
import { stagedDirectoryReplace } from '../utils/fs-stage.ts'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

export type ExternalImportAction = 'skip' | 'overwrite' | 'rename'

export interface SkillImportPreview {
  name: string
  description: string
  suggestedSlug: string
  conflict: boolean
  files: string[]
}

export interface SkillImportDecision {
  action: ExternalImportAction
  renameTo?: string
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50)
  return slug || 'skill'
}

function existingSkillSlugs(workspaceRootPath: string): Set<string> {
  const dir = getWorkspaceSkillsPath(workspaceRootPath)
  const slugs = new Set<string>()
  if (!existsSync(dir)) return slugs
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && isSafeResourceSlug(entry.name)) slugs.add(entry.name)
  }
  return slugs
}

function parseSkillMarkdown(content: string): { name: string; description: string; body: string } {
  let parsed: ReturnType<typeof matter>
  try {
    parsed = matter(content)
  } catch {
    throw new Error('Could not parse SKILL.md')
  }
  const name = typeof parsed.data.name === 'string' ? parsed.data.name.trim() : ''
  const description = typeof parsed.data.description === 'string' ? parsed.data.description.trim() : ''
  if (!name || !description) {
    throw new Error('SKILL.md is missing required frontmatter name or description')
  }
  return { name, description, body: parsed.content }
}

function assertSafeZipPath(entry: string): string {
  const normalized = entry.replace(/\\/g, '/')
  if (!normalized || normalized.endsWith('/')) return normalized
  if (
    normalized.startsWith('/')
    || normalized.includes('..')
    || /^[a-zA-Z]:/.test(normalized)
    || normalized.includes('\0')
  ) {
    throw new Error(`Zip entry is not allowed: ${entry}`)
  }
  return normalized
}

function findSkillRoot(paths: string[]): string {
  const files = paths.map(assertSafeZipPath).filter(path => path && !path.endsWith('/'))
  if (files.includes('SKILL.md')) return ''
  const nested = files.filter(path => {
    const parts = path.split('/')
    return parts.length === 2 && parts[1] === 'SKILL.md'
  })
  if (nested.length === 1) return `${nested[0]!.split('/')[0]}/`
  throw new Error('The zip does not contain a SKILL.md at the root or one folder down')
}

export function previewSkillMarkdown(content: string, workspaceRootPath: string): SkillImportPreview {
  const parsed = parseSkillMarkdown(content)
  const suggestedSlug = slugify(parsed.name)
  return {
    name: parsed.name,
    description: parsed.description,
    suggestedSlug,
    conflict: existingSkillSlugs(workspaceRootPath).has(suggestedSlug),
    files: ['SKILL.md'],
  }
}

export function previewSkillZip(buffer: Uint8Array, workspaceRootPath: string): {
  preview: SkillImportPreview
  files: Record<string, Uint8Array>
} {
  let unzipped: Record<string, Uint8Array>
  try {
    unzipped = unzipSync(buffer)
  } catch {
    throw new Error('The zip file is damaged or is not a zip archive')
  }
  const root = findSkillRoot(Object.keys(unzipped))
  const files: Record<string, Uint8Array> = {}
  for (const [entry, data] of Object.entries(unzipped)) {
    const normalized = assertSafeZipPath(entry)
    if (!normalized || normalized.endsWith('/')) continue
    if (root && !normalized.startsWith(root)) continue
    const relative = root ? normalized.slice(root.length) : normalized
    if (!relative || relative.endsWith('/')) continue
    files[relative] = data
  }
  const skillMd = files['SKILL.md']
  if (!skillMd) throw new Error('The zip does not contain a SKILL.md')
  const parsed = parseSkillMarkdown(new TextDecoder().decode(skillMd))
  const suggestedSlug = slugify(parsed.name)
  return {
    preview: {
      name: parsed.name,
      description: parsed.description,
      suggestedSlug,
      conflict: existingSkillSlugs(workspaceRootPath).has(suggestedSlug),
      files: Object.keys(files).sort(),
    },
    files,
  }
}

function writeSkillFiles(workspaceRootPath: string, slug: string, files: Record<string, Uint8Array>): void {
  if (!isSafeResourceSlug(slug)) throw new Error(`Invalid skill slug: ${slug}`)
  const dest = join(getWorkspaceSkillsPath(workspaceRootPath), slug)
  const stage = join(tmpdir(), `selection-skill-import-${randomUUID()}`)
  mkdirSync(stage, { recursive: true })
  try {
    for (const [relative, data] of Object.entries(files)) {
      const safeRelative = assertSafeZipPath(relative)
      const target = join(stage, safeRelative)
      if (!target.startsWith(stage)) throw new Error(`Zip entry is not allowed: ${relative}`)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, data)
    }
    stagedDirectoryReplace(stage, dest)
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
  invalidateSkillsCache()
  if (!loadSkillBySlug(workspaceRootPath, slug)) {
    rmSync(dest, { recursive: true, force: true })
    throw new Error('Imported skill could not be loaded. The workspace was left unchanged.')
  }
}

export function importSkillMarkdown(
  workspaceRootPath: string,
  content: string,
  decision: SkillImportDecision,
): { slug: string; skipped: boolean } {
  const preview = previewSkillMarkdown(content, workspaceRootPath)
  return applySkillImport(workspaceRootPath, preview, { 'SKILL.md': new TextEncoder().encode(content) }, decision)
}

export function importSkillZip(
  workspaceRootPath: string,
  buffer: Uint8Array,
  decision: SkillImportDecision,
): { slug: string; skipped: boolean } {
  const { preview, files } = previewSkillZip(buffer, workspaceRootPath)
  return applySkillImport(workspaceRootPath, preview, files, decision)
}

function applySkillImport(
  workspaceRootPath: string,
  preview: SkillImportPreview,
  files: Record<string, Uint8Array>,
  decision: SkillImportDecision,
): { slug: string; skipped: boolean } {
  if (decision.action === 'skip') return { slug: preview.suggestedSlug, skipped: true }
  let slug = preview.suggestedSlug
  if (decision.action === 'rename') {
    const renamed = decision.renameTo?.trim()
    if (!renamed) throw new Error('Rename is required')
    slug = slugify(renamed)
  }
  if (decision.action === 'overwrite' && existingSkillSlugs(workspaceRootPath).has(preview.suggestedSlug)) {
    rmSync(join(getWorkspaceSkillsPath(workspaceRootPath), preview.suggestedSlug), { recursive: true, force: true })
  } else if (decision.action !== 'overwrite' && existingSkillSlugs(workspaceRootPath).has(slug)) {
    throw new Error(`Skill '${slug}' already exists`)
  }
  writeSkillFiles(workspaceRootPath, slug, files)
  return { slug, skipped: false }
}
