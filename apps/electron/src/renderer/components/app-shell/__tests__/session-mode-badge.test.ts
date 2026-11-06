import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  sessionModeBadgeClipFolded,
  sessionModeBadgeClipOpen,
  sessionModeBadgeMotion,
  sessionModeBadgeOpenMargin,
} from '../session-mode-badge-motion'

function read(relative: string): string {
  return readFileSync(join(import.meta.dir, relative), 'utf8')
}

describe('composer PRO badge motion', () => {
  it('unfurls width and clip from the left, and snaps to opacity-only when motion is reduced', () => {
    const live = sessionModeBadgeMotion(false)
    expect(live.initial).toEqual({ opacity: 0, width: 0, marginLeft: 0 })
    expect(live.animate).toEqual({ opacity: 1, width: 'auto', marginLeft: sessionModeBadgeOpenMargin })
    expect(live.exit).toEqual({ opacity: 0, width: 0, marginLeft: 0 })
    expect(live.transition).toEqual({
      type: 'spring',
      duration: 0.32,
      bounce: 0,
      opacity: { type: 'tween', duration: 0.2, ease: [0.22, 1, 0.36, 1] },
    })
    expect(live.clip.initial).toEqual({ clipPath: sessionModeBadgeClipFolded })
    expect(live.clip.animate).toEqual({ clipPath: sessionModeBadgeClipOpen })
    expect(live.clip.exit).toEqual({ clipPath: sessionModeBadgeClipFolded })
    expect(live.clip.transition).toEqual({ type: 'spring', duration: 0.32, bounce: 0 })
    expect(sessionModeBadgeClipFolded).toBe('inset(0 100% 0 0 round 4px)')
    expect(sessionModeBadgeClipOpen).toBe('inset(0 0% 0 0 round 4px)')
    expect(sessionModeBadgeOpenMargin).toBe(8)

    const reduced = sessionModeBadgeMotion(true)
    expect(reduced.initial).toBe(false)
    expect(reduced.exit).toEqual({ opacity: 0 })
    expect(reduced.transition.duration).toBe(0)
    expect(reduced.clip.initial).toBe(false)
    expect(reduced.clip.exit).toEqual({ clipPath: sessionModeBadgeClipOpen })
    expect(reduced.clip.transition.duration).toBe(0)

    expect(sessionModeBadgeMotion(null).transition.duration).toBe(0)
    expect(sessionModeBadgeMotion(undefined).transition.duration).toBe(0)
  })

  it('keeps the composer badge behind enter/exit presence instead of a hard mount', () => {
    const badge = read('../SessionModeBadge.tsx')
    const input = read('../input/FreeFormInput.tsx')
    expect(input).toContain('{!pptMode && <SessionModeBadge mode={workMode} />}')
    expect(badge).toContain('<AnimatePresence initial={false}>')
    expect(badge).toContain("mode === 'PRO'")
    expect(badge).toContain('useReducedMotion')
    expect(badge).toContain('const { clip, ...frame } = sessionModeBadgeMotion(reduceMotion)')
    expect(badge).toContain('{...frame}')
    expect(badge).toContain('{...clip}')
    expect(badge).toContain('overflow-hidden')
    expect(badge).toContain('min-w-0')
    expect(badge).toContain('whitespace-nowrap')
    expect(badge).toContain("style={{ transformOrigin: 'left center' }}")
    expect(badge).not.toContain('originX')
    expect(badge).not.toContain('originY')
    expect(badge).not.toContain('react-bits')
    expect(badge).not.toContain('from \'gsap\'')
    expect(badge).toContain('className="session-mode-badge')
    expect(badge).toContain('aria-label={t(\'session.currentProMode\')}')
    expect(badge).toContain('onClick={reveal}')
    expect(badge).toContain('ProIdentityDialog')
    expect(badge).not.toContain('canHandover')
    expect(badge).not.toContain('handoverSession')
  })
})
