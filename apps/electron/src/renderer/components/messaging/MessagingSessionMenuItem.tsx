import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useSetAtom } from 'jotai'
import { MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import { navigate, routes } from '@/lib/navigate'
import { useMenuComponents } from '@/components/ui/menu-context'
import { messagingDialogAtom } from '@/atoms/messaging'

export type MessagingPlatform = 'lark'

export interface UseMessagingConnectOptions {
  sessionId: string
  onNotConfigured?: () => void
  classifyError?: (error: unknown, t: TFunction) => string
}

export function useMessagingConnect({
  sessionId,
  onNotConfigured,
  classifyError = classifyMessagingError,
}: UseMessagingConnectOptions) {
  const { t } = useTranslation()
  const setDialog = useSetAtom(messagingDialogAtom)

  return React.useCallback(async (_platform: MessagingPlatform = 'lark') => {
    try {
      const config = await window.electronAPI.getMessagingConfig()
      if (!config?.runtime?.lark?.connected) {
        if (onNotConfigured) onNotConfigured()
        else {
          navigate(routes.view.settings('messaging'))
          toast.info(t('toast.messagingNotConfigured'))
        }
        return
      }
    } catch {
      // Let the pairing request surface a concrete server error.
    }

    setDialog({ kind: 'pairing', platform: 'lark', sessionId, code: null, expiresAt: null })
    try {
      const result = await window.electronAPI.generateMessagingPairingCode(sessionId, 'lark')
      setDialog({
        kind: 'pairing',
        platform: 'lark',
        sessionId,
        code: result.code,
        expiresAt: result.expiresAt,
        botUsername: result.botUsername,
      })
    } catch (error) {
      setDialog({
        kind: 'pairing',
        platform: 'lark',
        sessionId,
        code: null,
        expiresAt: null,
        error: classifyError(error, t),
      })
    }
  }, [classifyError, onNotConfigured, sessionId, setDialog, t])
}

export function MessagingSessionMenuItem(props: UseMessagingConnectOptions) {
  const { t } = useTranslation()
  const { MenuItem, Sub, SubTrigger, SubContent } = useMenuComponents()
  const connect = useMessagingConnect(props)
  return (
    <Sub>
      <SubTrigger className="pr-2">
        <MessageSquare className="h-3.5 w-3.5" />
        <span className="flex-1">{t('sessionMenu.connectMessaging')}</span>
      </SubTrigger>
      <SubContent>
        <MenuItem onClick={() => connect('lark')}>
          <span>Lark / Feishu</span>
        </MenuItem>
      </SubContent>
    </Sub>
  )
}

export function classifyMessagingError(error: unknown, t: TFunction): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/platform not connected|no adapter|not configured/i.test(message)) {
    return t('toast.messagingNotConfigured')
  }
  if (/rate.?limit/i.test(message)) return t('toast.messagingRateLimited')
  return message
}
