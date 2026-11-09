import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "../lib/utils"
import {
  ERROR_TOOLTIP_COLLISION_PADDING,
  ERROR_TOOLTIP_CONTENT_CLASS,
  tooltipZIndexClass,
  useOverlayLayer,
} from "./overlay-layer"

function TooltipProvider({
  delayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      disableHoverableContent
      {...props}
    />
  )
}

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const insideOverlayLayer = useOverlayLayer()
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        {...props}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          tooltipZIndexClass(insideOverlayLayer),
          "overflow-hidden rounded-[8px] px-2.5 py-1.5 text-xs",
          "dark bg-background/80 backdrop-blur-xl backdrop-saturate-150 border border-border/50 text-foreground shadow-modal-small",
          "animate-in fade-in-0 duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-75",
          className
        )}
      />
    </TooltipPrimitive.Portal>
  )
}

function ErrorTooltipContent({
  className,
  collisionPadding = ERROR_TOOLTIP_COLLISION_PADDING,
  ...props
}: React.ComponentProps<typeof TooltipContent>) {
  return (
    <TooltipContent
      data-slot="error-tooltip-content"
      collisionPadding={collisionPadding}
      className={cn(ERROR_TOOLTIP_CONTENT_CLASS, className)}
      {...props}
    />
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, ErrorTooltipContent, TooltipProvider }
