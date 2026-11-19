import { cn } from '../../lib/utils'

export function annotationColorToCss(color?: string): string {
  switch ((color ?? 'yellow').toLowerCase()) {
    case 'green':
      return 'rgba(74, 222, 128, 0.10)'
    case 'blue':
      return 'rgba(96, 165, 250, 0.10)'
    case 'pink':
      return 'rgba(244, 114, 182, 0.10)'
    case 'purple':
      return 'rgba(168, 85, 247, 0.10)'
    case 'yellow':
    default:
      return 'color-mix(in srgb, var(--annotation-accent, var(--info)) var(--annotation-highlight-strength, 12%), transparent)'
  }
}

export function getAnnotationRectVisual(rect: { pendingFollowUp?: boolean; sentFollowUp?: boolean }) {
  const isPendingFollowUp = !!rect.pendingFollowUp

  return {
    className: cn('absolute', isPendingFollowUp ? 'shadow-tinted' : undefined),
    style: {
      opacity: rect.sentFollowUp ? 0.58 : 1,
      ['--shadow-color' as string]: 'var(--annotation-accent-rgb, var(--info-rgb))',
      ['--shadow-border-opacity' as string]: isPendingFollowUp ? '0.14' : '0.08',
      ['--shadow-blur-opacity' as string]: isPendingFollowUp ? '0.10' : '0.05',
    },
  }
}

export function getAnnotationChipVisual(chip: { pendingFollowUp?: boolean; sentFollowUp?: boolean }) {
  const pending = !!chip.pendingFollowUp
  const sent = !!chip.sentFollowUp

  return {
    className: 'annotation-bubble absolute pointer-events-auto focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
    style: {
      backgroundColor: pending
        ? 'color-mix(in srgb, var(--annotation-accent, var(--info)) var(--annotation-pending-badge-strength, 55%), var(--background))'
        : sent
          ? 'color-mix(in srgb, var(--annotation-accent, var(--info)) 14%, var(--background))'
          : 'color-mix(in srgb, var(--annotation-accent, var(--info)) 20%, var(--background))',
      color: 'var(--foreground)',
    },
  }
}
