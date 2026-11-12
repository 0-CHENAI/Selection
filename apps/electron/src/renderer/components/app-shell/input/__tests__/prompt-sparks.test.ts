import { afterEach, describe, expect, it } from 'bun:test'
import { mountPromptSparks } from '../prompt-sparks'
import { PROMPT_FX_DPR_CAP } from '../prompt-fx-runtime'

const hostKeys = ['window', 'document', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'MutationObserver'] as const

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
    let colorReads = 0
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
      MutationObserver: class { observe() {} disconnect() {} },
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
        documentElement: { classList: { contains: () => false } },
        addEventListener() {},
        removeEventListener() {},
      },
    })
    Object.defineProperty(globalThis, 'getComputedStyle', {
      configurable: true,
      value: () => {
        colorReads += 1
        return { color: 'rgb(120, 80, 200)', display: 'block', visibility: 'visible' }
      },
    })
    const canvas = {
      width: 0,
      height: 0,
      style: {},
      className: 'prompt-sparks',
      clientWidth: 1605,
      clientHeight: 203,
      getContext: () => ctx,
      getBoundingClientRect: () => {
        calls.push('getBoundingClientRect')
        return { width: 1605, height: 203 }
      },
      closest: () => null,
      parentElement: null,
      isConnected: true,
    }
    return { queue, ctx, canvas, calls, colorReads: () => colorReads, ioCallback: () => ioCallback }
  }

  function pump(queue: Map<number, FrameRequestCallback>, now: number) {
    const pending = queue.entries().next().value as [number, FrameRequestCallback] | undefined
    expect(pending).toBeTruthy()
    queue.delete(pending![0])
    pending![1](now)
  }

  it('uses full DPR 2, keeps a resting bitmap, and stops rAF only when hidden or offscreen', () => {
    const { queue, canvas, calls, ioCallback } = install({ ratio: 2 })
    const energy = { current: 0 }
    const stop = mountPromptSparks(canvas as unknown as HTMLCanvasElement, { energy })
    expect(canvas.width).toBe(Math.round(1605 * PROMPT_FX_DPR_CAP))
    expect(canvas.height).toBe(Math.round(203 * PROMPT_FX_DPR_CAP))
    expect(calls.includes('getBoundingClientRect')).toBe(false)
    expect(queue.size).toBe(1)
    const started = performance.now()
    pump(queue, started + 16)
    expect(queue.size).toBe(1)

    ioCallback()?.([{ isIntersecting: false, intersectionRatio: 0, target: canvas } as unknown as IntersectionObserverEntry], {} as IntersectionObserver)
    pump(queue, started + 32)
    expect(queue.size).toBe(0)

    ioCallback()?.([{ isIntersecting: true, intersectionRatio: 1, target: canvas } as unknown as IntersectionObserverEntry], {} as IntersectionObserver)
    expect(queue.size).toBe(1)
    stop()
    expect(queue.size).toBe(0)
  })

  it('keeps idle sparks looping without composer hover or focus', () => {
    const { queue, canvas } = install()
    const energy = { current: 0 }
    const stop = mountPromptSparks(canvas as unknown as HTMLCanvasElement, { energy })
    const started = performance.now()
    pump(queue, started + 16)
    pump(queue, started + 32)
    expect(queue.size).toBe(1)
    stop()
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
    expect(queue.size).toBe(0)
    stop()
  })

  it('does not re-read computed color on every frame', () => {
    const { queue, canvas, colorReads } = install()
    const energy = { current: 0.2 }
    const stop = mountPromptSparks(canvas as unknown as HTMLCanvasElement, { energy })
    const before = colorReads()
    const started = performance.now()
    pump(queue, started + 16)
    pump(queue, started + 32)
    pump(queue, started + 48)
    expect(colorReads()).toBe(before)
    stop()
  })
})
