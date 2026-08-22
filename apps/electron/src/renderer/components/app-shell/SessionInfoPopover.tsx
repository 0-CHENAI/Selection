import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { useAppShellContext, useSession } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { SessionFilesSection } from '../right-sidebar/SessionFilesSection'
import { formatTokenCount } from './input/model-picker-helpers'
import { formatUsageCost, formatUsageDuration } from './session-usage-format'

interface SessionInfoPopoverProps {
  sessionId: string
  sessionFolderPath?: string
  trigger: React.ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  contentClassName?: string
  presentation?: 'popover' | 'drawer'
}

const DEFAULT_POPOVER_CONTENT_CLASS = 'w-[360px] h-[460px] min-w-[200px] max-w-[420px] overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small p-0'
const DEFAULT_DRAWER_CONTENT_CLASS = [
  'data-[vaul-drawer-direction=bottom]:inset-x-2',
  'data-[vaul-drawer-direction=bottom]:bottom-2',
  'data-[vaul-drawer-direction=bottom]:mt-0',
  'data-[vaul-drawer-direction=bottom]:max-h-[min(82vh,42rem)]',
  'overflow-hidden rounded-[14px] border border-border/60 bg-background shadow-modal-small',
].join(' ')

export function SessionInfoPopover({
  sessionId,
  sessionFolderPath,
  trigger,
  side = 'top',
  align = 'end',
  sideOffset = 6,
  contentClassName,
  presentation = 'popover',
}: SessionInfoPopoverProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)

    if (!nextOpen) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('craft:focus-input', {
          detail: { sessionId },
        }))
      })
    }
  }, [sessionId])

  if (presentation === 'drawer') {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} direction="bottom">
        <DrawerTrigger asChild>
          {trigger}
        </DrawerTrigger>
        <DrawerContent
          className={cn(DEFAULT_DRAWER_CONTENT_CLASS, contentClassName)}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
          }}
        >
          <DrawerHeader className="border-b border-border/50 px-4 py-3 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="text-sm font-medium">{t('chat.sessionInfo')}</DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            <SessionInfoPopoverContent sessionId={sessionId} sessionFolderPath={sessionFolderPath} />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className={contentClassName ?? DEFAULT_POPOVER_CONTENT_CLASS}
        side={side}
        align={align}
        sideOffset={sideOffset}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
        }}
      >
        <SessionInfoPopoverContent sessionId={sessionId} sessionFolderPath={sessionFolderPath} />
      </PopoverContent>
    </Popover>
  )
}

function SessionInfoPopoverContent({ sessionId, sessionFolderPath }: { sessionId: string; sessionFolderPath?: string }) {
  const { t } = useTranslation()
  const session = useSession(sessionId)
  const { onRenameSession } = useAppShellContext()
  const [name, setName] = React.useState('')
  const renameTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const usage = session?.tokenUsage
  const lastTurn = usage?.lastTurn
  const currentTurn = usage?.currentTurn
  const displayedTurn = currentTurn ?? lastTurn
  const lastCall = usage?.lastCall
  const hasLegacyUsage = !displayedTurn && !!usage && usage.totalTokens > 0

  React.useEffect(() => {
    setName(session?.name || '')
  }, [session?.name])

  React.useEffect(() => {
    return () => {
      if (renameTimeoutRef.current) {
        clearTimeout(renameTimeoutRef.current)
      }
    }
  }, [])

  const handleNameChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setName(newName)

    if (renameTimeoutRef.current) {
      clearTimeout(renameTimeoutRef.current)
    }

    renameTimeoutRef.current = setTimeout(() => {
      const trimmed = newName.trim()
      if (trimmed) {
        onRenameSession(sessionId, trimmed)
      }
    }, 500)
  }, [onRenameSession, sessionId])

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 p-3 border-b border-border/50">
        <label className="text-xs font-medium text-muted-foreground block mb-1.5 select-none">
          {t("chat.title")}
        </label>
        <div className="rounded-lg bg-foreground-2 has-[:focus]:bg-background shadow-minimal transition-colors">
          <Input
            value={name}
            onChange={handleNameChange}
            placeholder={t("chat.titlePlaceholder")}
            className="h-9 py-2 text-sm border-0 shadow-none bg-transparent focus-visible:ring-0"
          />
        </div>
      </div>
      {(displayedTurn || hasLegacyUsage) && (
        <div className="shrink-0 border-b border-border/50 p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground select-none">
            {t('chat.usage.title')}
          </div>
          {displayedTurn ? (
            <>
              <div className="mb-2 text-xs text-foreground/80">
                {t(currentTurn ? 'chat.usage.currentTurn' : 'chat.usage.latestTurn')}
              </div>
              <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                <UsageStat label={t('chat.usage.modelCalls')} value={String(displayedTurn.modelCallCount)} />
                <UsageStat label={t('chat.usage.duration')} value={formatUsageDuration(displayedTurn.wallClockMs)} />
                <UsageStat label={t('chat.usage.cost')} value={formatUsageCost(displayedTurn.costUsd)} />
                <UsageStat label={t('chat.usage.input')} value={formatTokenCount(displayedTurn.inputTokens)} />
                <UsageStat label={t('chat.usage.output')} value={formatTokenCount(displayedTurn.outputTokens)} />
                <UsageStat label={t('chat.usage.cacheRead')} value={formatTokenCount(displayedTurn.cacheReadTokens)} />
              </dl>
              {lastCall && (!currentTurn || currentTurn.modelCallCount > 0) && (
                <div className="mt-2 border-t border-border/40 pt-2">
                  <div className="mb-1 text-[11px] text-muted-foreground">{t('chat.usage.lastCall')}</div>
                  <dl className="grid grid-cols-3 gap-x-3 text-xs">
                    <UsageStat label={t('chat.usage.input')} value={formatTokenCount(lastCall.inputTokens)} />
                    <UsageStat label={t('chat.usage.output')} value={formatTokenCount(lastCall.outputTokens)} />
                    <UsageStat label={t('chat.usage.cacheRead')} value={formatTokenCount(lastCall.cacheReadTokens)} />
                  </dl>
                </div>
              )}
            </>
          ) : usage ? (
            <>
              <div className="mb-2 text-xs text-foreground/80">{t('chat.usage.legacy')}</div>
              <dl className="grid grid-cols-3 gap-x-3 text-xs">
                <UsageStat label={t('chat.usage.input')} value={formatTokenCount(usage.inputTokens)} />
                <UsageStat label={t('chat.usage.output')} value={formatTokenCount(usage.outputTokens)} />
                <UsageStat label={t('chat.usage.cost')} value={formatUsageCost(usage.costUsd)} />
              </dl>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{t('chat.usage.legacyHint')}</p>
            </>
          ) : null}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        <SessionFilesSection
          sessionId={sessionId}
          sessionFolderPath={sessionFolderPath}
          hideHeader={false}
          className="h-full min-h-0"
        />
      </div>
    </div>
  )
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-foreground">{value}</dd>
    </div>
  )
}
