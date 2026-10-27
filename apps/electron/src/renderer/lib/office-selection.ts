import { OFFICE_PREVIEW_MAX_SELECTION } from '@craft-agent/shared/protocol'

export interface OfficeSelectionEcho {
  previewId: string
  paths: string[]
}

export type OfficeSelectionDecision =
  | { type: 'ignore' }
  | { type: 'echo' }
  | { type: 'overflow'; count: number }
  | { type: 'apply'; count: number; paths: string[] }

function samePathList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const seen = new Set(right)
  return left.every(path => seen.has(path))
}

/** Classify one preview selection message. Callers paint `count` and only sync `apply`. */
export function decideOfficeSelection(input: {
  paths: unknown
  previewId: string
  isDraft: boolean
  resuming: boolean
  refreshing: boolean
  activePreviewId?: string
  echo?: OfficeSelectionEcho
  max?: number
}): OfficeSelectionDecision {
  const max = input.max ?? OFFICE_PREVIEW_MAX_SELECTION
  if (!Array.isArray(input.paths) || input.paths.some(path => typeof path !== 'string')) return { type: 'ignore' }
  const paths = input.paths as string[]
  if (input.echo?.previewId === input.previewId && samePathList(input.echo.paths, paths)) return { type: 'echo' }
  if (input.isDraft || input.resuming || input.refreshing || input.activePreviewId !== input.previewId) return { type: 'ignore' }
  if (paths.length > max) return { type: 'overflow', count: paths.length }
  return { type: 'apply', count: paths.length, paths }
}
