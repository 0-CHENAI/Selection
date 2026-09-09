import * as React from 'react'
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { messagingDialogAtom } from '@/atoms/messaging'
import { PairingCodeDialog } from './PairingCodeDialog'

export function MessagingDialogHost() {
  const [state, setState] = useAtom(messagingDialogAtom)
  const { t } = useTranslation()
  const stateRef = React.useRef(state)
  stateRef.current = state

  const waiting = state.kind === 'pairing' && state.code !== null
  React.useEffect(() => {
    if (!waiting) return
    return window.electronAPI.onMessagingBindingChanged(async () => {
      const current = stateRef.current
      if (current.kind !== 'pairing' || current.code === null) return
      try {
        const bindings = await window.electronAPI.getMessagingBindings()
        if (bindings.some((binding) =>
          binding.enabled
          && binding.sessionId === current.sessionId
          && binding.platform === 'lark')) {
          toast.success(t('toast.messagingPaired'))
          setState({ kind: 'closed' })
        }
      } catch {
        // Keep the dialog open when the latest binding state cannot be read.
      }
    })
  }, [waiting, setState, t])

  return (
    <PairingCodeDialog
      open={state.kind === 'pairing'}
      onOpenChange={(open) => { if (!open) setState({ kind: 'closed' }) }}
      platform="lark"
      code={state.kind === 'pairing' ? state.code : null}
      expiresAt={state.kind === 'pairing' ? state.expiresAt : null}
      error={state.kind === 'pairing' ? state.error : undefined}
    />
  )
}
