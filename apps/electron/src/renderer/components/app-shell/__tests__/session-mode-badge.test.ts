import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gsap } from 'gsap'
import {
  addProInkReveal,
  edgeOrbitEase,
  PRO_IDENTITY_DASH_DURATION,
  PRO_IDENTITY_EDGE_FADE_DURATION,
  PRO_IDENTITY_INK_DURATION,
  PRO_IDENTITY_INK_START_AT,
  PRO_IDENTITY_REDUCED_INK_DURATION,
  PRO_IDENTITY_REDUCED_START_AT,
  SESSION_MODE_BADGE_DASH_DURATION,
  SESSION_MODE_BADGE_EDGE_FADE_DURATION,
  SESSION_MODE_BADGE_INK_DURATION,
} from '../pro-identity-motion'

function read(relative: string): string {
  return readFileSync(join(import.meta.dir, relative), 'utf8')
}

describe('composer PRO badge motion', () => {
  it('scales the lockup ink and edge-trace language into a snappy toggle, and snaps when motion is reduced', () => {
    expect(SESSION_MODE_BADGE_INK_DURATION).toBeGreaterThanOrEqual(0.4)
    expect(SESSION_MODE_BADGE_INK_DURATION).toBeLessThanOrEqual(0.8)
    expect(SESSION_MODE_BADGE_INK_DURATION).toBe(0.6)
    expect(SESSION_MODE_BADGE_DASH_DURATION).toBeCloseTo(PRO_IDENTITY_DASH_DURATION * 0.6 / 1.8)
    expect(SESSION_MODE_BADGE_EDGE_FADE_DURATION).toBeCloseTo(PRO_IDENTITY_EDGE_FADE_DURATION * 0.6 / 1.8)
    expect(PRO_IDENTITY_INK_DURATION).toBe(1.8)
    expect(PRO_IDENTITY_INK_START_AT).toBe(1.1)
    expect(PRO_IDENTITY_DASH_DURATION).toBe(0.4)
    expect(PRO_IDENTITY_EDGE_FADE_DURATION).toBe(0.3)
    expect(PRO_IDENTITY_REDUCED_START_AT).toBe(0.25)
    expect(PRO_IDENTITY_REDUCED_INK_DURATION).toBe(0.15)
    expect(edgeOrbitEase(0)).toBe(0)
    expect(edgeOrbitEase(1)).toBe(1)

    const targets = { mode: {}, trace: {} }
    const live = addProInkReveal(gsap.timeline({ paused: true }), {
      reduced: false, startAt: 0, inkDuration: SESSION_MODE_BADGE_INK_DURATION,
      dashDuration: SESSION_MODE_BADGE_DASH_DURATION, fadeDuration: SESSION_MODE_BADGE_EDGE_FADE_DURATION, ...targets,
    })
    expect(live.duration()).toBeCloseTo(SESSION_MODE_BADGE_INK_DURATION)
    const reduced = addProInkReveal(gsap.timeline({ paused: true }), {
      reduced: true, startAt: 0, inkDuration: SESSION_MODE_BADGE_INK_DURATION,
      dashDuration: SESSION_MODE_BADGE_DASH_DURATION, fadeDuration: SESSION_MODE_BADGE_EDGE_FADE_DURATION, ...targets,
    })
    expect(reduced.duration()).toBeCloseTo(PRO_IDENTITY_REDUCED_INK_DURATION)

    const lockup = addProInkReveal(gsap.timeline({ paused: true }), {
      reduced: false, startAt: PRO_IDENTITY_INK_START_AT, inkDuration: PRO_IDENTITY_INK_DURATION,
      dashDuration: PRO_IDENTITY_DASH_DURATION, fadeDuration: PRO_IDENTITY_EDGE_FADE_DURATION, ...targets,
    })
    expect(lockup.duration()).toBeCloseTo(PRO_IDENTITY_INK_START_AT + PRO_IDENTITY_INK_DURATION)
    const lockupReduced = addProInkReveal(gsap.timeline({ paused: true }), {
      reduced: true, startAt: PRO_IDENTITY_REDUCED_START_AT, inkDuration: PRO_IDENTITY_INK_DURATION,
      dashDuration: PRO_IDENTITY_DASH_DURATION, fadeDuration: PRO_IDENTITY_EDGE_FADE_DURATION, ...targets,
    })
    expect(lockupReduced.duration()).toBeCloseTo(PRO_IDENTITY_REDUCED_START_AT + PRO_IDENTITY_REDUCED_INK_DURATION)
  })

  it('keeps the composer badge behind a reversible ink reveal instead of a hard mount', () => {
    const badge = read('../SessionModeBadge.tsx')
    const lockup = read('../ProIdentityLockup.tsx')
    const glyph = read('../ProIdentityGlyph.tsx')
    const input = read('../input/FreeFormInput.tsx')
    expect(input).toContain('{!pptMode && <SessionModeBadge mode={workMode} />}')
    expect(badge).toContain("mode === 'PRO'")
    expect(read('../pro-identity-motion.ts')).toContain("fromTo('.session-mode-badge', { autoAlpha: 0 }")
    expect(badge).toContain('addSessionModeBadgeReveal')
    expect(badge).toContain('timeline.reverse()')
    expect(badge).toContain('onReverseComplete')
    expect(badge).toContain('skipEnter')
    expect(badge).toContain("reduceMotion: '(prefers-reduced-motion: reduce)'")
    expect(badge).toContain('timeline.progress() === 1 && !timeline.reversed()')
    expect(badge).toContain('<ProIdentityGlyph')
    expect(badge).toContain('className="sr-only">PRO')
    expect(badge).toContain("from 'gsap'")
    expect(badge).not.toContain('AnimatePresence')
    expect(badge).not.toContain('sessionModeBadgeMotion')
    expect(badge).not.toContain('clipPath')
    expect(badge).not.toContain('from \'motion/react\'')
    expect(badge).toContain('className="session-mode-badge')
    expect(badge).toContain('aria-label={t(\'session.currentProMode\')}')
    expect(badge).toContain('onClick={reveal}')
    expect(badge).toContain('ProIdentityDialog')
    expect(badge).not.toContain('canHandover')
    expect(badge).not.toContain('handoverSession')
    expect(glyph).toContain('selectionProGlyphPath')
    expect(glyph).toContain('pro-identity-edge-trace')
    expect(lockup).toContain('addProIdentityLockupReveal')
    expect(lockup).not.toContain('CustomEase')
    expect(lockup).toContain('<ProIdentityGlyph')
    expect(lockup).toContain('paused(!open)')
    expect(lockup).not.toContain('.reverse(')
    expect(lockup).toContain('pro-identity-mark')
    expect(lockup).toContain('pro-identity-wordmark')
    expect(lockup).toContain('pro-identity-close')
  })
})
