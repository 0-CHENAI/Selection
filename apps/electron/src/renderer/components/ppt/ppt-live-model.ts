import type { PptProgress, PptRevisionTarget } from '@craft-agent/shared/protocol'

export const PPT_LIVE_MAX_SELECTION = 256

export function pptTargetKey(target: PptRevisionTarget): string {
  return target.elementId ? `${target.page}#${target.elementId}` : String(target.page)
}

/** Click replaces the selection. Shift or meta toggles, and a page selection drops elements on that page. */
export function applyPptSelection(current: PptRevisionTarget[], target: PptRevisionTarget, toggle: boolean): PptRevisionTarget[] {
  const id = pptTargetKey(target)
  if (!toggle) {
    if (current.length === 1 && pptTargetKey(current[0]!) === id) return []
    return [target]
  }
  const base = current.filter(item => {
    if (item.page !== target.page) return true
    if (!target.elementId) return false
    return !!item.elementId
  })
  const exists = base.some(item => pptTargetKey(item) === id)
  if (exists) return base.filter(item => pptTargetKey(item) !== id)
  if (base.length >= PPT_LIVE_MAX_SELECTION) return base
  return [...base, target]
}

export type PptHistoryKind =
  | { kind: 'progress'; current: number; total: number }
  | { kind: 'generating' }
  | { kind: 'pages'; count: number }
  | { kind: 'file' }

export function pptHistoryKind(input: { processing?: boolean; progress?: PptProgress; templatePages?: number }): PptHistoryKind {
  const generating = !!input.processing || !!input.progress?.generating
  const total = input.progress?.total ?? 0
  if (generating && total > 0) {
    const current = input.progress?.current ?? Math.min(total, (input.progress?.completed ?? 0) + 1)
    return { kind: 'progress', current, total }
  }
  if (generating) return { kind: 'generating' }
  if (total > 0) return { kind: 'pages', count: total }
  if (input.templatePages) return { kind: 'pages', count: input.templatePages }
  return { kind: 'file' }
}
