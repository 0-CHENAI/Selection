"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer data-[state=checked]:bg-foreground data-[state=unchecked]:bg-foreground/25 focus-visible:border-foreground/30 focus-visible:ring-foreground/15 in-[.dark]:data-[state=unchecked]:bg-foreground/20 inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border border-transparent px-px transition-colors outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-[18px] rounded-full bg-white shadow-xs transition-transform data-[state=checked]:translate-x-[16px] in-[.dark]:data-[state=checked]:bg-background motion-reduce:transition-none"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
