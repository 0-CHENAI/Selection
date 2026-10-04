import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import type { WorkMode } from '@craft-agent/shared/sessions/work-mode'

export function SessionModeBadge({ mode }: { mode?: WorkMode }) {
  const { t } = useTranslation()
  if (mode !== 'PRO') return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={t('session.currentProMode')}
          className="session-mode-badge ml-2 inline-flex h-5 shrink-0 cursor-default items-center rounded border border-[var(--pro-accent)] px-1.5 text-[10px] font-medium tracking-wide text-[var(--pro-accent)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--pro-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          PRO
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{t('session.currentProMode')}</TooltipContent>
    </Tooltip>
  )
}
