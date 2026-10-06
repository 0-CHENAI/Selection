import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import type { WorkMode } from '@craft-agent/shared/sessions/work-mode'
import { ProIdentityDialog } from './ProIdentityDialog'

export function SessionModeBadge({ mode }: { mode?: WorkMode }) {
  return mode === 'PRO' ? <ProModeBadge /> : null
}

function ProModeBadge() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const clicks = useRef({ count: 0, at: 0 })
  const reveal = () => {
    const at = performance.now()
    const count = at - clicks.current.at <= 1000 ? clicks.current.count + 1 : 1
    clicks.current = { count, at }
    if (count === 3) {
      clicks.current = { count: 0, at: 0 }
      setOpen(true)
    }
  }
  return (
    <>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <button
            ref={trigger}
            type="button"
            onClick={reveal}
            onDoubleClick={event => event.preventDefault()}
            aria-label={t('session.currentProMode')}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="session-mode-badge ml-2 inline-flex h-5 shrink-0 cursor-pointer touch-manipulation select-none items-center rounded border border-[var(--pro-accent)] px-1.5 text-[10px] font-medium tracking-wide text-[var(--pro-accent)] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--pro-accent)]"
          >
            PRO
          </button>
        </TooltipTrigger>
        {!open && <TooltipContent side="top">{t('session.currentProMode')}</TooltipContent>}
      </Tooltip>
      <ProIdentityDialog open={open} onOpenChange={setOpen} trigger={trigger} />
    </>
  )
}
