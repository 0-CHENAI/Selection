import { Zap } from 'lucide-react'
import { Item as MenuItem } from '@radix-ui/react-dropdown-menu'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import type { WorkMode } from '@craft-agent/shared/sessions/work-mode'
import './FastModeButton.css'

export function fastModeDetailKey(supported: boolean, busy?: boolean) {
  if (!supported) return 'chat.fastMode.unsupported' as const
  if (busy) return 'chat.fastMode.busy' as const
  return 'chat.fastMode.description' as const
}

/** Per-session OpenAI OAuth Fast flag, independent of reasoning effort. From PR #681. */
export function FastModeButton({ enabled, supported, busy, onChange, inMenu = false, workMode }: {
  enabled: boolean
  supported: boolean
  busy?: boolean
  onChange: (enabled: boolean) => void
  inMenu?: boolean
  workMode?: WorkMode
}) {
  const { t } = useTranslation()
  const inactive = !supported || !!busy
  const active = enabled && supported
  const description = t(fastModeDetailKey(supported, busy))
  const button = (
    <button
      type="button"
      role="switch"
      aria-label="Fast"
      aria-checked={active}
      aria-description={description}
      disabled={inactive}
      data-testid="gpt-oauth-fast"
      data-active={active || undefined}
      data-state={!supported ? 'unsupported' : busy ? 'busy' : active ? 'on' : 'off'}
      className="prompt-fast-button"
      onClick={inMenu ? undefined : () => onChange(!enabled)}
    >
      <Zap size={14} strokeWidth={1.8} aria-hidden="true" />
      <span>Fast</span>
    </button>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="prompt-fast-seat" data-work-mode={workMode}>
          {inMenu
            ? <MenuItem asChild disabled={inactive} onSelect={event => { event.preventDefault(); onChange(!enabled) }}>{button}</MenuItem>
            : button}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">Fast · {description}</TooltipContent>
    </Tooltip>
  )
}
