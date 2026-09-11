import i18n from 'i18next'
import type { ConfirmDialogSpec } from '@craft-agent/server-core/transport'

export interface ConfirmationRequest {
  message: string
  title: string
  detail?: string
  confirmLabel: string
  cancelLabel: string
  destructive: boolean
  returnFocus: HTMLElement | null
}

export function createConfirmationController() {
  let current: ConfirmationRequest | null = null
  let resolve: ((confirmed: boolean) => void) | undefined
  const listeners = new Set<() => void>()
  const settle = (confirmed: boolean) => {
    const finish = resolve
    resolve = undefined
    current = null
    listeners.forEach(listener => listener())
    finish?.(confirmed)
  }
  return {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener); if (listeners.size === 0) settle(false) }
    },
    request: (request: ConfirmationRequest): Promise<boolean> => {
      // Reject concurrent requests instead of stacking destructive dialogs.
      if (current || listeners.size === 0) return Promise.resolve(false)
      current = request
      return new Promise<boolean>(done => {
        resolve = done
        listeners.forEach(listener => listener())
      })
    },
    settle,
  }
}

export const confirmationController = createConfirmationController()

let applicationFocus: HTMLElement | null = null
export function rememberConfirmationFocus(event: FocusEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest && target !== document.body && !target.closest('[role="menu"], [role="alertdialog"]')) applicationFocus = target
}

function getReturnFocus(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const active = document.activeElement as HTMLElement | null
  const menu = active?.closest('[role="menu"]')
  if (!menu) return active
  // Menu items unmount when selected. Restore their trigger (or the last
  // application control for context menus), never the detached item itself.
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-controls]'))
    .find(element => element.getAttribute('aria-controls') === menu.id) ?? applicationFocus
}

export function confirmAction(message: string, options: Partial<Omit<ConfirmationRequest, 'message' | 'returnFocus'>> = {}) {
  return confirmationController.request({
    message, title: i18n.t('dialog.confirmTitle'), confirmLabel: i18n.t('common.continue'),
    cancelLabel: i18n.t('common.cancel'), destructive: true,
    ...options,
    returnFocus: getReturnFocus(),
  })
}

export async function confirmClientDialog(spec: ConfirmDialogSpec): Promise<{ response: number }> {
  const cancel = spec.cancelId ?? 0
  // Only the existing two-button business confirmation contract is supported.
  if (spec.buttons.length !== 2 || cancel !== 0) return { response: cancel }
  const isDelete = spec.kind === 'deleteSession'
  const isLogout = spec.kind === 'logout'
  const accepted = await confirmAction(
    isDelete ? i18n.t('dialog.deleteSessionConfirmation', { name: spec.name })
      : isLogout ? i18n.t('dialog.logoutConfirmation') : spec.message,
    {
      title: isDelete ? i18n.t('common.delete') : isLogout ? i18n.t('webui.logOut') : spec.title,
      detail: isLogout ? i18n.t('dialog.logoutDetail') : (isDelete ? i18n.t('dialog.irreversible') : spec.detail),
      confirmLabel: isDelete ? i18n.t('common.delete') : isLogout ? i18n.t('webui.logOut') : spec.buttons[1],
      cancelLabel: i18n.t('common.cancel'),
    },
  )
  return { response: accepted ? 1 : cancel }
}
