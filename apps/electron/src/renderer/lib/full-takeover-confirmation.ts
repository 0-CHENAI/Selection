import i18n from 'i18next'
import { PERMISSION_MODE_CONFIG } from '@craft-agent/shared/agent/mode-types'
import { confirmAction } from './confirmation'

/**
 * Risk confirmation before switching into Full Takeover (`allow-all`).
 *
 * Asked once per workspace: after the user ticks "I understand the risk" and
 * confirms, the choice is saved as the workspace setting
 * `fullTakeoverAcknowledged` and later switches go through silently.
 * Cancelling (or a missing confirmation host) keeps the current mode.
 */
export interface FullTakeoverConfirmationDeps {
  isAcknowledged: (workspaceId: string) => Promise<boolean>
  saveAcknowledged: (workspaceId: string) => Promise<void>
  ask: () => Promise<boolean>
}

export function createFullTakeoverConfirmation(deps: FullTakeoverConfirmationDeps) {
  const acknowledged = new Set<string>()
  const inFlight = new Map<string, Promise<boolean>>()

  const run = async (workspaceId: string): Promise<boolean> => {
    if (acknowledged.has(workspaceId)) return true
    let stored = false
    try {
      stored = await deps.isAcknowledged(workspaceId)
    } catch {
      // Unreadable settings: fall through and ask rather than skip the warning.
    }
    if (stored) {
      acknowledged.add(workspaceId)
      return true
    }
    if (!(await deps.ask())) return false
    acknowledged.add(workspaceId)
    try {
      await deps.saveAcknowledged(workspaceId)
    } catch (error) {
      // The user did confirm; failing to persist only means we may ask again next launch.
      console.warn('[full-takeover] Failed to save acknowledgement:', error)
    }
    return true
  }

  return {
    /** Resolves true when switching to Full Takeover may proceed. */
    confirm(workspaceId: string | null | undefined): Promise<boolean> {
      // No workspace to remember the choice against: ask every time.
      if (!workspaceId) return deps.ask()
      // Rapid repeat triggers (e.g. Shift+Tab mashing) share one dialog.
      const pending = inFlight.get(workspaceId)
      if (pending) return pending
      const promise = run(workspaceId).finally(() => inFlight.delete(workspaceId))
      inFlight.set(workspaceId, promise)
      return promise
    },
    /** Forget cached acknowledgements (tests). */
    reset() {
      acknowledged.clear()
      inFlight.clear()
    },
  }
}

const fullTakeoverConfirmation = createFullTakeoverConfirmation({
  isAcknowledged: async (workspaceId) =>
    (await window.electronAPI.getWorkspaceSettings(workspaceId))?.fullTakeoverAcknowledged === true,
  saveAcknowledged: (workspaceId) =>
    window.electronAPI.updateWorkspaceSetting(workspaceId, 'fullTakeoverAcknowledged', true),
  ask: () => confirmAction(i18n.t('dialog.fullTakeover.message', { mode: PERMISSION_MODE_CONFIG['allow-all'].displayName }), {
    title: i18n.t('dialog.fullTakeover.title', { mode: PERMISSION_MODE_CONFIG['allow-all'].displayName }),
    detail: i18n.t('dialog.fullTakeover.detail'),
    confirmLabel: i18n.t('dialog.fullTakeover.confirm', { mode: PERMISSION_MODE_CONFIG['allow-all'].displayName }),
    cancelLabel: i18n.t('common.cancel'),
    acknowledgeLabel: i18n.t('dialog.fullTakeover.acknowledge'),
    warning: true,
    destructive: false,
  }),
})

/**
 * Gate a permission-mode change: resolves true for any mode other than
 * Full Takeover, for staying in Full Takeover, or once the workspace has
 * acknowledged the risk.
 */
export function confirmPermissionModeChange(
  nextMode: string,
  currentMode: string | undefined,
  workspaceId: string | null | undefined,
): Promise<boolean> {
  if (nextMode !== 'allow-all' || currentMode === 'allow-all') return Promise.resolve(true)
  return fullTakeoverConfirmation.confirm(workspaceId)
}
