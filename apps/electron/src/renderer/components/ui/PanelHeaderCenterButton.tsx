import * as React from 'react'
import { forwardRef } from 'react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { cn } from '@/lib/utils'

interface PanelHeaderCenterButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon as React element - caller controls size/styling */
  icon: React.ReactNode
  /** Optional tooltip text */
  tooltip?: string
  /** Additional purpose text below the tooltip title. */
  tooltipDescription?: string
  /** Hide a tooltip while another explanation surface is open, without remounting the button. */
  tooltipDisabled?: boolean
}

export const PanelHeaderCenterButton = forwardRef<HTMLButtonElement, PanelHeaderCenterButtonProps>(
  ({ icon, tooltip, tooltipDescription, tooltipDisabled, className, ...props }, ref) => {
    const [tooltipOpen, setTooltipOpen] = React.useState(false)
    const button = (
      <button
        ref={ref}
        type="button"
        aria-label={props['aria-label'] ?? tooltip}
        className={cn(
          "panel-header-btn inline-flex items-center justify-center",
          "p-1.5 shrink-0 rounded-[6px] titlebar-no-drag",
          "bg-background shadow-minimal",
          "opacity-70 hover:opacity-100",
          "transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
          className
        )}
        {...props}
      >
        {icon}
      </button>
    )

    if (tooltip) {
      return (
        <Tooltip open={!tooltipDisabled && tooltipOpen} onOpenChange={setTooltipOpen}>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="bottom" className={tooltipDescription ? 'max-w-80' : undefined}>
            <div className={tooltipDescription ? 'font-medium' : undefined}>{tooltip}</div>
            {tooltipDescription && <p className="mt-1 text-xs leading-relaxed font-normal">{tooltipDescription}</p>}
          </TooltipContent>
        </Tooltip>
      )
    }

    return button
  }
)
PanelHeaderCenterButton.displayName = 'PanelHeaderCenterButton'
