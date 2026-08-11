import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import type { LoadedSkill, LoadedSource, FileSearchResult } from '../../../shared/types'

// ============================================================================
// Types
// ============================================================================

export type MentionItemType = 'skill' | 'source' | 'file' | 'folder'

export interface MentionItem {
  id: string
  type: MentionItemType
  label: string
  description?: string
  // Type-specific data
  skill?: LoadedSkill
  source?: LoadedSource
  file?: { path: string; type: 'file' | 'directory'; relativePath: string }
}

export interface MentionSection {
  id: string
  label: string
  items: MentionItem[]
}

export interface InlineMentionMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sections: MentionSection[]
  onSelect: (item: MentionItem) => void
  filter?: string
  position: { x: number; y: number }
  workspaceId?: string
  maxWidth?: number
  className?: string
  /** Whether file search is in progress */
  isSearching?: boolean
}

// ============================================================================
// Shared Styles
// ============================================================================

const MENU_CONTAINER_STYLE = 'overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small'
const MENU_LIST_STYLE = 'max-h-[240px] overflow-y-auto py-1'
// min-w-0 is required so flex children can shrink and apply text-overflow: ellipsis
const MENU_ITEM_STYLE = 'flex cursor-pointer select-none items-center gap-3 rounded-[6px] mx-1 px-2 py-1.5 text-[13px] min-w-0'
const MENU_ITEM_SELECTED = 'bg-foreground/5'
// Type badge shown to the right of each item label (e.g. "Skill", "Source")
const MENU_TYPE_BADGE = 'rounded-[4px] shadow-minimal bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground shrink-0'

// ============================================================================
// Path utilities
// ============================================================================

/** Extract parent directory from a relative path (e.g. "src/components/Button.tsx" → "src/components/") */
function getParentDir(relativePath: string): string {
  const lastSlash = relativePath.lastIndexOf('/')
  if (lastSlash <= 0) return ''
  return relativePath.slice(0, lastSlash + 1)
}

/** Check if query characters appear in order within target.
 *  Returns true if all characters of query are found sequentially in target.
 *  Note: comparison is literal — pass lowercased inputs for case-insensitive matching. */
function subsequenceMatch(target: string, query: string): boolean {
  let qi = 0
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++
  }
  return qi === query.length
}

/**
 * Score a file/folder name+path against a query (higher = better).
 * 5 = exact name match
 * 4 = name starts with query
 * 3 = name contains query (or word-boundary)
 * 2 = path contains query
 * 1 = subsequence match on name/path
 * 0 = no match
 */
export function scoreFileMatch(name: string, relativePath: string, query: string): number {
  const lowerQuery = query.trimEnd().toLowerCase()
  if (!lowerQuery) return 0
  const lowerName = name.toLowerCase()
  const lowerPath = relativePath.toLowerCase()

  if (lowerName === lowerQuery) return 5
  if (lowerName.startsWith(lowerQuery)) return 4
  if (lowerName.includes(lowerQuery)) return 3
  // Word-boundary-ish: match after separators in name
  if (new RegExp(`[\\s\\-_.]${escapeRegExp(lowerQuery)}`).test(lowerName)) return 3
  if (lowerPath.includes(lowerQuery)) return 2
  if (subsequenceMatch(lowerName, lowerQuery) || subsequenceMatch(lowerPath, lowerQuery)) return 1
  return 0
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Convert FileSearchResults to MentionItems (no ranking). */
function toMentionItems(results: FileSearchResult[]): MentionItem[] {
  return results.map(f => ({
    id: f.path,
    type: f.type === 'directory' ? 'folder' as const : 'file' as const,
    label: f.name,
    description: f.relativePath,
    file: { path: f.path, type: f.type, relativePath: f.relativePath },
  }))
}

/**
 * Default @ popup listing when the user has not typed a query yet:
 * alphabetical by name (files before folders), capped for a compact menu.
 */
export function defaultFileListing(cache: FileSearchResult[], limit = 20): MentionItem[] {
  const sorted = [...cache].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'file' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  })
  return toMentionItems(sorted.slice(0, limit))
}

/** Filter cached FileSearchResults by query and convert to MentionItems.
 *  Prefer exact / prefix name matches, then substring, then subsequence
 *  (so "appav" still finds "app availability.md").
 *  Empty query → alphabetical default listing so bare `@` is not an empty menu. */
