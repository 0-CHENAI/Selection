/** Same ease as the composer office-collaboration chip: short opacity + transform. */
const BADGE_EASE = [0.22, 1, 0.36, 1] as const

/** Composer PRO badge enter/exit. GPU props only; reduced motion snaps. */
export function sessionModeBadgeMotion(reduceMotion: boolean | null | undefined) {
  const reduced = reduceMotion ?? true
  return {
    initial: reduced ? false as const : { opacity: 0, x: -4, scale: 0.96 },
    animate: { opacity: 1, x: 0, scale: 1 },
    exit: reduced ? { opacity: 0 } : { opacity: 0, x: -4, scale: 0.96 },
    transition: { duration: reduced ? 0 : 0.2, ease: BADGE_EASE },
  }
}
