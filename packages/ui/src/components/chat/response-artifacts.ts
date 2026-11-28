import { isArtifactCardPath, localArtifactLinks } from '@craft-agent/shared/utils/artifact-links'
import type { MergedArtifactRow } from './artifact-supplements'

export type ArtifactChange = 'created' | 'modified' | 'deleted' | 'restored'

export type ArtifactCategory = 'presentation' | 'document' | 'spreadsheet' | 'pdf' | 'html' | 'markdown' | 'other'

export interface ResponseArtifact {
  path: string
  name: string
  extension: string
  change?: ArtifactChange
}

export interface ArtifactSingleItem {
  kind: 'item'
  row: MergedArtifactRow
  featured: boolean
}

export interface ArtifactFolderGroup {
  kind: 'group'
  id: string
  dirPath: string
  label: string
  rows: MergedArtifactRow[]
  extensions: string[]
  revealPath: string
}

export type ArtifactShelfItem = ArtifactSingleItem | ArtifactFolderGroup

export interface OrganizedArtifactShelf {
  orderedRows: MergedArtifactRow[]
  shelfItems: ArtifactShelfItem[]
  hasGroups: boolean
  categories: Array<{ category: ArtifactCategory; count: number }>
}

export const SMART_GROUP_MIN_TOTAL = 6
export const SMART_GROUP_MIN_FOLDER_SIZE = 4

const CATEGORY_ORDER: readonly ArtifactCategory[] = [
  'presentation',
  'document',
  'spreadsheet',
  'pdf',
  'html',
  'markdown',
  'other',
]

const ENTRY_POINT_PREFIX = /^(?:index|readme|summary|overview|report|main|final|交付|总报告|汇总|总结|摘要|目录|说明)(?:[._\-\s]|$)/i
const ENTRY_POINT_SUFFIX = /(?:总报告|汇总|总结|摘要|定稿|终版|最终版|目录|概览)$/i
const SECONDARY_DIR_SEGMENT = /^(?:drafts?|tmp|temp|partials?|chunks?|intermediate|archive|backup|sections?|chapters?|pages?|slides?|fragments?|shards?|batch|logs?|notes?|raw|草稿|中间|分片|章节|附件)$/i

function isEntryPointStem(stem: string): boolean {
  return ENTRY_POINT_PREFIX.test(stem) || ENTRY_POINT_SUFFIX.test(stem)
}

export function artifactPathKey(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized
}

export function artifactCategory(extension: string): ArtifactCategory {
  const ext = extension.toLowerCase()
  if (/^(pptx?|pptm|potx?|potm|ppsx?|ppsm)$/.test(ext)) return 'presentation'
  if (/^(docx?|docm|dotx?|dotm|rtf)$/.test(ext)) return 'document'
  if (/^(xlsx?|xlsm|xlsb|xltx?|xltm|csv)$/.test(ext)) return 'spreadsheet'
  if (ext === 'pdf') return 'pdf'
  if (/^html?$/.test(ext)) return 'html'
  if (/^(md|markdown)$/.test(ext)) return 'markdown'
  return 'other'
}

/** Show recorded, openable changes in the supported document formats. */
export function extractDeliveredResponseArtifacts(
  versions?: readonly { path: string; ordinal?: number; change?: ArtifactChange }[],
): ResponseArtifact[] {
  if (!versions?.length) return []
  const artifacts: ResponseArtifact[] = []
  const seen = new Set<string>()
  for (const version of versions) {
    if (!isArtifactCardPath(version.path) || version.change === 'deleted') continue
    const key = artifactPathKey(version.path)
    if (seen.has(key)) continue
    seen.add(key)
    const name = version.path.replace(/\\/g, '/').split('/').pop() || version.path
    artifacts.push({
      path: version.path,
      name,
      extension: name.slice(name.lastIndexOf('.') + 1).toLowerCase(),
      change: version.change ?? (version.ordinal === 1 ? 'created' : 'modified'),
    })
  }
  return artifacts
}

function normalizedSlashPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
}

function isWindowsLikePath(normalized: string): boolean {
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
}