export function filterCacheResults(cache: FileSearchResult[], query: string): MentionItem[] {
  const lowerQuery = query.trimEnd().toLowerCase()
  if (!lowerQuery) return defaultFileListing(cache)

  const scored = cache
    .map(f => ({ f, score: scoreFileMatch(f.name, f.relativePath, lowerQuery) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      // Prefer shorter names, then alphabetical — tighter matches first
      if (a.f.name.length !== b.f.name.length) return a.f.name.length - b.f.name.length
      return a.f.name.localeCompare(b.f.name, undefined, { sensitivity: 'base', numeric: true })
    })
    .slice(0, 20)

  return toMentionItems(scored.map(({ f }) => f))
}

// ============================================================================
// Filter utilities
// ============================================================================

/**
 * Get match priority score for filtering (higher = better match)
 * 3 = starts with filter (first word)
 * 2 = word boundary match (2nd+ word after space/hyphen/underscore)
 * 1 = contains filter (mid-word)
 * 0 = no match
 */
function getMatchScore(text: string, filter: string): number {
  const lowerText = text.toLowerCase()
  // Best: starts with filter (first word)
  if (lowerText.startsWith(filter)) return 3
  // Good: word boundary match (after space/hyphen/underscore)
  const wordBoundaryPattern = new RegExp(`[\\s\\-_]${escapeRegExp(filter)}`)
  if (wordBoundaryPattern.test(lowerText)) return 2
  // OK: contains filter anywhere
  if (lowerText.includes(filter)) return 1
  return 0
}

/** True for filesystem mention items (should rank above skills/sources when typing a path-like query). */
function isFileLike(item: MentionItem): boolean {
  return item.type === 'file' || item.type === 'folder'
}

/**
 * Best match score for a mention item against the filter.
 * File/folder items also score their relative path (description).
 */
function getItemMatchScore(item: MentionItem, lowerFilter: string): number {
  if (isFileLike(item)) {
    return scoreFileMatch(item.label, item.description || item.file?.relativePath || '', lowerFilter)
  }
  return Math.max(
    getMatchScore(item.label, lowerFilter),
    getMatchScore(item.id, lowerFilter),
    item.description ? getMatchScore(item.description, lowerFilter) : 0,
  )
}

/**
 * Filter and rank mention sections for the active @ query.
 *
 * Files/folders always rank above skills/sources so path queries surface
 * filesystem hits at the top of the popup. When any file matches, skills and
 * sources are still included after files (lower priority), not interleaved.
 */
export function filterSections(sections: MentionSection[], filter: string): MentionSection[] {
  if (!filter) {
    // No query yet: still put the Files section first if present, then skills/sources.
    const files = sections.filter(s => s.id === 'files')
    const rest = sections.filter(s => s.id !== 'files')
    return files.length > 0 ? [...files, ...rest] : sections
  }
  const lowerFilter = filter.trimEnd().toLowerCase()
  if (!lowerFilter) {
    const files = sections.filter(s => s.id === 'files')
    const rest = sections.filter(s => s.id !== 'files')
    return files.length > 0 ? [...files, ...rest] : sections
  }

  // Collect all matching items across sections
  const allItems = sections.flatMap(section => section.items)
  const matchingItems = allItems.filter(item => getItemMatchScore(item, lowerFilter) > 0)

  // Sort: ALL files/folders first (by score), then skills/sources (by score)
  matchingItems.sort((a, b) => {
    const aFile = isFileLike(a)
    const bFile = isFileLike(b)
    if (aFile !== bFile) return aFile ? -1 : 1

    const aScore = getItemMatchScore(a, lowerFilter)
    const bScore = getItemMatchScore(b, lowerFilter)
    if (aScore !== bScore) return bScore - aScore

    // Prefer shorter labels within the same score (tighter name match)
    if (a.label.length !== b.label.length) return a.label.length - b.label.length
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  })

  // Return as flat list in a single virtual section (headers hidden when filtering)
  if (matchingItems.length === 0) return []
  return [{ id: 'results', label: 'Results', items: matchingItems }]
}

function flattenItems(sections: MentionSection[]): MentionItem[] {
  return sections.flatMap(section => section.items)
}

/**
 * Check if the @ character at the given position is a valid mention trigger.
 * Valid triggers are:
 * - @ at the start of input (position 0)
 * - @ preceded by whitespace (space, tab, newline)
 * - @ preceded by opening brackets or quotes: ( " '
 *
 * Invalid triggers (returns false):
 * - @ in the middle of a word (e.g., "test@example.com")
 * - @ preceded by alphanumeric or other characters
 *
 * @param textBeforeCursor - The text from start of input to cursor position
 * @param atPosition - The position of the @ character in textBeforeCursor
 * @returns true if this @ should trigger the mention menu
 */
export function isValidMentionTrigger(textBeforeCursor: string, atPosition: number): boolean {
  if (atPosition < 0) return false
  if (atPosition === 0) return true
  const charBefore = textBeforeCursor[atPosition - 1]
  if (charBefore === undefined) return false
  // Allow whitespace or opening brackets/quotes before @
  return /\s/.test(charBefore) || /[("']/.test(charBefore)
}

/**
 * Parse the active @-mention query just before the cursor.
 *
 * Query body allows Unicode letters/numbers (CJK included), marks, and common
 * path/filename characters. The previous ASCII-only `\w` class dropped the
 * entire match as soon as the user typed Chinese, so the menu closed and no
 * file search ran.
 *
 * @returns `{ atIndex, query }` or null when there is no valid open mention
 */
export function parseActiveMentionQuery(
  textBeforeCursor: string
): { atIndex: number; query: string } | null {
  // Exclude newline / brackets / @ so we don't swallow structured mention tokens
  // or cross lines. Everything else (incl. CJK, fullwidth chars) is valid query.
  const atMatch = textBeforeCursor.match(/@([^\n\[\]@]{0,100})?$/)
  if (!atMatch) return null
  const atIndex = textBeforeCursor.lastIndexOf('@')
  if (!isValidMentionTrigger(textBeforeCursor, atIndex)) return null
  return { atIndex, query: atMatch[1] ?? '' }
}

// ============================================================================
// InlineMentionMenu Component
// ============================================================================

export function InlineMentionMenu({
  open,
  onOpenChange,
  sections,
  onSelect,
  filter = '',
  position,
  workspaceId,
  maxWidth = 280,
  className,
}: InlineMentionMenuProps) {
  const { t } = useTranslation()
  const menuRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const filteredSections = filterSections(sections, filter)
  const flatItems = flattenItems(filteredSections)

  // Reset selection when filter changes
  React.useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  // Keyboard navigation
  // Don't attach listener when no items - allows Enter to propagate to input handler
  React.useEffect(() => {
    if (!open || flatItems.length === 0) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => (prev < flatItems.length - 1 ? prev + 1 : 0))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : flatItems.length - 1))
          break
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          if (flatItems[selectedIndex]) {
            onSelect(flatItems[selectedIndex])
            onOpenChange(false)
          }
          break
        case 'Escape':
          e.preventDefault()
          onOpenChange(false)
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, flatItems, selectedIndex, onSelect, onOpenChange])

  // Close on click outside
  React.useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, onOpenChange])

  // Scroll selected item into view when navigating with keyboard
  React.useEffect(() => {
    if (!listRef.current) return
    const selectedEl = listRef.current.querySelector('[data-selected="true"]')
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  if (!open) return null

  // Calculate bottom position from window height (menu appears above cursor)
  const bottomPosition = typeof window !== 'undefined'
    ? window.innerHeight - Math.round(position.y) + 8
    : 0

  return (
    <div
      ref={menuRef}
      data-inline-menu
      className={cn('fixed z-dropdown', MENU_CONTAINER_STYLE, className)}
      style={{
        left: Math.round(position.x) - 10,
        bottom: bottomPosition,
        width: maxWidth,
        maxWidth,
      }}
    >
      {/* Menu header — sticky above scroll area */}
      <div className="px-3 py-1.5 text-[12px] font-medium text-muted-foreground border-b border-foreground/5">
        {t('chat.mentionFiles')}
      </div>

      <div ref={listRef} className={MENU_LIST_STYLE}>
        {flatItems.length === 0 && filter && (
          <div className="px-3 py-2 text-[12px] text-muted-foreground/60">{t('chat.noResults')}</div>
        )}
        {flatItems.map((item, itemIndex) => {
          const isSelected = itemIndex === selectedIndex

          return (
            <div
              key={`${item.type}-${item.id}`}
              data-selected={isSelected}
              onClick={() => {
                onSelect(item)
                onOpenChange(false)
              }}
              onMouseEnter={() => setSelectedIndex(itemIndex)}
              className={cn(
                MENU_ITEM_STYLE,
                isSelected && MENU_ITEM_SELECTED
              )}
            >
              {/* Icon based on type */}
              <div className="shrink-0">
                {item.type === 'skill' && item.skill && (
                  <SkillAvatar skill={item.skill} size="sm" workspaceId={workspaceId} />
                )}
                {item.type === 'source' && item.source && (
                  <SourceAvatar source={item.source} size="sm" />
                )}
                {item.type === 'folder' && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" className="text-muted-foreground">
                    <path d="M20.5 10C20.5 9.07003 20.5 8.60504 20.3978 8.22354C20.1204 7.18827 19.3117 6.37962 18.2765 6.10222C17.895 6 17.43 6 16.5 6H13.1008C12.4742 6 12.1609 6 11.8739 5.91181C11.6824 5.85298 11.5009 5.76572 11.3353 5.65295C11.0871 5.48389 10.8914 5.23926 10.5 4.75L10.4095 4.63693C10.107 4.25881 9.9558 4.06975 9.7736 3.92674C9.54464 3.74703 9.27921 3.61946 8.99585 3.55294C8.77037 3.5 8.52825 3.5 8.04402 3.5C6.60485 3.5 5.88527 3.5 5.32008 3.74178C4.61056 4.0453 4.0453 4.61056 3.74178 5.32008C3.5 5.88527 3.5 6.60485 3.5 8.04402V10M9.46502 20.5H14.535C16.9102 20.5 18.0978 20.5 18.9301 19.8113C19.7624 19.1226 19.9846 17.9559 20.429 15.6227L20.8217 13.5613C21.1358 11.9121 21.2929 11.0874 20.843 10.5437C20.393 10 19.5536 10 17.8746 10H6.12537C4.44643 10 3.60696 10 3.15704 10.5437C2.70713 11.0874 2.8642 11.9121 3.17835 13.5613L3.57099 15.6227C4.01541 17.9559 4.23763 19.1226 5.06992 19.8113C5.90221 20.5 7.08981 20.5 9.46502 20.5Z"/>
                  </svg>
                )}
                {item.type === 'file' && (
                  <FileMenuIcon name={item.label} />
                )}
              </div>

              {/* Label and optional path/badge */}
              {(item.type === 'file' || item.type === 'folder') ? (
                // Long Chinese/English names: ellipsis + hover tooltip with full path
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <div className="flex-1 min-w-0">
                      <span className="block truncate">{item.label}</span>
                      {item.file?.relativePath && getParentDir(item.file.relativePath) ? (
                        <span className="block truncate text-[11px] text-muted-foreground opacity-50">
                          {getParentDir(item.file.relativePath)}
                        </span>
                      ) : null}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    sideOffset={8}
                    className="z-tooltip max-w-[360px] break-all text-left"
                  >
                    {item.file?.relativePath || item.label}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <>
                  {/* Skill/source: label with type badge */}
                  <div className="flex-1 min-w-0">
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <span className="truncate block">{item.label}</span>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8} className="z-tooltip max-w-[360px] break-all text-left">
                        {item.label}
                        {item.description ? (
                          <div className="mt-0.5 text-[11px] opacity-70">{item.description}</div>
                        ) : null}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <span className={MENU_TYPE_BADGE}>
                    {item.type === 'skill' ? t('common.skill') : t('common.source')}
                  </span>
                </>
              )}
            </div>
          )
        })}

      </div>
    </div>
  )
}

