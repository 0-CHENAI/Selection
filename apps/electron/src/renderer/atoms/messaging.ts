/**
 * Messaging Gateway Atoms
 *
 * Workspace-level state for messaging bindings.
 * Populated by subscribing to messaging:bindingChanged push events.
 */

import { atom } from 'jotai'

export interface MessagingBinding {
  id: string
  workspaceId: string
  sessionId: string
  platform: string
  channelId: string
  /** Optional platform-native conversation thread identifier. */
  threadId?: number
  channelName?: string
  enabled: boolean
  createdAt: number
  /**
   * Per-binding access policy. Optional in the wire shape so legacy bindings
   * (created before access control existed) don't break atom updates. The
   * UI treats missing values as `'open'`.
   */
  accessMode?: 'inherit' | 'allow-list' | 'open'
  allowedSenderIds?: string[]
}

export const messagingBindingsAtom = atom<MessagingBinding[]>([])

export const messagingBindingsBySessionAtom = atom((get) => {
  const map = new Map<string, MessagingBinding[]>()
  for (const binding of get(messagingBindingsAtom)) {
    if (!binding.enabled) continue
    const list = map.get(binding.sessionId)
    if (list) {
      list.push(binding)
    } else {
      map.set(binding.sessionId, [binding])
    }
  }
  return map
})

export const setMessagingBindingsAtom = atom(
  null,
  (_get, set, bindings: MessagingBinding[]) => {
    set(messagingBindingsAtom, bindings.filter((binding) => binding.enabled))
  },
)

/**
 * Global messaging dialog state.
 *
 * Hoisted out of SessionMenu so dialogs survive context-menu / dropdown close.
 * Rendered by <MessagingDialogHost /> mounted at AppShell level.
 */
export type MessagingDialogState =
  | { kind: 'closed' }
  | {
      kind: 'pairing'
      platform: 'lark' | 'weixin'
      workspaceId: string
      sessionId: string
      code: string | null
      expiresAt: number | null
      existingBindings: MessagingBinding[]
      needsConnection?: boolean
      error?: string
    }

export const messagingDialogAtom = atom<MessagingDialogState>({ kind: 'closed' })

export function sessionPlatformBindings(bindings: MessagingBinding[], workspaceId: string, sessionId: string, platform: 'lark' | 'weixin') {
  return bindings.filter(binding => binding.enabled && binding.platform === platform
    && binding.workspaceId === workspaceId && binding.sessionId === sessionId)
}

export const openMessagingPairingAtom = atom(null, async (get, set, workspaceId: string, sessionId: string, platform: 'lark' | 'weixin' = 'lark') => {
  const pending = {
    kind: 'pairing' as const, platform, workspaceId, sessionId, code: null, expiresAt: null, existingBindings: [],
  }
  set(messagingDialogAtom, pending)
  try {
    const config = await window.electronAPI.getMessagingConfig()
    if (get(messagingDialogAtom) !== pending) return
    if (!config?.runtime[platform]?.connected) {
      set(messagingDialogAtom, { ...pending, needsConnection: true })
      return
    }
    const bindings = await window.electronAPI.getMessagingBindings()
    if (get(messagingDialogAtom) !== pending) return
    const existingBindings = sessionPlatformBindings(bindings, workspaceId, sessionId, platform)
    const { code, expiresAt } = await window.electronAPI.generateMessagingPairingCode(sessionId, platform)
    if (get(messagingDialogAtom) === pending) {
      set(messagingDialogAtom, { ...pending, code, expiresAt, existingBindings })
    }
  } catch (error) {
    if (get(messagingDialogAtom) === pending) {
      set(messagingDialogAtom, { ...pending, error: error instanceof Error ? error.message : String(error) })
    }
  }
})
