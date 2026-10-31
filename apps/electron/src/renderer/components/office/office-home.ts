import type { OfficeRequest } from '@craft-agent/shared/protocol'
import { routes, type Route } from '@/lib/navigate'

export const OFFICE_HOME_SECTIONS = ['ppt', 'word', 'excel'] as const
export type OfficeHomeSection = (typeof OFFICE_HOME_SECTIONS)[number]

let lastSection: OfficeHomeSection = 'ppt'

/** Last section chosen in this window. Routes still override it when opened directly. */
export function readOfficeSection(): OfficeHomeSection {
  return lastSection
}

export function rememberOfficeSection(section: OfficeHomeSection) {
  lastSection = section
}

let focusSwitcherOnNextMount = false

export function requestOfficeSwitcherFocus() {
  focusSwitcherOnNextMount = true
}

export function consumeOfficeSwitcherFocus() {
  const pending = focusSwitcherOnNextMount
  focusSwitcherOnNextMount = false
  return pending
}

export function nextOfficeSection(current: OfficeHomeSection, key: string): OfficeHomeSection | null {
  const index = OFFICE_HOME_SECTIONS.indexOf(current)
  if (key === 'ArrowRight' || key === 'ArrowDown') return OFFICE_HOME_SECTIONS[(index + 1) % OFFICE_HOME_SECTIONS.length]
  if (key === 'ArrowLeft' || key === 'ArrowUp') return OFFICE_HOME_SECTIONS[(index + OFFICE_HOME_SECTIONS.length - 1) % OFFICE_HOME_SECTIONS.length]
  if (key === 'Home') return 'ppt'
  if (key === 'End') return 'excel'
  return null
}

export function casesForOfficeHome<T extends { mode: string; category?: string }>(cases: T[], section: 'word' | 'excel'): T[] {
  return cases.filter(item => item.mode === section && (section === 'excel' || item.category !== 'Selection 样例'))
}

export function resolveOfficeDraftRequest(section: OfficeHomeSection, picked: OfficeRequest | null | undefined): OfficeRequest | undefined {
  if (section !== 'word' && section !== 'excel') return undefined
  if (picked?.mode === section && picked.templateId && picked.revision) {
    return { mode: section, templateId: picked.templateId, revision: picked.revision }
  }
  return { mode: section }
}

export function officeSessionSection(session: { ppt?: unknown; office?: { mode?: string } | null }): OfficeHomeSection | null {
  if (session.ppt !== undefined) return 'ppt'
  if (session.office?.mode === 'word' || session.office?.mode === 'excel') return session.office.mode
  return null
}

export function officeSessionRoute(session: { id: string; ppt?: unknown; office?: { mode?: string } | null }): Route {
  const section = officeSessionSection(session)
  if (section === 'word' || section === 'excel') return routes.view.office(section, session.id)
  return routes.view.ppt(session.id)
}

/**
 * 「做同款」: the catalog prompt goes into the composer with its first
 * 【…】 placeholder selected, so typing replaces it. Never sent automatically.
 * Text the person already typed is kept above the prompt.
 */
export function sameStyleDraft(prompt: string | undefined, existing = ''): { text: string; selection: { start: number; end: number } } | null {
  const body = prompt?.trim()
  if (!body) return null
  const kept = existing.trimEnd()
  const prefix = kept ? `${kept}\n\n` : ''
  const text = `${prefix}${body}`
  const placeholder = /【[^】\n]{1,40}】/.exec(body)
  if (!placeholder) return { text, selection: { start: text.length, end: text.length } }
  const start = prefix.length + placeholder.index
  return { text, selection: { start, end: start + placeholder[0].length } }
}