function parentDirOf(path: string): string {
  const normalized = normalizedSlashPath(path)
  const idx = normalized.lastIndexOf('/')
  if (idx < 0) return ''
  if (idx === 0) return '/'
  if (normalized.startsWith('//') && idx <= 1) return ''
  const dir = normalized.slice(0, idx)
  // Preserve the root separator for Windows drive roots (e.g. "C:/").
  return /^[a-z]:$/i.test(dir) ? `${dir}/` : dir
}

function commonParentDir(paths: readonly string[]): string {
  if (paths.length === 0) return ''
  const normalizedFirst = normalizedSlashPath(paths[0]!)
  const caseInsensitive = isWindowsLikePath(normalizedFirst)
  const split = paths.map(p => parentDirOf(p).split('/').filter(Boolean))
  const first = split[0]!
  let shared = first.length
  for (let i = 1; i < split.length && shared > 0; i++) {
    const parts = split[i]!
    const limit = Math.min(shared, parts.length)
    let matched = 0
    while (matched < limit) {
      const a = parts[matched]!
      const b = first[matched]!
      if (caseInsensitive ? a.toLowerCase() !== b.toLowerCase() : a !== b) break
      matched++
    }
    shared = matched
  }
  if (shared === 0) return ''
  const prefix = normalizedFirst.startsWith('//') ? '//' : normalizedFirst.startsWith('/') ? '/' : ''
  return `${prefix}${first.slice(0, shared).join('/')}`
}

function relativeDirSegments(dirPath: string, commonDir: string): string[] {
  if (!dirPath) return []
  const normDir = dirPath.replace(/\/+$/, '')
  const normCommon = commonDir.replace(/\/+$/, '')
  if (!normCommon) return normDir.split('/').filter(Boolean)
  const caseInsensitive = isWindowsLikePath(normDir) || isWindowsLikePath(normCommon)
  const cmpDir = caseInsensitive ? normDir.toLowerCase() : normDir
  const cmpCommon = caseInsensitive ? normCommon.toLowerCase() : normCommon
  if (cmpDir === cmpCommon) return []
  const prefix = `${cmpCommon}/`
  if (cmpDir.startsWith(prefix)) return normDir.slice(normCommon.length + 1).split('/').filter(Boolean)
  return normDir.split('/').filter(Boolean)
}

