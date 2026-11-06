import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sessionModeBadgeMotion } from '../session-mode-badge-motion'

function read(relative: string): string {
  return readFileSync(join(import.meta.dir, relative), 'utf8')
}

describe('composer PRO badge motion', () => {
  it('fades and slightly scales/slides in and out, and snaps when motion is reduced', () => {
    const live = sessionModeBadgeMotion(false)
    expect(live.initial).toEqual({ opacity: 0, x: -4, scale: 0.96 })
    expect(live.animate).toEqual({ opacity: 1, x: 0, scale: 1 })
    expect(live.exit).toEqual({ opacity: 0, x: -4, scale: 0.96 })
    expect(live.transition.duration).toBe(0.2)
    expect(live.transition.ease).toEqual([0.22, 1, 0.36, 1])

    const reduced = sessionModeBadgeMotion(true)
    expect(reduced.initial).toBe(false)
    expect(reduced.exit).toEqual({ opacity: 0 })
    expect(reduced.transition.duration).toBe(0)

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
    expect(badge).toContain('sessionModeBadgeMotion(reduceMotion)')
    expect(badge).toContain("style={{ transformOrigin: 'left center' }}")
    expect(badge).not.toContain('originX')
    expect(badge).not.toContain('originY')
    expect(badge).toContain('className="session-mode-badge')
    expect(badge).toContain('aria-label={t(\'session.currentProMode\')}')
    expect(badge).not.toContain('canHandover')
    expect(badge).not.toContain('handoverSession')
  })
})
