import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AtomIcon, type AtomIconHandle } from '@/components/ui/atom'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { resolveSwarmBadgeState } from './swarm-badge-state'

interface SwarmToggleProps {
  enabled: boolean
  onEnabledChange?: (enabled: boolean) => void | Promise<void>
  disabled?: boolean
  running?: boolean
}

export function SwarmToggle({
  enabled,
  onEnabledChange,
  disabled = false,
  running = false,
}: SwarmToggleProps) {
  const { t } = useTranslation()
  const [pending, setPending] = React.useState(false)
  const iconRef = React.useRef<AtomIconHandle>(null)
  const badgeState = resolveSwarmBadgeState(enabled, running)
  const isDisabled = disabled || pending || !onEnabledChange

  const handleChange = React.useCallback(async (checked: boolean) => {
    if (!onEnabledChange || pending || disabled) return
    setPending(true)
    try {
      await onEnabledChange(checked)
    } finally {
      setPending(false)
    }
  }, [disabled, onEnabledChange, pending])

  const handleBadgeClick = React.useCallback(() => {
    void handleChange(!enabled)
  }, [enabled, handleChange])

  const badgeDescription = badgeState === 'running'
    ? t('swarm.badgeRunning')
    : badgeState === 'enabled'
      ? t('swarm.badgeEnabled')
      : t('swarm.badgeIdle')

  React.useEffect(() => {
    if (enabled) {
      iconRef.current?.startAnimation()
      return
    }
    iconRef.current?.stopAnimation()
  }, [enabled])

  const badgeClassName = cn(
    'group h-[30px] rounded-[8px] pl-2.5 pr-2.5 text-xs font-medium leading-none',
    'flex shrink-0 items-center gap-1.5 outline-none select-none',
    'transition-[background-color,color,box-shadow,opacity] duration-200',
    'focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklch,var(--swarm-color)_45%,transparent)]',
    enabled
      ? 'shadow-tinted text-[color-mix(in_oklch,var(--swarm-color)_86%,var(--foreground))]'
      : 'shadow-minimal bg-[color-mix(in_srgb,var(--background)_97%,var(--foreground))] text-foreground/75 hover:bg-foreground/5 hover:text-foreground',
    isDisabled && !enabled && 'cursor-not-allowed opacity-55',
  )
  const badgeStyle = enabled ? {
    '--swarm-color': 'oklch(0.64 0.22 292)',
    '--shadow-color': '116, 76, 210',
    backgroundColor: 'color-mix(in oklch, var(--swarm-color) 13%, var(--background))',
  } as React.CSSProperties : {
    '--swarm-color': 'oklch(0.64 0.22 292)',
  } as React.CSSProperties
  const badgeContent = (
    <>
      <span className="flex size-3.5 shrink-0 items-center justify-center self-center">
        <AtomIcon ref={iconRef} size={14} aria-hidden="true" />
      </span>
      <span className="inline-flex items-center text-xs leading-none">{t('swarm.toggleLabel')}</span>
      <span className={cn('inline-flex items-center text-xs font-normal leading-none', enabled ? 'opacity-75' : 'opacity-50')}>
        {badgeDescription}
      </span>
    </>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${t('swarm.toggleLabel')} · ${badgeDescription}`}
          aria-pressed={enabled}
          disabled={isDisabled}
          onClick={handleBadgeClick}
          className={badgeClassName}
          style={badgeStyle}
        >
          {badgeContent}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        {disabled ? t('swarm.inheritedHint') : t('swarm.eligibilityHint')}
      </TooltipContent>
    </Tooltip>
  )
}
