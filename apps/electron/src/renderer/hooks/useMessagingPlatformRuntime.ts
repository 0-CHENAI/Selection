import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { MessagingPlatformRuntimeInfo } from '../../shared/types'

export function useMessagingPlatformRuntime(workspaceId: string, platform: 'lark' | 'weixin') {
  const { t } = useTranslation()
  const [runtime, setRuntime] = React.useState(() => defaultRuntime(platform))
  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.getMessagingConfig().then((config) => {
      if (cancelled) return
      setRuntime(config?.runtime?.[platform] ?? defaultRuntime(platform))
    }).catch(error => {
      if (!cancelled) toast.error(error instanceof Error ? error.message : t('common.error'))
    })
    const off = window.electronAPI.onMessagingPlatformStatus((wsId, updatedPlatform, status) => {
      if (wsId === workspaceId && updatedPlatform === platform) {
        cancelled = true // A live update supersedes the initial snapshot.
        setRuntime(status)
      }
    })
    return () => {
      cancelled = true
      off()
    }
  }, [workspaceId, platform, t])

  return runtime
}

export function useWeixinNotificationAction() {
  const { t } = useTranslation()
  const [saving, setSaving] = React.useState(false)
  const setEnabled = async (notifyOnCompletion: boolean) => {
    setSaving(true)
    try {
      await window.electronAPI.updateMessagingConfig({ platforms: { weixin: { notifyOnCompletion } } })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'))
    } finally {
      setSaving(false)
    }
  }
  return { saving, setEnabled }
}

function defaultRuntime(platform: string): MessagingPlatformRuntimeInfo {
  return {
    platform,
    configured: false,
    connected: false,
    state: 'disconnected',
    updatedAt: Date.now(),
  }
}