// ============================================================================
// File icon component - picks icon variant based on file extension
// ============================================================================

/** Known code file extensions that get the code file icon (< >) */
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rs', 'go', 'java', 'rb', 'swift', 'kt',
  'c', 'cpp', 'h', 'hpp', 'cs',
  'css', 'scss', 'less', 'html', 'vue', 'svelte',
  'json', 'yaml', 'yml', 'toml', 'xml',
  'sh', 'bash', 'zsh', 'fish',
  'md', 'mdx',
  'sql', 'graphql', 'proto',
])

/** Known image file extensions that get the image icon */
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff', 'tif', 'avif', 'heic', 'heif',
])

function getFileIconType(name: string): 'code' | 'image' | 'generic' {
  const ext = name.split('.').pop()?.toLowerCase()
  if (!ext) return 'generic'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  return 'generic'
}

/** Renders the appropriate file icon based on extension (code, image, or generic) */
function FileMenuIcon({ name }: { name: string }) {
  const iconType = getFileIconType(name)

  if (iconType === 'code') {
    // Code file icon (document with < > brackets)
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
        <path d="M10.5 2.5C12.1569 2.5 13.5 3.84315 13.5 5.5V6.1C13.5 6.4716 13.5 6.6574 13.5246 6.81287C13.6602 7.66865 14.3313 8.33983 15.1871 8.47538C15.3426 8.5 15.5284 8.5 15.9 8.5H16.5C18.1569 8.5 19.5 9.84315 19.5 11.5M10.5 12.8799C9.70024 13.2985 9.10807 13.8275 8.64232 14.5478C8.51063 14.7515 8.44479 14.8533 8.44489 15.0011C8.44498 15.1488 8.51099 15.2506 8.643 15.4542C9.1095 16.1736 9.70167 16.7028 10.5 17.1225M13.5 12.8799C14.2998 13.2985 14.8919 13.8275 15.3577 14.5478C15.4894 14.7515 15.5552 14.8533 15.5551 15.0011C15.555 15.1488 15.489 15.2506 15.357 15.4542C14.8905 16.1736 14.2983 16.7028 13.5 17.1225M10.9645 2.5H10.6678C8.64635 2.5 7.63561 2.5 6.84835 2.85692C5.96507 3.25736 5.25736 3.96507 4.85692 4.84835C4.5 5.63561 4.5 6.64635 4.5 8.66781V14C4.5 17.2875 4.5 18.9312 5.40796 20.0376C5.57418 20.2401 5.75989 20.4258 5.96243 20.592C7.06878 21.5 8.71252 21.5 12 21.5C15.2875 21.5 16.9312 21.5 18.0376 20.592C18.2401 20.4258 18.4258 20.2401 18.592 20.0376C19.5 18.9312 19.5 17.2875 19.5 14V11.0355C19.5 10.0027 19.5 9.48628 19.4176 8.99414C19.2671 8.09576 18.9141 7.24342 18.3852 6.50177C18.0955 6.09549 17.7303 5.73032 17 5C16.2697 4.26968 15.9045 3.90451 15.4982 3.6148C14.7566 3.08595 13.9042 2.7329 13.0059 2.58243C12.5137 2.5 11.9973 2.5 10.9645 2.5Z"/>
      </svg>
    )
  }

  if (iconType === 'image') {
    // Image file icon (landscape frame with mountain/sun)
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
        <path d="M8 8.5C8 8.77614 7.77614 9 7.5 9C7.22386 9 7 8.77614 7 8.5C7 8.22386 7.22386 8 7.5 8C7.77614 8 8 8.22386 8 8.5Z" fill="currentColor"/>
        <path d="M20.9998 16.1004L17.9497 13.0503C16.6163 11.7169 15.9496 11.0503 15.1212 11.0503C14.2928 11.0503 13.6261 11.7169 12.2928 13.0503L5.34323 20M8 8.5C8 8.77614 7.77614 9 7.5 9C7.22386 9 7 8.77614 7 8.5C7 8.22386 7.22386 8 7.5 8C7.77614 8 8 8.22386 8 8.5ZM10.5 20.5H13.5C17.2712 20.5 19.1569 20.5 20.3284 19.3284C21.5 18.1569 21.5 16.2712 21.5 12.5V11.5C21.5 7.72876 21.5 5.84315 20.3284 4.67157C19.1569 3.5 17.2712 3.5 13.5 3.5H10.5C6.72876 3.5 4.84315 3.5 3.67157 4.67157C2.5 5.84315 2.5 7.72876 2.5 11.5V12.5C2.5 16.2712 2.5 18.1569 3.67157 19.3284C4.84315 20.5 6.72876 20.5 10.5 20.5Z"/>
      </svg>
    )
  }

  // Generic file icon (document with folded corner)
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
      <path d="M10.5 2.5C12.1569 2.5 13.5 3.84315 13.5 5.5V6.1C13.5 6.4716 13.5 6.6574 13.5246 6.81287C13.6602 7.66865 14.3313 8.33983 15.1871 8.47538C15.3426 8.5 15.5284 8.5 15.9 8.5H16.5C18.1569 8.5 19.5 9.84315 19.5 11.5M9 16H15M9 12H10M10.9645 2.5H10.6678C8.64635 2.5 7.63561 2.5 6.84835 2.85692C5.96507 3.25736 5.25736 3.96507 4.85692 4.84835C4.5 5.63561 4.5 6.64635 4.5 8.66781V14C4.5 17.2875 4.5 18.9312 5.40796 20.0376C5.57418 20.2401 5.75989 20.4258 5.96243 20.592C7.06878 21.5 8.71252 21.5 12 21.5C15.2875 21.5 16.9312 21.5 18.0376 20.592C18.2401 20.4258 18.4258 20.2401 18.592 20.0376C19.5 18.9312 19.5 17.2875 19.5 14V11.0355C19.5 10.0027 19.5 9.48628 19.4176 8.99414C19.2671 8.09576 18.9141 7.24342 18.3852 6.50177C18.0955 6.09549 17.7303 5.73032 17 5C16.2697 4.26968 15.9045 3.90451 15.4982 3.6148C14.7566 3.08595 13.9042 2.7329 13.0059 2.58243C12.5137 2.5 11.9973 2.5 10.9645 2.5Z"/>
    </svg>
  )
}

