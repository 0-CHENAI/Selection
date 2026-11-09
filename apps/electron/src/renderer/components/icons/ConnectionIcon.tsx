/**
 * ConnectionIcon
 *
 * Displays the provider logo for an LLM connection.
 * ORDER uses the filled order mark. Other unknown providers fall back to a generic mark.
 *
 * Used in:
 * - AI Settings (connections list)
 * - FreeFormInput (model display)
 * - Session List (connection badge)
 * - New Session (model selector group names)
 */

import { Brain } from 'lucide-react'
import orderIconSvg from '@/assets/order-icon.svg?raw'
import { providerIcons, resolveConnectionBrandIcon } from '@/lib/provider-icons'
import { getModelDisplayName } from '@config/models'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import type { LlmConnectionWithStatus } from '../../../shared/types'

interface ConnectionIconProps {
  /** The connection to display an icon for */
  connection: Pick<LlmConnectionWithStatus, 'name' | 'providerType' | 'baseUrl' | 'piAuthProvider'> & { type?: string; defaultModel?: string }
  /** Size in pixels (default: 16) */
  size?: number
  /** Additional CSS classes */
  className?: string
  /** Show tooltip with connection name + model on hover (default: false) */
  showTooltip?: boolean
}

export function ConnectionIcon({ connection, size = 16, className = '', showTooltip = false }: ConnectionIconProps) {
  const brand = resolveConnectionBrandIcon({
    providerType: connection.providerType,
    type: connection.type,
    baseUrl: connection.baseUrl,
    piAuthProvider: connection.piAuthProvider,
  })

  // ORDER's mark is currentColor + evenodd. Inline it so the cutout follows
  // the surrounding text color. Other brands stay on <img> plus dark invert.
  const iconElement = brand.kind === 'order' ? (
    <span
      aria-hidden
      className={`inline-block shrink-0 text-foreground [&>svg]:block [&>svg]:h-full [&>svg]:w-full ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: orderIconSvg }}
    />
  ) : brand.src ? (
    <img
      src={brand.src}
      alt=""
      width={size}
      height={size}
      className={`rounded-[3px] flex-shrink-0 object-contain ${brand.src !== providerIcons.anthropic ? 'dark:invert' : ''} ${className}`}
      style={{ width: size, height: size }}
    />
  ) : (
    <div
      className={`rounded-[3px] bg-foreground/10 flex items-center justify-center flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <Brain
        className="text-foreground/50 flex-shrink-0"
        style={{ width: Math.round(size * 0.7), height: Math.round(size * 0.7) }}
      />
    </div>
  )

  if (!showTooltip) return iconElement

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {iconElement}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        <div className="text-center">
          <div>{connection.name}</div>
          {connection.defaultModel && <div className="text-[10px] opacity-60">{getModelDisplayName(connection.defaultModel)}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
