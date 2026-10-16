import type { SVGProps } from "react"

/**
 * Immersive-mode toggle glyph.
 * Off: the three-column shell. On: a single centered conversation pane.
 */
export function ImmersiveModeIcon({ active = false, ...props }: SVGProps<SVGSVGElement> & { active?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {active ? (
        <path d="M8 4.5h8c1.4 0 2.1 0 2.6.4.6.4.9 1.1.9 2.6v9c0 1.5-.3 2.2-.9 2.6-.5.4-1.2.4-2.6.4H8c-1.4 0-2.1 0-2.6-.4-.6-.4-.9-1.1-.9-2.6v-9c0-1.5.3-2.2.9-2.6.5-.4 1.2-.4 2.6-.4Z" />
      ) : (
        <path d="M8 4.5v15M16 4.5v15M5 4.5h14c.8 0 1.5.7 1.5 1.5v12c0 .8-.7 1.5-1.5 1.5H5c-.8 0-1.5-.7-1.5-1.5V6c0-.8.7-1.5 1.5-1.5Z" />
      )}
    </svg>
  )
}
