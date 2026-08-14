import selectionIcon from "@/assets/selection-icon.svg"

interface CraftAppIconProps {
  className?: string
  size?: number
}

/** Selection product mark used as the in-app app icon. */
export function CraftAppIcon({ className, size = 64 }: CraftAppIconProps) {
  return (
    <img
      src={selectionIcon}
      alt="Selection"
      width={size}
      height={size}
      className={className}
    />
  )
}
