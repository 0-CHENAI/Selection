import * as React from 'react'
import { useAtom, useSetAtom, useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { messagingDialogAtom, sessionPlatformBindings, setMessagingBindingsAtom } from '@/atoms/messaging'
import { navigate, routes } from '@/lib/navigate'
import { PairingCodeDialog } from './PairingCodeDialog'

export function MessagingDialogHost({ workspaceId }: { workspaceId?: string | null }) {
  const [state, setState] = useAtom(messagingDialogAtom)
  const store = useStore()
  const setBindings = useSetAtom(setMessagingBindingsAtom)
  const { t } = useTranslation()

  React.useEffect(() => {
    setBindings([])
    return () => { setBindings([]) }
  }, [workspaceId, setBindings])

  React.useEffect(() => {
    if (state.kind === 'pairing' && state.workspaceId !== workspaceId) {
      setState({ kind: 'closed' })
      return
    }
    if (!workspaceId) return
    let active = true
    let latestRead = 0
    const refresh = async () => {
      const read = ++latestRead
      try {
        const bindings = await window.electronAPI.getMessagingBindings()
        if (!active || read !== latestRead) return
        const rows = bindings.filter(binding => binding.workspaceId === workspaceId)
        setBindings(rows)
        if (state.kind === 'pairing' && state.code && store.get(messagingDialogAtom) === state) {
          const existingIds = new Set(state.existingBindings.map(binding => binding.id))
          const paired = sessionPlatformBindings(rows, workspaceId, state.sessionId, state.platform)
            .some(binding => !existingIds.has(binding.id))
          if (paired) {
            setState({ kind: 'closed' })
            toast.success(t('toast.messagingPaired'))
          }
        }
      } catch {
        // A later binding event can retry the read.
      }
    }
    const off = window.electronAPI.onMessagingBindingChanged(id => {
      if (id === workspaceId) void refresh()
    })
    void refresh()
    return () => {
      active = false
      off()
    }
  }, [state, workspaceId, setState, setBindings, store, t])

  if (state.kind !== 'pairing' || state.workspaceId !== workspaceId) return null
  return (
    <PairingCodeDialog
      open
      onOpenChange={open => { if (!open) setState({ kind: 'closed' }) }}
      platform={state.platform}
      code={state.code}
      expiresAt={state.expiresAt}
      error={state.error}
      existingBindings={state.existingBindings}
      onOpenSettings={state.needsConnection ? () => {
        setState({ kind: 'closed' })
        navigate(routes.view.settings('messaging'))
      } : undefined}
    />
  )
}
