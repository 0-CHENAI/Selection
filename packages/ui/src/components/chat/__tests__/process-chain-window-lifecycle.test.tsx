import * as React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { useProcessChainWindow, type ProcessChainWindow } from '../process-chain-window'

const globals = ['window', 'document', 'getComputedStyle', 'ResizeObserver'] as const
let saved: (PropertyDescriptor | undefined)[]
let renderer: ReactTestRenderer | undefined
let result: ProcessChainWindow | null
let top = 0
let height = 300
let frame = 0
const frames = new Map<number, FrameRequestCallback>()
const observers = new Set<() => void>()
let viewport: EventTarget & { parentElement: null; getBoundingClientRect: () => { top: number; height: number } }
let container: { parentElement: typeof viewport; getBoundingClientRect: () => { top: number; height: number } }
function Harness({ open, count = 80 }: { open: boolean; count?: number }) {
  const ref = React.useRef<HTMLDivElement>(null)
  result = useProcessChainWindow(ref, count, open)
  return open ? <div ref={ref} /> : null
}
function render(open: boolean, count = 80) {
  act(() => {
    if (renderer) renderer.update(<Harness open={open} count={count} />)
    else renderer = create(<Harness open={open} count={count} />, { createNodeMock: () => container })
  })
}
function flush() {
  act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)) })
}
beforeEach(() => {
  saved = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key))
  top = 0; height = 300; frame = 0; frames.clear(); observers.clear()
  viewport = Object.assign(new EventTarget(), { parentElement: null, getBoundingClientRect: () => ({ top: 0, height }) })
  container = { parentElement: viewport, getBoundingClientRect: () => ({ top, height: 2080 }) }
  const values = {
    window: Object.assign(new EventTarget(), { requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frame, callback); return frame }, cancelAnimationFrame: (id: number) => frames.delete(id) }),
    document: { documentElement: {}, body: {} },
    getComputedStyle: () => ({ overflowY: 'auto' }),
    ResizeObserver: class { constructor(private callback: () => void) { observers.add(callback) } observe() {} disconnect() { observers.delete(this.callback) } },
  }
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: values[key] })
})
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined
  globals.forEach((key, index) => saved[index] ? Object.defineProperty(globalThis, key, saved[index]!) : Reflect.deleteProperty(globalThis, key))
})
test('opening and reopening attaches measurement to the mounted list, never reuses a tail spacer', () => {
  const source = readFileSync(new URL('../TurnCard.tsx', import.meta.url), 'utf8')
  expect(source).toContain('windowProcessChain && isExpanded')
  render(false)
  expect(result!).toBeNull()
  top = -1600
  render(true)
  expect(result!.start).toBeGreaterThan(0)
  render(false)
  expect(observers.size).toBe(0)
  top = 100
  render(true)
  expect(result!.start).toBe(0)
  expect(result!.padTop).toBe(0)
  top = -1000
  viewport.dispatchEvent(new Event('scroll')); flush()
  expect(result!.start).toBeGreaterThan(0)
})
test('viewport resizing and live appends refresh the window without requiring a scroll event', () => {
  render(true)
  const before = result!.end
  height = 900
  observers.forEach(callback => callback()); flush()
  expect(result!.end).toBeGreaterThan(before)
  top = -1200
  viewport.dispatchEvent(new Event('scroll')); flush()
  render(true, 90)
  expect(result!.count).toBe(90)
  expect(result!.start).toBeGreaterThan(0)
  expect(frames.size).toBe(0)
})
