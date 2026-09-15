import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@craft-agent/ui'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { formatTokenCount } from './model-picker-helpers'
import {
  breakdownShare,
  breakdownTotal,
  contextUsagePercent,
  contextUsageRatio,
  contextUsageRingColor,
  contextUsageTone,
  formatCacheHitRate,
  shouldShowContextUsage,
  type ContextStatus,
  type ContextUsageBreakdown,
} from './context-usage'

const RING_SIZE = 16
const RING_STROKE = 1.75
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const DRAWER_CONTENT_CLASS = [
  'data-[vaul-drawer-direction=bottom]:inset-x-2',
  'data-[vaul-drawer-direction=bottom]:bottom-2',
  'data-[vaul-drawer-direction=bottom]:mt-0',
  'data-[vaul-drawer-direction=bottom]:max-h-[min(82vh,24rem)]',
  'overflow-hidden rounded-[14px] border border-border/60 bg-background shadow-modal-small',
].join(' ')

export function ContextUsageIndicator({
  contextStatus,
  compact = false,
  sessionId,
}: {
  contextStatus?: ContextStatus
  compact?: boolean
  sessionId?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen || !sessionId) return
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('craft:focus-input', {
        detail: { sessionId },
      }))
    })
  }, [sessionId])

  const visible = shouldShowContextUsage(contextStatus)
  React.useEffect(() => {
    if (!visible) setOpen(false)
  }, [visible])

  if (!shouldShowContextUsage(contextStatus)) return null

  const inputTokens = contextStatus.inputTokens
  const ratio = contextUsageRatio(inputTokens, contextStatus.contextWindow)
  const percent = contextUsagePercent(ratio)
  const tone = contextUsageTone(ratio)
  const fill = Math.min(1, Math.max(0, ratio ?? 0))
  const used = formatTokenCount(inputTokens)
  const windowLabel = contextStatus.contextWindow
    ? formatTokenCount(contextStatus.contextWindow)
    : undefined
  const title = percent != null
    ? t('chat.contextUsed', { percent: `${percent}%` })
    : t('chat.context')
  const usedOf = windowLabel
    ? t('chat.contextUsedOf', { used, window: windowLabel })
    : `~${used}`
  const trigger = (
    <button
      type="button"
      aria-label={`${title}, ${usedOf}`}
      className={cn(
        'relative inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-foreground/5 transition-colors',
        open && 'bg-foreground/5',
        tone === 'info' && 'text-[var(--info-text)]',
        tone === 'critical' && 'text-[var(--destructive-text)]',
      )}
    >
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className={cn(contextStatus.isCompacting && 'opacity-30')}
        aria-hidden
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={RING_STROKE}
          className="opacity-25"
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke={contextUsageRingColor(tone)}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - fill)}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </svg>
      {contextStatus.isCompacting && (
        <Spinner className="absolute h-3 w-3" />
      )}
    </button>
  )

  const details = {
    title,
    usedOf,
    showTitle: !compact,
    breakdown: contextStatus.contextBreakdown,
    cacheHitRate: contextStatus.cacheHitRate,
  }

  if (compact) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} direction="bottom">
        <DrawerTrigger asChild>
          {trigger}
        </DrawerTrigger>
        <DrawerContent
          className={DRAWER_CONTENT_CLASS}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DrawerHeader className="border-b border-border/50 px-4 py-3 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="text-sm font-medium">{title}</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 py-3">
            <ContextUsagePopoverBody {...details} />
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
        className="w-[280px] rounded-[8px] bg-background p-3 text-foreground shadow-modal-small"
        side="top"
        align="end"
        sideOffset={6}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ContextUsagePopoverBody {...details} />
      </PopoverContent>
    </Popover>
  )
}

function ContextUsagePopoverBody({
  title,
  usedOf,
  showTitle,
  breakdown,
  cacheHitRate,
}: {
  title: string
  usedOf: string
  showTitle: boolean
  breakdown?: ContextUsageBreakdown
  cacheHitRate?: number
}) {
  const { t } = useTranslation()
  const cacheLabel = formatCacheHitRate(cacheHitRate)
  const total = breakdown ? breakdownTotal(breakdown) : 0

  return (
    <div className="space-y-3">
      {showTitle ? (
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="shrink-0 font-mono text-xs text-muted-foreground">{usedOf}</div>
        </div>
      ) : (
        <div className="font-mono text-xs text-muted-foreground">{usedOf}</div>
      )}
      {breakdown && total > 0 && (
        <>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-foreground/8">
            <BreakdownSegment share={breakdownShare(breakdown.systemPrompt, total)} className="bg-foreground/35" />
            <BreakdownSegment share={breakdownShare(breakdown.tools, total)} className="bg-foreground/55" />
            <BreakdownSegment share={breakdownShare(breakdown.messages, total)} className="bg-foreground/80" />
          </div>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-xs">
            <UsageStat label={t('chat.contextSystemPrompt')} value={`~${formatTokenCount(breakdown.systemPrompt)}`} />
            <UsageStat label={t('chat.contextTools')} value={`~${formatTokenCount(breakdown.tools)}`} />
            <UsageStat label={t('chat.contextMessages')} value={`~${formatTokenCount(breakdown.messages)}`} />
          </dl>
        </>
      )}
      {cacheLabel && (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 text-xs">
          <UsageStat label={t('chat.contextCacheHitRate')} value={cacheLabel} />
        </dl>
      )}
    </div>
  )
}

function BreakdownSegment({ share, className }: { share: number; className: string }) {
  if (share <= 0) return null
  return <div className={cn('h-full min-w-0', className)} style={{ width: `${share * 100}%` }} />
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-foreground">{value}</dd>
    </>
  )
}

export type { ContextStatus }
