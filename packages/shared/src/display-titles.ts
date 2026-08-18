/**
 * Display-title helpers for sources and skills.
 *
 * This module is browser-safe (no Node.js APIs). Filesystem overlay
 * operations live in `display-titles-storage.ts`.
 */

export const DISPLAY_TITLE_MAX_LENGTH = 80
export const DISPLAY_TITLES_FILE = 'display-titles.json'

export type DisplayTitleKind = 'sources' | 'skills'

export interface DisplayTitlesFile {
  sources: Record<string, string>
  skills: Record<string, string>
}

export class DisplayTitleValidationError extends Error {
  readonly code = 'too_long' as const

  constructor() {
    super(`Display title must be ${DISPLAY_TITLE_MAX_LENGTH} characters or fewer`)
    this.name = 'DisplayTitleValidationError'
  }
}

export function normalizeDisplayTitle(
  raw: string | null | undefined,
  defaultName?: string,
): { ok: true; value: string | null } | { ok: false; error: 'too_long' } {
  if (raw == null) return { ok: true, value: null }
  const value = raw.trim()
  if (!value) return { ok: true, value: null }
  if (value.length > DISPLAY_TITLE_MAX_LENGTH) return { ok: false, error: 'too_long' }
  if (defaultName != null && value === defaultName.trim()) return { ok: true, value: null }
  return { ok: true, value }
}

export function resolveSourceTitle(source: {
  displayTitle?: string
  config: { name: string }
}): string {
  return source.displayTitle?.trim() || source.config.name
}

export function resolveSkillTitle(skill: {
  displayTitle?: string
  metadata: { name: string }
}): string {
  return skill.displayTitle?.trim() || skill.metadata.name
}

/** Agent-facing label: keep the slug callable, show the alias when present. */
export function formatSourceRef(source: {
  displayTitle?: string
  config: { name: string; slug: string }
}): string {
  const alias = source.displayTitle?.trim()
  if (alias && alias !== source.config.slug) {
    return `${alias} [${source.config.slug}]`
  }
  return source.config.slug
}

export function matchesTitleSearch(query: string, ...fields: Array<string | undefined>): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return fields.some((field) => field?.toLowerCase().includes(q))
}

export function sourceTitleSearchText(source: {
  displayTitle?: string
  config: { name: string; slug: string }
}): string {
  return [resolveSourceTitle(source), source.config.name, source.config.slug].join('\n')
}

export function skillTitleSearchText(skill: {
  displayTitle?: string
  slug: string
  metadata: { name: string }
}): string {
  return [resolveSkillTitle(skill), skill.metadata.name, skill.slug].join('\n')
}