// ============================================================================
// Hook for managing inline mention state
// ============================================================================

/** Interface for elements that can be used with useInlineMention */
export interface MentionInputElement {
  getBoundingClientRect: () => DOMRect
  getCaretRect?: () => DOMRect | null
  value: string
  selectionStart: number
}

export interface UseInlineMentionOptions {
  /** Ref to input element (textarea or RichTextInput handle) */
  inputRef: React.RefObject<MentionInputElement | null>
  /** Base path for file search (working directory) */
  basePath?: string
  onSelect: (item: MentionItem) => void
}

export interface UseInlineMentionReturn {
  isOpen: boolean
  filter: string
  position: { x: number; y: number }
  sections: MentionSection[]
  /** Whether file search is in progress */
  isSearching: boolean
  handleInputChange: (value: string, cursorPosition: number) => void
  close: () => void
  handleSelect: (item: MentionItem) => { value: string; cursorPosition: number }
}

export function useInlineMention({
  inputRef,
  basePath,
  onSelect,
}: UseInlineMentionOptions): UseInlineMentionReturn {
  const [isOpen, setIsOpen] = React.useState(false)
  const [filter, setFilter] = React.useState('')
  // committedFilter: only updates when IPC returns (or immediately when no IPC needed).
  // Prevents visual jumps — the menu shows all items until results are ready,
  // then applies filter + file results in a single frame.
  const [committedFilter, setCommittedFilter] = React.useState('')
  const [position, setPosition] = React.useState({ x: 0, y: 0 })
  const [atStart, setAtStart] = React.useState(-1)
  const [fileResults, setFileResults] = React.useState<MentionItem[]>([])
  const fileSearchTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // Cache of raw IPC file search results for the current menu session.
  // Allows instant client-side filtering when user edits the query (add/delete chars)
  // without waiting for a new IPC round-trip. Cleared when menu closes.
  const fileCache = React.useRef<FileSearchResult[]>([])
  // Store current input state for handleSelect
  const currentInputRef = React.useRef({ value: '', cursorPosition: 0 })

  // Cleanup pending timeout on unmount
  React.useEffect(() => {
    return () => {
      if (fileSearchTimeout.current) {
        clearTimeout(fileSearchTimeout.current)
      }
    }
  }, [])

  // @ mention is files-only. Skills live under `/` slash commands.
  const sections = React.useMemo((): MentionSection[] => {
    if (fileResults.length === 0) return []
    return [{
      id: 'files',
      label: 'Files',
      items: fileResults,
    }]
  }, [fileResults])

  // Monotonic request id so stale IPC responses (from an earlier, shorter query)
  // cannot overwrite fresher results.
  const searchRequestId = React.useRef(0)
  // Query string of the last IPC search that populated fileCache.
  const lastIpcQuery = React.useRef('')

  const handleInputChange = React.useCallback((value: string, cursorPosition: number) => {
    // Store current state for handleSelect
    currentInputRef.current = { value, cursorPosition }

    const textBeforeCursor = value.slice(0, cursorPosition)
    // Unicode-aware @ query parse (CJK filenames, spaces, path separators, …)
    const mention = parseActiveMentionQuery(textBeforeCursor)

    if (mention) {
      const matchStart = mention.atIndex
      const filterText = mention.query

      // Slack-style auto-close: if the query contains a space and the file cache is
      // populated but produces zero matches, close the menu. This prevents the
      // "infinite spaces" problem while still allowing multi-word queries like
      // "app availability.md". Skills/sources rarely have spaces in names, so
      // file cache is the authoritative signal here.
      if (filterText.includes(' ') && fileCache.current.length > 0) {
        const fileMatches = filterCacheResults(fileCache.current, filterText)
        if (fileMatches.length === 0) {
          setIsOpen(false)
          setFilter('')
          setCommittedFilter('')
          setAtStart(-1)
          if (fileSearchTimeout.current) {
            clearTimeout(fileSearchTimeout.current)
            fileSearchTimeout.current = null
          }
          setFileResults([])
          fileCache.current = []
          lastIpcQuery.current = ''
          return
        }
      }

      setAtStart(matchStart)
      setFilter(filterText)
      // Apply filter immediately so skills/sources narrow as the user types,
      // even before the filesystem IPC returns. File hits are merged in later.
      setCommittedFilter(filterText)

      // File search strategy:
      // - Empty query: load a short alphabetical default listing so bare `@`
      //   is not an empty/sparse popup.
      // - Non-empty: cache preview + debounced IPC, re-search when the query
      //   is not a pure refinement of the last IPC result set.
      window.electronAPI.debugLog('[mention] filterText:', filterText, 'basePath:', basePath, 'cacheSize:', fileCache.current.length)
      if (basePath) {
        // Instant client-side preview from whatever we already have
        if (fileCache.current.length > 0) {
          const filtered = filterCacheResults(fileCache.current, filterText)
          window.electronAPI.debugLog('[mention] cache preview:', filtered.length, 'items')
          setFileResults(filtered)
          setCommittedFilter(filterText)
        }

        // Decide whether we need a new IPC round-trip.
        const prevQuery = lastIpcQuery.current
        const isEmptyQuery = filterText.trim().length === 0
        // Refinement only applies to non-empty queries growing a previous non-empty query
        const isRefinement =
          !isEmptyQuery &&
          prevQuery.length > 0 &&
          filterText.toLowerCase().startsWith(prevQuery.toLowerCase()) &&
          filterText.length > prevQuery.length
        const refinedFromCache =
          isRefinement && fileCache.current.length > 0
            ? filterCacheResults(fileCache.current, filterText)
            : null
        // Empty query reuses a previous empty-query cache when present.
        const hasDefaultCache = isEmptyQuery && lastIpcQuery.current === '' && fileCache.current.length > 0
        const needsFreshSearch =
          !hasDefaultCache && (
            !isRefinement ||
            fileCache.current.length === 0 ||
            !refinedFromCache ||
            refinedFromCache.length < 5
          )

        if (fileSearchTimeout.current) clearTimeout(fileSearchTimeout.current)

        if (needsFreshSearch) {
          // Bare `@` should feel instant; typed queries keep a short debounce
          const debounceMs = isEmptyQuery ? 0 : (isRefinement ? 220 : 120)
          const requestQuery = filterText
          fileSearchTimeout.current = setTimeout(async () => {
            const requestId = ++searchRequestId.current
            try {
              window.electronAPI.debugLog('[mention] calling IPC searchFiles:', basePath, JSON.stringify(requestQuery))
              const results = await window.electronAPI.searchFiles(basePath, requestQuery)
              // Drop stale responses (user kept typing while this was in flight)
              if (requestId !== searchRequestId.current) {
                window.electronAPI.debugLog('[mention] stale IPC ignored for:', requestQuery)
                return
              }
              window.electronAPI.debugLog('[mention] IPC returned:', results?.length, 'results')
              fileCache.current = results ?? []
              lastIpcQuery.current = requestQuery
              const filtered = filterCacheResults(fileCache.current, requestQuery)
              window.electronAPI.debugLog('[mention] after cache filter:', filtered.length, 'items')
              setFileResults(filtered)
              setCommittedFilter(requestQuery)
            } catch (err) {
              if (requestId === searchRequestId.current) {
                window.electronAPI.debugLog('[mention] IPC searchFiles error:', String(err))
              }
            }
          }, debounceMs)
        }
      } else {
        window.electronAPI.debugLog('[mention] skipping file search (no basePath)')
        if (fileSearchTimeout.current) {
          clearTimeout(fileSearchTimeout.current)
          fileSearchTimeout.current = null
        }
        setFileResults([])
        lastIpcQuery.current = ''
        setCommittedFilter(filterText)
      }

      if (inputRef.current) {
        // Try to get actual caret position from the input element
        const caretRect = inputRef.current.getCaretRect?.()

        if (caretRect && caretRect.x > 0) {
          // Use actual caret position
          setPosition({
            x: caretRect.x,
            y: caretRect.y,
          })
        } else {
          // Fallback: position at input element's left edge
          const rect = inputRef.current.getBoundingClientRect()
          const lineHeight = 20
          const linesBeforeCursor = textBeforeCursor.split('\n').length - 1
          setPosition({
            x: rect.left,
            y: rect.top + (linesBeforeCursor + 1) * lineHeight,
          })
        }
      }

      setIsOpen(true)
    } else {
      setIsOpen(false)
      setFilter('')
      setCommittedFilter('')
      setAtStart(-1)
      // Clear file search state and cache when menu closes
      if (fileSearchTimeout.current) {
        clearTimeout(fileSearchTimeout.current)
        fileSearchTimeout.current = null
      }
      setFileResults([])
      fileCache.current = []
      lastIpcQuery.current = ''
      searchRequestId.current++
    }
  }, [inputRef, basePath])

  const handleSelect = React.useCallback((item: MentionItem): { value: string; cursorPosition: number } => {
    let result = ''
    let newCursorPosition = 0

    if (atStart >= 0) {
      const { value: currentValue, cursorPosition } = currentInputRef.current
      const before = currentValue.slice(0, atStart)
      const after = currentValue.slice(cursorPosition)

      const buildMentionText = (kind: 'skill' | 'source' | 'file' | 'folder', value: string): string =>
        '[' + kind + ':' + value + '] '

      // @ is files/folders only — skills are inserted via `/` slash commands.
      let mentionText: string
      if (item.type === 'file') {
        mentionText = buildMentionText('file', item.file?.relativePath || item.id)
      } else if (item.type === 'folder') {
        mentionText = buildMentionText('folder', item.file?.relativePath || item.id)
      } else {
        // Defensive fallback (should not appear in the @ menu)
        mentionText = buildMentionText('file', item.id)
      }

      result = before + mentionText + after
      newCursorPosition = before.length + mentionText.length
    }

    onSelect(item)
    setIsOpen(false)
    setCommittedFilter('')
    // Clear file search state and cache to prevent stale results on next open
    if (fileSearchTimeout.current) {
      clearTimeout(fileSearchTimeout.current)
      fileSearchTimeout.current = null
    }
    setFileResults([])
    fileCache.current = []
    lastIpcQuery.current = ''
    searchRequestId.current++

    return { value: result, cursorPosition: newCursorPosition }
  }, [onSelect, atStart])

  const close = React.useCallback(() => {
    setIsOpen(false)
    setFilter('')
    setCommittedFilter('')
    setAtStart(-1)
    // Clear file search state and cache to prevent stale results on next open
    if (fileSearchTimeout.current) {
      clearTimeout(fileSearchTimeout.current)
      fileSearchTimeout.current = null
    }
    setFileResults([])
    fileCache.current = []
    lastIpcQuery.current = ''
    searchRequestId.current++
  }, [])

  return {
    isOpen,
    filter: committedFilter,
    position,
    sections,
    isSearching: false,
    handleInputChange,
    close,
    handleSelect,
  }
}