function folderDisplayLabel(dirPath: string, commonDir: string): string {
  const rel = relativeDirSegments(dirPath, commonDir)
  if (rel.length > 2) return `…/${rel.slice(-2).join('/')}/`
  if (rel.length > 0) return `${rel.join('/')}/`
  if (dirPath === '/' || /^[a-z]:\/$/i.test(dirPath)) return dirPath
  const base = dirPath.replace(/\/+$/, '').split('/').filter(Boolean).pop()
  return base ? `${base}/` : './'
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface ResponseMentions {
  linkedKeys: Set<string>
  linkedRelativeSuffixes: string[]
  text?: string
}

function extractResponseMentions(responseText?: string): ResponseMentions {
  if (!responseText || responseText.trim().length === 0) {
    return { linkedKeys: new Set(), linkedRelativeSuffixes: [] }
  }
  const linkedKeys = new Set<string>()
  const linkedRelativeSuffixes: string[] = []
  // Skip full Markdown lexing when prose has no link or preview block syntax.
  if (responseText.includes('](') || responseText.includes(']:') || responseText.includes('-preview')) {
    for (const link of localArtifactLinks(responseText)) {
      const key = artifactPathKey(link)
      linkedKeys.add(key)
      const clean = key.replace(/^\/+/, '')
      if (clean && !key.startsWith('/') && !/^[a-z]:\//i.test(key)) {
        linkedRelativeSuffixes.push(clean)
      }
    }
  }
  return { linkedKeys, linkedRelativeSuffixes, text: responseText }
}

function isExplicitlyLinked(artifact: ResponseArtifact, mentions: ResponseMentions): boolean {
  if (mentions.linkedKeys.size === 0) return false
  const key = artifactPathKey(artifact.path)
  if (mentions.linkedKeys.has(key)) return true
  const lowerKey = key.toLowerCase()
  for (const suffix of mentions.linkedRelativeSuffixes) {
    const lowerSuffix = suffix.toLowerCase()
    if (lowerKey === lowerSuffix || lowerKey.endsWith(`/${lowerSuffix}`)) return true
  }
  return false
}

function isNameMentionedInText(name: string, text?: string): boolean {
  if (!text || name.length < 4) return false
  if (!text.includes(name)) return false
  // Guard ASCII edges so "a.md" never matches "data.md" and "a.doc" never matches "a.docx",
  // while allowing Markdown emphasis (**报告.docx**) and adjacent CJK prose (已生成报告.docx并保存).
  const leadingGuard = /^[A-Za-z0-9]/.test(name) ? '(?<![A-Za-z0-9_.-])' : ''
  const trailingGuard = /[A-Za-z0-9]$/.test(name) ? '(?![A-Za-z0-9_])' : ''
  return new RegExp(`${leadingGuard}${escapeRegExp(name)}${trailingGuard}`).test(text)
}

function formatWeight(category: ArtifactCategory): number {
  switch (category) {
    case 'presentation':
    case 'document':
    case 'spreadsheet':
    case 'pdf':
      return 20
    case 'html':
    case 'other':
      return 10
    case 'markdown':
      return 5
  }
}

interface ScoredRow {
  row: MergedArtifactRow
  index: number
  score: number
  explicitlyReferenced: boolean
  entryPoint: boolean
  category: ArtifactCategory
  dirPath: string
  dirKey: string
}

/**
 * Prioritize and intelligently group delivered artifacts for display.
 * - Supplemented live rows stay pinned first.
 * - Explicitly referenced deliverables, entry points and primary document formats surface first.
 * - When many files are produced (>= 6), bulk subdirectories (>= 4 remaining files) cluster into folder cards.
 */
export function organizeArtifactShelf(
  rows: readonly MergedArtifactRow[],
  options?: { responseText?: string },
): OrganizedArtifactShelf {
  if (rows.length === 0) {
    return { orderedRows: [], shelfItems: [], hasGroups: false, categories: [] }
  }

  const categoryCounts = new Map<ArtifactCategory, number>()
  const commonDir = rows.length > 1 ? commonParentDir(rows.map(r => r.artifact.path)) : ''
  const mentions = rows.length > 1 ? extractResponseMentions(options?.responseText) : { linkedKeys: new Set<string>(), linkedRelativeSuffixes: [] }

  const scored: ScoredRow[] = rows.map((row, index) => {
    const category = artifactCategory(row.artifact.extension)
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1)
    const dirPath = parentDirOf(row.artifact.path)
    const dirKey = artifactPathKey(dirPath || '.')
    if (rows.length === 1) {
      return { row, index, score: 0, explicitlyReferenced: false, entryPoint: false, category, dirPath, dirKey }
    }
    const linked = isExplicitlyLinked(row.artifact, mentions)
    const mentioned = !linked && isNameMentionedInText(row.artifact.name, mentions.text)
    const entryPoint = isEntryPointStem(stemOf(row.artifact.name))
    const relSegments = relativeDirSegments(dirPath, commonDir)
    const hasSecondaryDir = relSegments.some(segment => SECONDARY_DIR_SEGMENT.test(segment))
    let score = formatWeight(category)
    if (linked) score += 100
    else if (mentioned) score += 60
    if (entryPoint) score += 25
    if (hasSecondaryDir) score -= 20
    score -= Math.min(15, relSegments.length * 3)
    return {
      row,
      index,
      score,
      explicitlyReferenced: linked || mentioned,
      entryPoint,
      category,
      dirPath,
      dirKey,
    }
  })

  // Keep supplemented rows pinned first in their original relative order; rank remaining rows by smart priority.
  scored.sort((a, b) => {
    const aPinned = a.row.supplement ? 1 : 0
    const bPinned = b.row.supplement ? 1 : 0
    if (aPinned !== bPinned) return bPinned - aPinned
    if (aPinned === 1) return a.index - b.index
    if (a.score !== b.score) return b.score - a.score
    return a.index - b.index
  })

  const orderedRows = scored.map(item => item.row)
  const categories = CATEGORY_ORDER
    .filter(category => (categoryCounts.get(category) ?? 0) > 0)
    .map(category => ({ category, count: categoryCounts.get(category)! }))

  if (scored.length < SMART_GROUP_MIN_TOTAL) {
    return {
      orderedRows,
      shelfItems: orderedRows.map(row => ({ kind: 'item', row, featured: true })),
      hasGroups: false,
      categories,
    }
  }

  // Decide which deliverables stay standalone ("featured") before batch folder clustering.
  const featuredIndices = new Set<number>()
  let nonSupplementFeatured = 0
  const referencedCount = scored.filter(item => !item.row.supplement && item.explicitlyReferenced).length
  const maxAutoFeatured = referencedCount > 6 ? 4 : 6
  const isPrimaryDeliverable = (category: ArtifactCategory) =>
    category === 'presentation' || category === 'document' || category === 'spreadsheet' || category === 'pdf'
  const primaryDeliverableCount = scored.filter(item => !item.row.supplement && isPrimaryDeliverable(item.category)).length
  const promoteSmallPrimarySet = primaryDeliverableCount > 0 && primaryDeliverableCount <= 4

  for (let i = 0; i < scored.length; i++) {
    const item = scored[i]!
    if (item.row.supplement) {
      featuredIndices.add(i)
      continue
    }
    if ((item.explicitlyReferenced || item.entryPoint) && nonSupplementFeatured < maxAutoFeatured) {
      featuredIndices.add(i)
      nonSupplementFeatured++
    }
  }

  // Keep a small set of Office/PDF deliverables (<= 4) surfaced alongside large markdown/HTML batches,
  // while still allowing bulk Office/PDF batches (e.g. 50 invoices) to cluster by folder.
  if (promoteSmallPrimarySet) {
    for (let i = 0; i < scored.length && nonSupplementFeatured < maxAutoFeatured; i++) {
      if (featuredIndices.has(i)) continue
      if (isPrimaryDeliverable(scored[i]!.category)) {
        featuredIndices.add(i)
        nonSupplementFeatured++
      }
    }
  }

  // Ensure the shelf always highlights at least 2 concrete deliverables when nothing was explicitly linked.
  const minStandalone = featuredIndices.size > 0 ? 1 : 2
  for (let i = 0; i < scored.length && featuredIndices.size < minStandalone; i++) {
    if (!featuredIndices.has(i)) featuredIndices.add(i)
  }

  const remainingByDir = new Map<string, ScoredRow[]>()
  for (let i = 0; i < scored.length; i++) {
    if (featuredIndices.has(i)) continue
    const item = scored[i]!
    let bucket = remainingByDir.get(item.dirKey)
    if (!bucket) { bucket = []; remainingByDir.set(item.dirKey, bucket) }
    bucket.push(item)
  }

  const featuredItems: ArtifactSingleItem[] = []
  for (let i = 0; i < scored.length; i++) {
    if (featuredIndices.has(i)) featuredItems.push({ kind: 'item', row: scored[i]!.row, featured: true })
  }

  const groupEntries: Array<{ group: ArtifactFolderGroup; topScore: number }> = []
  const ungroupedItems: ArtifactSingleItem[] = []

  for (const [dirKey, bucket] of remainingByDir) {
    if (bucket.length >= SMART_GROUP_MIN_FOLDER_SIZE) {
      const extCounts = new Map<string, number>()
      for (const item of bucket) {
        const ext = item.row.artifact.extension.toUpperCase()
        extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1)
      }
      const extensions = [...extCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 2)
        .map(([ext]) => ext)
      const dirPath = bucket[0]!.dirPath
      groupEntries.push({
        topScore: bucket[0]!.score,
        group: {
          kind: 'group',
          id: `group:${dirKey}`,
          dirPath,
          label: folderDisplayLabel(dirPath, commonDir),
          rows: bucket.map(item => item.row),
          extensions,
          revealPath: dirPath || bucket[0]!.row.artifact.path,
        },
      })
    } else {
      for (const item of bucket) {
        ungroupedItems.push({ kind: 'item', row: item.row, featured: false })
      }
    }
  }

  groupEntries.sort((a, b) => b.topScore - a.topScore || b.group.rows.length - a.group.rows.length || a.group.label.localeCompare(b.group.label))

  const shelfItems: ArtifactShelfItem[] = [
    ...featuredItems,
    ...groupEntries.map(entry => entry.group),
    ...ungroupedItems,
  ]

  return {
    orderedRows,
    shelfItems,
    hasGroups: groupEntries.length > 0,
    categories,
  }
}
