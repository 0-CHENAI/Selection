import { forwardRef, type CSSProperties } from 'react'
import { Check, PanelsTopLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { officeProgressAttribute } from './office-collaboration-progress'

export interface OfficeCollaborationButtonFaceProps {
  label: string
  pressed: boolean
  expanded: boolean
  generating: boolean
  choosing?: boolean
  /** 0–1 fill. Absent leaves the button unfilled. */
  progress?: number
  pageTooltip?: string
  onClick: () => void
  onPointerDown?: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  onBlur?: () => void
}

/** The Office button chrome. It does not open a tooltip portal or load the document previewer. */
export const OfficeCollaborationButtonFace = forwardRef<HTMLButtonElement, OfficeCollaborationButtonFaceProps>(function OfficeCollaborationButtonFace({
  label,
  pressed,
  expanded,
  generating,
  choosing = false,
  progress,
  pageTooltip,
  onClick,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  onBlur,
}, ref) {
  return <button ref={ref} type="button" onClick={onClick} data-office-collaboration
    onPointerDown={onPointerDown}
    onPointerEnter={onPointerEnter}
    onPointerLeave={onPointerLeave}
    onBlur={onBlur}
    aria-label={label} aria-pressed={pressed}
    aria-expanded={expanded}
    data-generating={generating ? 'true' : undefined}
    data-ppt-tooltip={pageTooltip}
    style={!generating && pressed ? { '--shadow-color': 'var(--accent-rgb)' } as CSSProperties : undefined}
    className={cn(
      'relative h-[30px] overflow-hidden rounded-[8px] px-3 text-xs font-medium flex items-center gap-1.5 shrink-0',
      'outline-none select-none transition-colors duration-200 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring',
      generating
        ? 'bg-[color-mix(in_srgb,var(--background)_97%,var(--foreground)_3%)] text-accent shadow-minimal'
        : pressed
          ? 'bg-accent/10 text-accent shadow-tinted'
          : 'bg-[color-mix(in_srgb,var(--background)_97%,var(--foreground)_3%)] text-foreground/80 shadow-minimal hover:bg-foreground/5',
      !generating && choosing && 'bg-foreground/5',
    )}>
    {typeof progress === 'number' && <span aria-hidden="true" data-testid="office-collaboration-progress" data-progress={officeProgressAttribute(progress)} className="pointer-events-none absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--accent)_18%,var(--background))]" style={{ width: `${progress * 100}%` }} />}
    {!generating && (pressed ? <Check aria-hidden="true" className="size-3.5 shrink-0" /> : <PanelsTopLeft aria-hidden="true" className="size-3.5 shrink-0" />)}
    <span className="relative whitespace-nowrap tabular-nums">{label}</span>
  </button>
})
