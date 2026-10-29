import { Zap } from 'lucide-react'
import { Item as MenuItem } from '@radix-ui/react-dropdown-menu'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import './PromptBarEffects.css'

/** Same control in the desktop menu and compact drawer; never changes effort. */
export function FastModeButton({ enabled, supported, busy, onChange, inMenu = false }: {
  enabled: boolean
  supported: boolean
  busy?: boolean
  onChange: (enabled: boolean) => void
  inMenu?: boolean
}) {
  const { t } = useTranslation()
  const inactive = !supported || !!busy
  const active = enabled && supported
  const description = t(!supported ? 'chat.fastMode.unsupported' : busy ? 'chat.fastMode.busy' : 'chat.fastMode.description')
  const button = <button type="button" role="switch" aria-label="Fast" aria-checked={active}
    aria-description={description} disabled={inactive} data-testid="gpt-oauth-fast"
    data-active={active || undefined} className="prompt-fast-button"
    onClick={inMenu ? undefined : () => onChange(!enabled)}>
    <Zap size={17} strokeWidth={1.8} aria-hidden="true" />
  </button>
  return <Tooltip>
    <TooltipTrigger asChild>
      <span className="prompt-fast-seat">
        {inMenu ? <MenuItem asChild disabled={inactive} onSelect={event => { event.preventDefault(); onChange(!enabled) }}>{button}</MenuItem> : button}
      </span>
    </TooltipTrigger>
    <TooltipContent side="top" className="max-w-64">Fast · {description}</TooltipContent>
  </Tooltip>
}
