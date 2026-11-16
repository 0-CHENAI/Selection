import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  THINKING_SHIMMER_MS,
  THINKING_SWAP_BLUR_PX,
  THINKING_SWAP_DISTANCE_PX,
  THINKING_SWAP_GAP_MS,
  THINKING_SWAP_MS,
  WORK_CHROME_ENTER_BLUR_PX,
  WORK_CHROME_ENTER_DELAY_MS,
  WORK_CHROME_ENTER_DISTANCE_PX,
  WORK_CHROME_ENTER_MS,
  WORK_CHROME_ENTER_Y_MS,
  initialThinkingSwapPhase,
  initialWorkChromeEnterPose,
  nextThinkingSwapPhase,
  readCssMs,
  thinkingLabelSizer,
  thinkingSwapEntering,
  workChromeEnterClassName,
  workChromeEnterClips,
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

describe('work chrome header enter', () => {
  it('plays start only for a live first mount', () => {
    expect(initialWorkChromeEnterPose(true, false)).toBe('start')
    expect(initialWorkChromeEnterPose(false, false)).toBe('rest')
    expect(initialWorkChromeEnterPose(true, true)).toBe('rest')
    expect(initialWorkChromeEnterPose(false, true)).toBe('rest')
  })

  it('drops enter classes once the row is at rest so later preview swaps cannot replay', () => {
    expect(workChromeEnterClassName('start')).toBe('work-chrome-enter is-enter-start')
    expect(workChromeEnterClassName('run')).toBe('work-chrome-enter is-enter-run')
    expect(workChromeEnterClassName('parked')).toBe('work-chrome-enter is-enter-parked')
    expect(workChromeEnterClassName('rest')).toBeUndefined()
  })

  it('clips the reserved slot only while the inner layer is translating', () => {
    expect(workChromeEnterClips('start')).toBe(true)
    expect(workChromeEnterClips('run')).toBe(true)
    expect(workChromeEnterClips('parked')).toBe(false)
    expect(workChromeEnterClips('rest')).toBe(false)
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
    expect(motionCss).toContain(`--work-chrome-enter: ${WORK_CHROME_ENTER_MS}ms`)
    expect(motionCss).toContain(`--work-chrome-enter-y: ${WORK_CHROME_ENTER_Y_MS}ms`)
    expect(motionCss).toContain(`--work-chrome-enter-delay: ${WORK_CHROME_ENTER_DELAY_MS}ms`)
    expect(motionCss).toContain(`--work-chrome-enter-distance: ${WORK_CHROME_ENTER_DISTANCE_PX}px`)
    expect(motionCss).toContain(`--work-chrome-enter-blur: ${WORK_CHROME_ENTER_BLUR_PX}px`)
    expect(motionCss).toContain('--work-chrome-enter-ease: cubic-bezier(0.22, 1, 0.36, 1)')
    expect(motionCss).toContain('.work-chrome-enter')
    expect(motionCss).toContain('.work-chrome-enter-clip')
    expect(motionCss).toContain('contain: paint')
    expect(motionCss).toContain('translate3d(0, var(--work-chrome-enter-distance), 0)')
    expect(motionCss).toContain('translate3d(0, 0, 0)')
    expect(motionCss).toContain('.work-chrome-enter.is-enter-start')
    expect(motionCss).toContain('.work-chrome-enter.is-enter-run')
    expect(motionCss).toContain('.work-chrome-enter.is-enter-parked')
    expect(motionCss).not.toContain('translateY(var(--work-chrome-enter-distance))')
    expect(motionCss).not.toContain('height: 0')
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
    expect(reduced).toContain('.work-chrome-enter')
  })

  it('is loaded by the shared UI theme and the Electron renderer', () => {
    const ui = readFileSync(join(root, 'packages/ui/src/styles/index.css'), 'utf8')
    const electron = readFileSync(join(root, 'apps/electron/src/renderer/index.css'), 'utf8')
    expect(ui).toContain('./thinking-step.css')
    expect(electron).toContain('packages/ui/src/styles/thinking-step.css')
  })
})
