/**
 * MessagingSettingsPage
 *
 * The settings entry is currently hidden, but the Lark / Feishu configuration
 * remains available for future re-exposure and backwards-compatible routes.
 * Telegram and WhatsApp configuration are intentionally not rendered here.
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowUpRight,
  MoreHorizontal,
  Plus,
  PowerOff,
  RefreshCcw,
  Trash2,
} from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { SettingsSection, SettingsCard } from '@/components/settings'
import { MessagingPlatformIcon } from '@/components/messaging/MessagingPlatformIcon'
import { LarkConnectDialog } from '@/components/messaging/LarkConnectDialog'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import {
  messagingBindingsAtom,
  setMessagingBindingsAtom,
  type MessagingBinding,
} from '@/atoms/messaging'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { getSessionTitle } from '@/utils/session'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { MessagingPlatformRuntimeInfo } from '../../../shared/types'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'messaging',
}

export default function MessagingSettingsPage() {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const setBindings = useSetAtom(setMessagingBindingsAtom)
  const workspaceId = activeWorkspace?.id

  React.useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    const load = async () => {
      try {
        const rows = await window.electronAPI.getMessagingBindings()
        if (!cancelled) setBindings(rows as MessagingBinding[])
      } catch {
        // Keep the page quiet when the gateway is unavailable during startup.
      }
    }
    void load()
    const off = window.electronAPI.onMessagingBindingChanged((wsId) => {
      if (wsId === workspaceId) void load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [workspaceId, setBindings])

  if (!activeWorkspace) return null

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t('settings.messaging.title')} />
      <ScrollArea className="flex-1">
        <div className="space-y-6 p-6">
          <SettingsSection title={t('settings.messaging.title')}>
            <SettingsCard>
              <LarkPlatformRow workspaceId={activeWorkspace.id} />
            </SettingsCard>
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  )
}

function CardSeparator() {
  return <div className="mx-4 h-px bg-border/50" />
}

function LarkPlatformRow({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const allBindings = useAtomValue(messagingBindingsAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const { navigateToSession } = useNavigation()
  const [runtime, setRuntime] = React.useState<MessagingPlatformRuntimeInfo>(defaultRuntime)
  const [connectOpen, setConnectOpen] = React.useState(false)
  const [reconfigure, setReconfigure] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)

  const platformBindings = React.useMemo(
    () => allBindings
      .filter((binding) => binding.platform === 'lark')
      .sort((a, b) => b.createdAt - a.createdAt),
    [allBindings],
  )

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.getMessagingConfig().then((config) => {
      if (cancelled) return
      setRuntime((config?.runtime?.lark ?? defaultRuntime()) as MessagingPlatformRuntimeInfo)
    })
    const off = window.electronAPI.onMessagingPlatformStatus((wsId, platform, status) => {
      if (wsId === workspaceId && platform === 'lark') setRuntime(status)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [workspaceId])

  const runAfterMenuClose = React.useCallback((action: () => void) => {
    setMenuOpen(false)
    requestAnimationFrame(action)
  }, [])

  const handleConnect = () => {
    setReconfigure(false)
    setConnectOpen(true)
  }

  const handleReconfigure = () => {
    setReconfigure(true)
    setConnectOpen(true)
  }

  const handleDisconnect = async () => {
    try {
      await window.electronAPI.disconnectMessagingPlatform('lark')
      toast.success(t('settings.messaging.lark.disconnected'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'))
    }
  }

  const handleForget = async () => {
    try {
      await window.electronAPI.forgetMessagingPlatform('lark')
      toast.success(t('settings.messaging.lark.disconnected'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'))
    }
  }

  const handleUnbind = async (binding: MessagingBinding) => {
    try {
      await window.electronAPI.unbindMessagingBinding(binding.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'))
    }
  }

  return (
    <>
      <div>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <MessagingPlatformIcon platform="lark" size={22} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t('settings.messaging.lark.title')}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {t('settings.messaging.lark.apiType')} · {buildDescription(runtime, t)}
            </div>
          </div>

          {runtime.connected ? (
            <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  className="rounded-md p-1.5 transition-colors hover:bg-foreground/[0.05] data-[state=open]:bg-foreground/[0.05]"
                  data-state={menuOpen ? 'open' : 'closed'}
                  aria-label={t('common.more')}
                >
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="end">
                <StyledDropdownMenuItem onClick={() => runAfterMenuClose(handleReconfigure)}>
                  <RefreshCcw className="h-3.5 w-3.5" />
                  <span>{t('common.reconnect')}</span>
                </StyledDropdownMenuItem>
                <StyledDropdownMenuItem onClick={handleDisconnect}>
                  <PowerOff className="h-3.5 w-3.5" />
                  <span>{t('common.disable')}</span>
                </StyledDropdownMenuItem>
                <StyledDropdownMenuSeparator />
                <StyledDropdownMenuItem onClick={handleForget} variant="destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{t('common.disconnect')}</span>
                </StyledDropdownMenuItem>
              </StyledDropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button variant="outline" size="sm" onClick={handleConnect}>
              <Plus className="h-3.5 w-3.5" />
              {t('common.connect')}
            </Button>
          )}
        </div>

        {platformBindings.length > 0 && (
          <>
            <CardSeparator />
            <div className="divide-y divide-border/50">
              {platformBindings.map((binding) => (
                <FlatBindingRow
                  key={binding.id}
                  binding={binding}
                  sessionMetaMap={sessionMetaMap}
                  onOpen={() => navigateToSession(binding.sessionId)}
                  onUnbind={() => handleUnbind(binding)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <LarkConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        reconfigure={reconfigure}
      />
    </>
  )
}

function FlatBindingRow({
  binding,
  sessionMetaMap,
  onOpen,
  onUnbind,
}: {
  binding: MessagingBinding
  sessionMetaMap: Map<string, SessionMeta>
  onOpen: () => void
  onUnbind: () => void
}) {
  const meta = sessionMetaMap.get(binding.sessionId)
  const sessionLabel = meta ? getSessionTitle(meta) : binding.channelName || binding.channelId
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 pl-[52px]">
      <div className="min-w-0 truncate text-sm">{sessionLabel}</div>
      <RowActions onOpen={onOpen} onUnbind={onUnbind} />
    </div>
  )
}

function RowActions({ onOpen, onUnbind }: { onOpen: () => void; onUnbind: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={onOpen}>
        <ArrowUpRight className="h-3.5 w-3.5" />
        {t('settings.messaging.bindings.openSession')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={onUnbind}
      >
        {t('common.disconnect')}
      </Button>
    </div>
  )
}

function buildDescription(
  runtime: MessagingPlatformRuntimeInfo,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (runtime.connected) return t('settings.messaging.lark.connected')
  if (runtime.state === 'connecting') return t('common.connecting')
  if (runtime.state === 'error' && runtime.lastError) return runtime.lastError
  return t('settings.messaging.lark.notConnected', { defaultValue: 'Not connected' })
}

function defaultRuntime(): MessagingPlatformRuntimeInfo {
  return {
    platform: 'lark',
    configured: false,
    connected: false,
    state: 'disconnected',
    updatedAt: Date.now(),
  }
}
