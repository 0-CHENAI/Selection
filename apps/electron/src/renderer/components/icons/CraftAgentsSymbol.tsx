import { cn } from "@/lib/utils"
import selectionIcon from "@/assets/selection-icon.svg"

interface CraftAgentsSymbolProps {
  className?: string
}

/**
 * Selection product mark (circular serif I).
 * Brand fills come from the SVG; theme accent is not applied.
 */
export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return (
    <img
      src={selectionIcon}
      alt=""
      className={cn("aspect-square object-contain", className)}
    />
  )
}
