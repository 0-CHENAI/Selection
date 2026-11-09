import * as storage from './local-storage'

export interface OfficePreviewScope {
  workspaceId: string
  sessionId: string
}

export interface OfficePreviewState {
  open: boolean
  path: string
  scrollY: number
  scrollX?: number
  anchor?: { path: string; offset: number }
}

export function officeScrollAnchor(value: unknown): OfficePreviewState['anchor'] {
  if (!value || typeof value !== 'object') return
  const anchor = value as Record<string, unknown>
  if (typeof anchor.path !== 'string' || !anchor.path || anchor.path.length > 1024 || /[\x00-\x1f]/.test(anchor.path)
    || typeof anchor.offset !== 'number' || !Number.isFinite(anchor.offset)) return
  return { path: anchor.path, offset: anchor.offset }
}

export function readOfficePreviewState(scope: OfficePreviewScope): OfficePreviewState | undefined {
  if (!scope.workspaceId || !scope.sessionId) return
  const value = storage.get<unknown>(storage.KEYS.officePreviewState, undefined, JSON.stringify([scope.workspaceId, scope.sessionId]))
  if (!value || typeof value !== 'object') return
  const saved = value as Record<string, unknown>
  if (typeof saved.open !== 'boolean' || typeof saved.path !== 'string' || !/\.(docx|xlsx|pptx)$/i.test(saved.path)
    || /[\x00-\x1f]/.test(saved.path)) return
  return { open: saved.open, path: saved.path,
    scrollY: typeof saved.scrollY === 'number' && Number.isFinite(saved.scrollY) ? Math.max(0, saved.scrollY) : 0,
    scrollX: typeof saved.scrollX === 'number' && Number.isFinite(saved.scrollX) ? Math.max(0, saved.scrollX) : 0,
    anchor: officeScrollAnchor(saved.anchor) }
}

export function writeOfficePreviewState(scope: OfficePreviewScope, state: OfficePreviewState): void {
  if (!scope.workspaceId || !scope.sessionId) return
  // Persist only navigation state. Preview IDs and selections belong to a live file version.
  storage.set(storage.KEYS.officePreviewState, {
    open: state.open, path: state.path, scrollY: state.scrollY, scrollX: state.scrollX ?? 0, anchor: state.anchor,
  }, JSON.stringify([scope.workspaceId, scope.sessionId]))
}
