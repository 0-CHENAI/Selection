/** Critically damped unfurl (Bell Toggle-style bounce: 0). Width + clip share this. */
const UNFURL = { type: 'spring' as const, duration: 0.32, bounce: 0 }

/** Soft fade; shorter than the unfurl so the chip is visible while it opens. */
const FADE_EASE = [0.22, 1, 0.36, 1] as const

/** Matches Tailwind `ml-2`. Animating it avoids an empty 8px pop beside a width-0 chip. */
export const sessionModeBadgeOpenMargin = 8

/** Inner clip: folded from the right so the chip unfurls from the left with a 4px cap. */
export const sessionModeBadgeClipFolded = 'inset(0 100% 0 0 round 4px)' as const
export const sessionModeBadgeClipOpen = 'inset(0 0% 0 0 round 4px)' as const

/**
 * Composer PRO badge enter/exit: width expand on the wrapper, clip-path unfurl on the
 * intrinsic-size inner chip (so % clip is not compounded by the animating width).
 * Reduced motion snaps; exit is opacity-only.
 */
export function sessionModeBadgeMotion(reduceMotion: boolean | null | undefined) {
  const reduced = reduceMotion ?? true
  return {
    initial: reduced ? false as const : { opacity: 0, width: 0, marginLeft: 0 },
    animate: { opacity: 1, width: 'auto' as const, marginLeft: sessionModeBadgeOpenMargin },
    exit: reduced ? { opacity: 0 } : { opacity: 0, width: 0, marginLeft: 0 },
    transition: reduced
      ? { duration: 0 }
      : { ...UNFURL, opacity: { type: 'tween' as const, duration: 0.2, ease: FADE_EASE } },
    clip: {
      initial: reduced ? false as const : { clipPath: sessionModeBadgeClipFolded },
      animate: { clipPath: sessionModeBadgeClipOpen },
      exit: reduced ? { clipPath: sessionModeBadgeClipOpen } : { clipPath: sessionModeBadgeClipFolded },
      transition: reduced ? { duration: 0 } : UNFURL,
    },
  }
}
