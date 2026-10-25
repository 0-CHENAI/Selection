import type { PptPageProgress } from '@craft-agent/shared/protocol'

const SLIDE_NAME = /^(?:[^/\\]+\/)*slides\/(?:slide|page)-\d{1,3}\.(?:png|webp|jpe?g)$/i

/** Join a session folder with a progress image path. Rejects anything that can leave the session. */
export function slidePreviewPath(root: string, imageName: string): string | null {
  if (!root || !SLIDE_NAME.test(imageName)) return null
  if (imageName.split('/').some(part => !part || part === '.' || part === '..')) return null
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return `${root.replace(/[/\\]+$/, '')}${sep}${imageName.split('/').join(sep)}`
}

export function thumbBarClass(page: PptPageProgress, generating: boolean, current: number | undefined): string {
  if (generating) {
    if (current && page.index === current) return 'bg-accent/50'
    if (!current || page.index > current || page.status === 'pending') return 'bg-foreground/10'
    return 'bg-accent'
  }
  if (page.failed) return 'bg-destructive'
  if (page.status === 'needs_revision') return 'bg-info'
  if (page.status === 'pending' || page.status === 'fixing') return 'bg-foreground/10'
  return 'bg-success'
}

export function thumbDimmed(page: PptPageProgress, generating: boolean, current: number | undefined): boolean {
  if (!generating) return false
  return !current || page.index > current || page.status === 'pending'
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

export function segmentState(index: number, current: number | undefined): 'done' | 'current' | 'wait' {
  if (current && index < current) return 'done'
  if (current && index === current) return 'current'
  return 'wait'
}

export function attentionCount(pages: PptPageProgress[]): number {
  return pages.filter(page => page.failed || page.status === 'needs_revision').length
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
