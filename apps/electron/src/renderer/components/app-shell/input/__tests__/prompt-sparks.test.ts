import { afterEach, describe, expect, it } from 'bun:test'
import { mountPromptSparks } from '../prompt-sparks'
import { PROMPT_FX_DPR_CAP } from '../prompt-fx-runtime'

const hostKeys = ['window', 'document', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver'] as const

describe('prompt sparks loop', () => {
  const previous = hostKeys.map(key => Object.getOwnPropertyDescriptor(globalThis, key))
  afterEach(() => {
    hostKeys.forEach((key, index) => {
      const descriptor = previous[index]
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    })
  })

  function install(options?: { hidden?: boolean; ratio?: number }) {
    const queue = new Map<number, FrameRequestCallback>()
    let frameId = 0
    let ioCallback: IntersectionObserverCallback | undefined
    const calls: string[] = []
    const ctx = {
      setTransform: () => { calls.push('setTransform') },
      clearRect: () => { calls.push('clearRect') },
      beginPath: () => {},
      arc: () => {},
      fill: () => { calls.push('fill') },
      globalAlpha: 1,
      fillStyle: '',
    }
    Object.assign(globalThis, {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        const id = ++frameId
        queue.set(id, callback)
        return id
      },
      cancelAnimationFrame: (id: number) => { queue.delete(id) },
      ResizeObserver: class { observe() {} disconnect() {} },
      IntersectionObserver: class {
        constructor(callback: IntersectionObserverCallback) { ioCallback = callback }
        observe() {}
        disconnect() {}
      },
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        devicePixelRatio: options?.ratio ?? 2,
        addEventListener() {},
        removeEventListener() {},
      },
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        hidden: options?.hidden ?? false,
        visibilityState: options?.hidden ? 'hidden' : 'visible',
        activeElement: null,
        addEventListener() {},
        removeEventListener() {},
        hasFocus: () => !options?.hidden,
      },
    })
    Object.defineProperty(globalThis, 'getComputedStyle', {
      configurable: true,
      value: () => ({ color: 'rgb(120, 80, 200)', display: 'block', visibility: 'visible' }),
    })
    const canvas = {
      width: 0,
      height: 0,
      style: {},
      className: 'prompt-sparks',
      getContext: () => ctx,
      getBoundingClientRect: () => ({ width: 1605, height: 203 }),
      closest: (() => null) as () => { matches: (selector: string) => boolean; contains: () => boolean; addEventListener(type: string, listener: EventListener): void; removeEventListener(type: string, listener: EventListener): void; dispatch(type: string): void } | null,
      parentElement: null,
      isConnected: true,
    }
    return { queue, ctx, canvas, calls, ioCallback: () => ioCallback }
  }

  function pump(queue: Map<number, FrameRequestCallback>, now: number) {
    const pending = queue.entries().next().value as [number, FrameRequestCallback] | undefined
    expect(pending).toBeTruthy()
    queue.delete(pending![0])
    pending![1](now)
  }

  it('caps DPR, keeps a resting bitmap, and stops rAF when hidden or offscreen', () => {
    const { queue, canvas, ioCallback } = install({ ratio: 2 })
    const energy = { current: 0 }
    const stop = mountPromptSparks(canvas as unknown as HTMLCanvasElement, { energy })
    expect(canvas.width).toBe(Math.round(1605 * PROMPT_FX_DPR_CAP))
    expect(canvas.height).toBe(Math.round(203 * PROMPT_FX_DPR_CAP))
    expect(queue.size).toBe(1)
    const started = performance.now()
    pump(queue, started + 40)
    expect(queue.size).toBe(1)

    ioCallback()?.([{ isIntersecting: false, intersectionRatio: 0, target: canvas } as unknown as IntersectionObserverEntry], {} as IntersectionObserver)
    pump(queue, started + 80)
    expect(queue.size).toBe(0)

    ioCallback()?.([{ isIntersecting: true, intersectionRatio: 1, target: canvas } as unknown as IntersectionObserverEntry], {} as IntersectionObserver)
    expect(queue.size).toBe(1)
    stop()
    expect(queue.size).toBe(0)
  })

  it('does not keep a rAF chain after unmount', () => {
    const { queue, canvas } = install()
    const energy = { current: 0.4 }
    const stop = mountPromptSparks(canvas as unknown as HTMLCanvasElement, { energy })
    expect(queue.size).toBe(1)
    const pending = [...queue.values()][0]!
    stop()
    expect(queue.size).toBe(0)
    pending(performance.now() + 40)
    expect(queue.size).toBe(0)
  })

  it('skips the loop when prefers-reduced-motion is set on the host', () => {
    const { queue, canvas } = install()
    const energy = { current: 1 }
    const stop = mountPromptSparks(canvas as unknown as HTMLCanvasElement, { energy, reducedMotion: true })
    pump(queue, performance.now() + 40)
    expect(queue.size).toBe(0)
    stop()
  })

  it('pauses ambient sparks until the composer is hovered or focused', () => {
    const { queue, canvas } = install()
    let hovered = false
    const listeners = new Map<string, Set<EventListener>>()
    const field = {
      matches: (selector: string) => hovered && selector.includes(':hover'),
      contains: () => false,
      addEventListener(type: string, listener: EventListener) {
        const set = listeners.get(type) ?? new Set()
        set.add(listener)
        listeners.set(type, set)
      },
      removeEventListener(type: string, listener: EventListener) {
        listeners.get(type)?.delete(listener)
      },
      dispatch(type: string) {
        hovered = type === 'pointerenter'
        for (const listener of listeners.get(type) ?? []) listener(new Event(type))
      },
    }
    canvas.closest = () => field
    const energy = { current: 0 }
    const stop = mountPromptSparks(canvas as unknown as HTMLCanvasElement, { energy })
    pump(queue, performance.now() + 40)
    expect(queue.size).toBe(0)
    field.dispatch('pointerenter')
    expect(queue.size).toBe(1)
    stop()
  })
})
