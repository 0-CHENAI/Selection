/**
 * MessagingSettingsPage
 *
 * Workspace messaging connections and session bindings.
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
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
import { useMessagingPlatformRuntime, useWeixinNotificationAction } from '@/hooks/useMessagingPlatformRuntime'
import { SettingsCard, SettingsToggle } from '@/components/settings'
import { LarkIcon, WeixinIcon } from '@/components/messaging/MessagingPlatformIcon'
import { WeixinConnectDialog } from '@/components/messaging/WeixinConnectDialog'
import { LarkConnectDialog } from '@/components/messaging/LarkConnectDialog'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import {
  messagingBindingsAtom,
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
  const workspaceId = activeWorkspace?.remoteServer?.remoteWorkspaceId ?? activeWorkspace?.id

  if (!workspaceId) return null

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t('settings.messaging.title')} />
      <ScrollArea className="flex-1">
        <div className="p-6">
          <SettingsCard>
            <PlatformRow key={workspaceId + '-lark'} workspaceId={workspaceId} platform="lark" />
            <CardSeparator />
            <PlatformRow key={workspaceId + '-weixin'} workspaceId={workspaceId} platform="weixin" />
          </SettingsCard>
        </div>
      </ScrollArea>
    </div>
  )
}

function CardSeparator() {
  return <div className="mx-4 h-px bg-border/50" />
}

function PlatformRow({ workspaceId, platform }: { workspaceId: string; platform: 'lark' | 'weixin' }) {
  const { t } = useTranslation()
  const allBindings = useAtomValue(messagingBindingsAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const { navigateToSession } = useNavigation()
  const runtime = useMessagingPlatformRuntime(workspaceId, platform)
  const [connectOpen, setConnectOpen] = React.useState(false)
  const notifications = useWeixinNotificationAction()
  const [reconfigure, setReconfigure] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)

  const platformBindings = React.useMemo(
    () => allBindings
      .filter((binding) => binding.platform === platform && binding.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt - a.createdAt),
    [allBindings, workspaceId, platform],
  )

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
      await window.electronAPI.disconnectMessagingPlatform(platform)
      toast.success(t('settings.messaging.lark.notConnected'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'))
    }
  }

  const handleForget = async () => {
    try {
      await window.electronAPI.forgetMessagingPlatform(platform)
      toast.success(t('settings.messaging.lark.notConnected'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'))
    }
  }

  const handleUnbind = async (binding: MessagingBinding) => {
    try {
      const result = await window.electronAPI.unbindMessagingBinding(binding.id)
      if (!result.success) toast.error(t('common.error'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'))
    }
  }

  return (
    <>
      <div>
        <div className="flex items-center gap-3 px-4 py-3.5">
          {platform === 'lark' ? <LarkIcon size={22} /> : <WeixinIcon size={22} />}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t(`settings.messaging.${platform}.title`)}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {platform === 'lark' && <>{t('settings.messaging.lark.apiType')} · </>}{buildDescription(runtime, t)}
            </div>
          </div>

          {runtime.configured ? (
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

        {platform === 'weixin' && runtime.configured && (
          <>
            <CardSeparator />
            <SettingsToggle
              label={t('settings.messaging.weixin.unattended')}
              description={t('settings.messaging.weixin.unattendedDescription')}
              checked={runtime.notifyOnCompletion === true}
              disabled={notifications.saving || !runtime.connected}
              onCheckedChange={notifications.setEnabled}
            />
          </>
        )}

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

      {connectOpen && platform === 'weixin' && <WeixinConnectDialog onOpenChange={setConnectOpen} />}
      {connectOpen && platform === 'lark' && (
        <LarkConnectDialog open onOpenChange={setConnectOpen} reconfigure={reconfigure} />
      )}
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
  const sessionLabel = meta ? getSessionTitle(meta) : binding.sessionId
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 pl-[52px]">
      <div className="min-w-0">
        <div className="truncate text-sm">{sessionLabel}</div>
        <div className="truncate text-xs text-muted-foreground">{binding.platform === 'weixin' ? binding.channelName ?? binding.channelId : binding.channelId}</div>
      </div>
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
