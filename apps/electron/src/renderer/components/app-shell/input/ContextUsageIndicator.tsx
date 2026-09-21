import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Spinner, Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import {
  contextBarShares,
  contextUsagePercent,
  contextUsageRatio,
  contextUsageRingColor,
  contextUsageRows,
  contextUsageTone,
  formatCacheHitRate,
  formatContextTokenCount,
  shouldShowContextUsage,
  type ContextStatus,
} from './context-usage'

const RING_SIZE = 16
const RING_STROKE = 1.75
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const DRAWER_CONTENT_CLASS = [
  'data-[vaul-drawer-direction=bottom]:inset-x-2',
  'data-[vaul-drawer-direction=bottom]:bottom-2',
  'data-[vaul-drawer-direction=bottom]:mt-0',
  'data-[vaul-drawer-direction=bottom]:max-h-[min(82vh,28rem)]',
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
  const used = formatContextTokenCount(inputTokens)
  const windowLabel = contextStatus.contextWindow
    ? formatContextTokenCount(contextStatus.contextWindow, 'window')
    : undefined
  const title = t('chat.contextUsage')
  const fullLabel = percent != null ? t('chat.contextFull', { percent: `${percent}%` }) : undefined
  const usedOf = windowLabel
    ? t('chat.contextUsedOf', { used, window: windowLabel })
    : t('chat.contextUsedTokens', { used })
  const hint = [title, fullLabel].filter(Boolean).join(' · ')
  const trigger = (
    <button
      type="button"
      aria-label={[title, fullLabel, usedOf].filter(Boolean).join(', ')}
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={() => handleOpenChange(!open)}
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
    fullLabel,
    usedOf,
    inputTokens,
    contextWindow: contextStatus.contextWindow,
    breakdown: contextStatus.contextBreakdown,
    cacheHitRate: contextStatus.cacheHitRate,
    onClose: () => handleOpenChange(false),
  }

  const ring = open ? trigger : (
    <Tooltip>
      <TooltipTrigger asChild>
        {trigger}
      </TooltipTrigger>
      <TooltipContent side="top">{hint}</TooltipContent>
    </Tooltip>
  )

  if (compact) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} direction="bottom">
        {ring}
        <DrawerContent
          className={DRAWER_CONTENT_CLASS}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
          <div className="px-4 py-4">
            <ContextUsagePopoverBody {...details} />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverAnchor asChild>
        <span className="inline-flex">{ring}</span>
      </PopoverAnchor>
      <PopoverContent
        className="w-[min(28rem,calc(100vw-1.5rem))] rounded-[8px] bg-background p-4 text-foreground shadow-modal-small"
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
  fullLabel,
  usedOf,
  inputTokens,
  contextWindow,
  breakdown,
  cacheHitRate,
  onClose,
}: {
  title: string
  fullLabel?: string
  usedOf: string
  inputTokens: number
  contextWindow?: number
  breakdown?: ContextStatus['contextBreakdown']
  cacheHitRate?: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const cacheLabel = formatCacheHitRate(cacheHitRate)
  const rows = contextUsageRows(breakdown)
  const shares = contextBarShares(rows, inputTokens, contextWindow)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-foreground">{title}</div>
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onClose}
          className="-mr-1 inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-muted-foreground transition-opacity hover:bg-foreground/5 hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <div>{fullLabel}</div>
        <div className="shrink-0 font-mono">{usedOf}</div>
      </div>
      <div className="flex h-1 overflow-hidden rounded-full bg-foreground/10">
        {rows.length > 0 ? rows.map((row, index) => (
          <BreakdownSegment
            key={row.id}
            share={shares.used[index] ?? 0}
            color={row.color}
          />
        )) : (
          <BreakdownSegment share={shares.used[0] ?? 0} color="#F87171" />
        )}
        <BreakdownSegment share={shares.remaining} className="bg-foreground/12" />
      </div>
      {rows.length > 0 && (
        <ul className="grid gap-2 text-xs">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                />
                <span className="truncate text-muted-foreground">{t(row.labelKey)}</span>
              </div>
              <span className="shrink-0 font-mono text-foreground/80">
                {formatContextTokenCount(row.tokens)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{t('chat.contextEstimateNote')}</p>
      )}
      {cacheLabel && (
        <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-2 text-xs">
          <span className="text-muted-foreground">{t('chat.contextCacheHitRate')}</span>
          <span className="font-mono text-foreground/80">{cacheLabel}</span>
        </div>
      )}
    </div>
  )
}

function BreakdownSegment({
  share,
  color,
  className,
}: {
  share: number
  color?: string
  className?: string
}) {
  if (share <= 0) return null
  return (
    <div
      className={cn('h-full min-w-[2px]', className)}
      style={{
        width: `${share * 100}%`,
        ...(color ? { backgroundColor: color } : {}),
      }}
    />
  )
}

export type { ContextStatus }
