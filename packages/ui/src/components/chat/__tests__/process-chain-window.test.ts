import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PROCESS_CHAIN_OVERSCAN,
  PROCESS_CHAIN_ROW_PX,
  PROCESS_CHAIN_WINDOW_THRESHOLD,
  initialProcessChainWindow,
  processChainWindow,
  processChainWindowFromRange,
  reconcileProcessChainWindow,
  sameProcessChainWindow,
  shouldWindowProcessChain,
} from '../process-chain-window'

const src = readFileSync(join(import.meta.dir, '../TurnCard.tsx'), 'utf8')
const css = readFileSync(join(import.meta.dir, '../../../styles/thinking-step.css'), 'utf8')

describe('process chain window math', () => {
  it('does not window short chains', () => {
    expect(shouldWindowProcessChain(PROCESS_CHAIN_WINDOW_THRESHOLD, true)).toBe(false)
    expect(shouldWindowProcessChain(PROCESS_CHAIN_WINDOW_THRESHOLD + 1, true)).toBe(true)
    expect(shouldWindowProcessChain(80, false)).toBe(false)
    expect(initialProcessChainWindow(8)).toBeNull()
  })

  it('keeps a bounded first-paint slice so history does not mount every row', () => {
    const window = initialProcessChainWindow(80)
    expect(window).not.toBeNull()
    expect(window!.start).toBe(0)
    expect(window!.end).toBe(PROCESS_CHAIN_WINDOW_THRESHOLD + PROCESS_CHAIN_OVERSCAN)
    expect(window!.end).toBeLessThan(80)
    expect(window!.padTop).toBe(0)
    expect(window!.padBottom).toBe((80 - window!.end) * PROCESS_CHAIN_ROW_PX)
    expect(window!.count).toBe(80)
  })

  it('covers the viewport plus overscan and preserves total height with spacers', () => {
    const window = processChainWindow({
      containerTop: -400,
      viewportHeight: 200,
      count: 80,
    })
    expect(window.start).toBeGreaterThan(0)
    expect(window.end).toBeLessThan(80)
    expect(window.end - window.start).toBeLessThanOrEqual(
      Math.ceil(200 / PROCESS_CHAIN_ROW_PX) + PROCESS_CHAIN_OVERSCAN * 2 + 1,
    )
    expect(window.padTop + window.padBottom + (window.end - window.start) * PROCESS_CHAIN_ROW_PX)
      .toBe(80 * PROCESS_CHAIN_ROW_PX)
  })

  it('stays pinned to the tail when a live chain grows', () => {
    const previous = processChainWindowFromRange(60, 80, 80)
    const next = reconcileProcessChainWindow(previous, 84)
    expect(next).toMatchObject({ start: 64, end: 84, padBottom: 0, count: 84 })
  })

  it('keeps a mid-list window in place when later rows arrive', () => {
    const previous = processChainWindowFromRange(10, 40, 80)
    const next = reconcileProcessChainWindow(previous, 90)
    expect(next).toMatchObject({ start: 10, end: 40, count: 90 })
    expect(next!.padBottom).toBe((90 - 40) * PROCESS_CHAIN_ROW_PX)
  })

  it('treats identical windows as unchanged so scroll does not setState', () => {
    const window = processChainWindowFromRange(4, 30, 80)
    expect(sameProcessChainWindow(window, { ...window })).toBe(true)
    expect(sameProcessChainWindow(window, { ...window, start: 5 })).toBe(false)
  })
})

describe('process chain mounts less work offscreen', () => {
  it('unmounts collapsed panel children after the height tween', () => {
    const panel = src.slice(src.indexOf('function ExpandableHeightPanel'), src.indexOf('const WORK_CHAIN_EASE'))
    expect(panel).toContain('renderChildren')
    expect(panel).toContain('setTimeout')
    expect(panel).toContain('PROCESS_CHAIN_EXPAND_MS')
    expect(panel).toContain('open || renderChildren')
  })

  it('windows a long expanded chain and skips motion on settled rows', () => {
    expect(src).toContain('useProcessChainWindow')
    expect(src).toContain('data-process-chain-window')
    expect(src).toContain('data-process-chain-spacer')
    const row = src.slice(src.indexOf('function WorkChainRow'), src.indexOf('function ActivityErrorBadge'))
    expect(row).toContain('useMotion')
    expect(row).toContain('data-process-chain-row')
    expect(row).toContain("contentVisibility: 'auto'")
    expect(row).toContain('containIntrinsicSize')
  })

  it('does not wrap every completed status icon in AnimatePresence', () => {
    const icon = src.slice(src.indexOf('export function ActivityStatusIcon'), src.indexOf('interface ActivityRowProps'))
    expect(icon).not.toContain('<AnimatePresence')
    expect(icon).not.toContain('<motion.div')
    expect(icon).toContain('Spinner')
    expect(icon).toContain('CheckCircle2')
  })

  it('keeps shimmer compositing off settled thinking labels', () => {
    const defaults = css.slice(0, css.indexOf('.thinking-text-shimmer::before'))
    expect(defaults).not.toContain('will-change:')
    expect(css).toContain('.thinking-swap-text.thinking-text-shimmer')
    expect(css).toContain('will-change: transform, filter, opacity')
  })
})
