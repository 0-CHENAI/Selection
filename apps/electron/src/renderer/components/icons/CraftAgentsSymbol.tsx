import { cn } from "@/lib/utils"
import selectionIcon from "@/assets/selection-icon.svg"

interface CraftAgentsSymbolProps {
  className?: string
}

/**
 * Selection swan product mark.
 * The black source artwork is inverted for dark surfaces.
 */
export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return (
    <img
      src={selectionIcon}
      alt=""
      className={cn("aspect-square object-contain dark:invert", className)}
    />
  )
}
