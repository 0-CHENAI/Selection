import type { PptProgress } from '@craft-agent/shared/protocol'
import { pptLiveFrame, pptRowFraction } from '@/components/ppt/ppt-result-model'

/** A PPT session turn is in flight. The deliverable row stays hidden for this whole window. */
export function officeButtonGenerating(session: {
  ppt?: unknown
  isProcessing?: boolean
  pptProgress?: { generating?: boolean }
} | null | undefined): boolean {
  return !!session?.ppt && (!!session.isProcessing || !!session.pptProgress?.generating)
}

export interface OfficeCollaborationLiveProgress {
  current: number
  total: number
  /** 0–1. Page 6 of 15 is 0.4, matching the label. */
  fraction: number
  title?: string
}

/** Page counts for the Office button. Absent until the deck reports the page being written. */
export function officeCollaborationLiveProgress(progress: PptProgress | undefined): OfficeCollaborationLiveProgress | null {
  if (!progress?.generating) return null
  const total = progress.total
  const frame = pptLiveFrame({
    generating: true,
    total,
    completed: progress.completed,
    current: progress.current,
  })
  const fraction = pptRowFraction({
    generating: true,
    total,
    completed: progress.completed,
    current: progress.current,
  })
  if (!frame.current || total <= 0 || fraction == null) return null
  const title = (progress.currentTitle ?? '').trim() || (progress.pages?.find(page => page.index === frame.current)?.name ?? '').trim()
  return {
    current: frame.current,
    total,
    fraction,
    ...(title ? { title } : {}),
  }
}

export function officeProgressAttribute(fraction: number): string {
  return String(Math.round(Math.max(0, Math.min(1, fraction)) * 1000) / 1000)
}
