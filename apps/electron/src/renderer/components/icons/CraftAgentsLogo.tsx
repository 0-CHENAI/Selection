import { cn } from "@/lib/utils"
import selectionIcon from "@/assets/selection-icon.svg"

interface CraftAgentsLogoProps {
  className?: string
}

/** Selection product mark. Kept as CraftAgentsLogo for existing call sites. */
export function CraftAgentsLogo({ className }: CraftAgentsLogoProps) {
  return (
    <img
      src={selectionIcon}
      alt="Selection"
      className={cn("aspect-square object-contain", className)}
    />
  )
}
