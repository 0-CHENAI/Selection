import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  THINKING_SHIMMER_MS,
  THINKING_SWAP_BLUR_PX,
  THINKING_SWAP_DISTANCE_PX,
  THINKING_SWAP_GAP_MS,
  THINKING_SWAP_MS,
  initialThinkingSwapPhase,
  nextThinkingSwapPhase,
  readCssMs,
  thinkingLabelSizer,
  thinkingSwapEntering,
} from '../thinking-step-motion'

const root = join(import.meta.dir, '../../../../../..')
const motionCss = readFileSync(join(root, 'packages/ui/src/styles/thinking-step.css'), 'utf8')

describe('thinking step swap phase', () => {
  it('mounts a finished row settled so history and virtualization do not replay', () => {
    const phase = initialThinkingSwapPhase(false)
    expect(phase).toBe('settled')
    expect(nextThinkingSwapPhase(phase, false, false)).toBe('settled')
    expect(thinkingSwapEntering('settled', 'settled', false)).toBe(false)
  })

  it('holds the shimmer while the step is running', () => {
    let phase = initialThinkingSwapPhase(true)
    phase = nextThinkingSwapPhase(phase, true, false)
    expect(phase).toBe('streaming')
    expect(thinkingSwapEntering(phase, 'streaming', false)).toBe(false)
  })

  it('swaps only after this instance saw the step running', () => {
    const committed = initialThinkingSwapPhase(true)
    const shown = nextThinkingSwapPhase(committed, false, false)
    expect(shown).toBe('swapping')
    expect(thinkingSwapEntering(shown, committed, false)).toBe(true)
    expect(thinkingSwapEntering(shown, 'swapping', true)).toBe(true)
    expect(thinkingSwapEntering(shown, 'swapping', false)).toBe(false)
    expect(nextThinkingSwapPhase('swapping', false, false)).toBe('swapping')
    expect(nextThinkingSwapPhase('settled', false, false)).toBe('settled')
  })

  it('skips the swap when reduced motion is on', () => {
    const committed = initialThinkingSwapPhase(true)
    expect(nextThinkingSwapPhase(committed, false, true)).toBe('settled')
    expect(thinkingSwapEntering('settled', committed, false)).toBe(false)
  })

  it('returns to streaming if the same row starts again', () => {
    expect(nextThinkingSwapPhase('settled', true, false)).toBe('streaming')
    expect(nextThinkingSwapPhase('swapping', true, false)).toBe('streaming')
  })

  it('keeps the wider label only while the row is live', () => {
    expect(thinkingLabelSizer('Thinking deeply', 'Thought deeply', true)).toBe('Thinking deeply')
    expect(thinkingLabelSizer('深度思考中', '已深度思考', true)).toBe('深度思考中')
    expect(thinkingLabelSizer('Thinking deeply', 'Thought deeply', false)).toBe('Thought deeply')
  })

  it('falls back when the stylesheet is not applied', () => {
    expect(readCssMs('--think-swap', THINKING_SWAP_MS)).toBe(THINKING_SWAP_MS)
  })
})

describe('thinking step motion css', () => {
  it('matches the prototype shimmer and text-swap timing', () => {
    expect(motionCss).toContain(`--think-shimmer: ${THINKING_SHIMMER_MS}ms`)
    expect(motionCss).toContain(`--think-swap: ${THINKING_SWAP_MS}ms`)
    expect(motionCss).toContain(`--think-gap: ${THINKING_SWAP_GAP_MS}ms`)
    expect(motionCss).toContain(`--think-distance: ${THINKING_SWAP_DISTANCE_PX}px`)
    expect(motionCss).toContain(`--think-blur: ${THINKING_SWAP_BLUR_PX}px`)
    expect(motionCss).toContain('--think-ease: ease-in-out')
    expect(motionCss).toContain('--think-base: var(--muted-foreground)')
    expect(motionCss).toContain('--think-highlight: var(--foreground)')
    expect(motionCss).toContain('--think-band: 400%')
    expect(motionCss).toContain('content: attr(data-text)')
    expect(motionCss).toContain('background-clip: text')
    expect(motionCss).toContain('-webkit-background-clip: text')
    expect(motionCss).toContain('transparent 40%')
    expect(motionCss).toContain('var(--think-highlight) 50%')
    expect(motionCss).toContain('transparent 60%')
    expect(motionCss).toContain('animation: thinking-text-shimmer var(--think-shimmer) linear infinite')
    expect(motionCss).toContain('background-position: 100% 0')
    expect(motionCss).toContain('background-position: 0% 0')
    expect(motionCss).toContain('translateY(calc(var(--think-distance) * -1))')
    expect(motionCss).toContain('translateY(var(--think-distance))')
    expect(motionCss).toContain('filter: blur(var(--think-blur))')
    expect(motionCss).toContain('transition: none')
    expect(motionCss).not.toContain('#0d0d0d')
    expect(motionCss).not.toContain('#7c7c7c')
  })

  it('keeps reduced motion as static text', () => {
    const reduced = motionCss.slice(motionCss.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.thinking-text-shimmer::before')
    expect(reduced).toContain('content: none')
    expect(reduced).toContain('display: none')
    expect(reduced).toContain('animation: none')
    expect(reduced).toContain('transition: none !important')
    expect(reduced).toContain('transform: none !important')
    expect(reduced).toContain('filter: none !important')
    expect(reduced).toContain('opacity: 1 !important')
  })

  it('is loaded by the shared UI theme and the Electron renderer', () => {
    const ui = readFileSync(join(root, 'packages/ui/src/styles/index.css'), 'utf8')
    const electron = readFileSync(join(root, 'apps/electron/src/renderer/index.css'), 'utf8')
    expect(ui).toContain('./thinking-step.css')
    expect(electron).toContain('packages/ui/src/styles/thinking-step.css')
  })
})
