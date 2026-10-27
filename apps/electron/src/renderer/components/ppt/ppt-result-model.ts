import type { PptPageProgress } from '@craft-agent/shared/protocol'

const SLIDE_NAME = /^(?:[^/\\]+\/)*slides\/(?:slide|page)-\d{1,3}\.(?:png|webp|jpe?g)$/i

/** Join a session folder with a progress image path. Rejects anything that can leave the session. */
export function slidePreviewPath(root: string, imageName: string): string | null {
  if (!root || !SLIDE_NAME.test(imageName)) return null
  if (imageName.split('/').some(part => !part || part === '.' || part === '..')) return null
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return `${root.replace(/[/\\]+$/, '')}${sep}${imageName.split('/').join(sep)}`
}

export interface PptCheckSummary {
  passed: number
  attention?: { index: number; issue?: string; failed: boolean }
}

export function checkSummary(pages: PptPageProgress[]): PptCheckSummary {
  const passed = pages.filter(page => page.status === 'passed' && !page.failed).length
  const attention = pages.find(page => page.failed) ?? pages.find(page => page.status === 'needs_revision')
  return {
    passed,
    ...(attention ? { attention: { index: attention.index, ...(attention.issue ? { issue: attention.issue } : {}), failed: !!attention.failed } } : {}),
  }
}

export function attentionCount(pages: PptPageProgress[]): number {
  return attentionPageNumbers(pages).length
}

/** Pages the row menu should list. Passed slides stay in the Office panel. */
export function pagesNeedingAttention(pages: readonly PptPageProgress[]): PptPageProgress[] {
  return pages.filter(page => page.failed || page.status === 'needs_revision')
}

export function attentionPageNumbers(pages: readonly PptPageProgress[]): number[] {
  return pagesNeedingAttention(pages).map(page => page.index)
}

/** Page list inside the subtitle. zh/ja use an ideographic comma, so "5、9" stays stable across Intl builds. */
export function formatAttentionPages(pages: readonly number[], language: string): string {
  const labels = pages.map(page => String(page))
  return labels.join(/^(zh|ja|yue)/i.test(language) ? '、' : ', ')
}

/** Generating bar uses the page being written, so page 6 of 15 is 0.4. Idle rows have no bar. */
export function pptRowFraction(input: {
  generating: boolean
  total: number
  completed: number
  current?: number
}): number | undefined {
  if (!input.generating) return undefined
  const total = Number.isInteger(input.total) && input.total > 0 ? input.total : 0
  if (total <= 0) return 0
  const page = pptLiveFrame(input).current ?? 0
  return Math.max(0, Math.min(1, page / total))
}

/**
 * Veil page and completed count are one snapshot.
 * A redraw with no current page is 0/N and has no veil. A known current page has finished every page before it.
 */
export function pptLiveFrame(input: {
  generating: boolean
  total: number
  completed: number
  current?: number
}): { completed: number; current?: number } {
  const total = Number.isInteger(input.total) && input.total > 0 ? input.total : 0
  const completed = Number.isFinite(input.completed) ? Math.max(0, input.completed) : 0
  if (!input.generating) return { completed: total > 0 ? Math.min(completed, total) : completed }
  const current = input.current
  if (typeof current !== 'number' || !Number.isInteger(current) || current < 1 || (total > 0 && current > total)) {
    return { completed: 0 }
  }
  return { completed: current - 1, current }
}
