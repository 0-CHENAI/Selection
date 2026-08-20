import { describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { Worker } from 'node:worker_threads'
import { runImageOptimizer } from './image-resize-runner.ts'
import type { ImageOptimizationResult, ImageResizeLimits } from './image-resize-types.ts'

const limits: ImageResizeLimits = {
  maxWidth: 2560,
  maxHeight: 2560,
  maxEncodedBytes: 4.5 * 1024 * 1024,
  jpegQuality: 85,
}

describe('Pi read image optimizer runner', () => {
  it('falls back in-process when the Worker cannot start', async () => {
    let fallbackCalls = 0
    const expected: ImageOptimizationResult = {
      ok: false,
      code: 'image_runtime_unavailable',
      detail: 'fallback result',
    }

    const result = await runImageOptimizer(new Uint8Array([1]), 'image/png', limits, undefined, {
      createWorker: () => { throw new Error('worker missing') },
      optimizeInProcess: async () => {
        fallbackCalls += 1
        return expected
      },
    })

    expect(result).toEqual(expected)
    expect(fallbackCalls).toBe(1)
  })

  it('maps an unexpected in-process fallback exception to the existing error contract', async () => {
    const result = await runImageOptimizer(new Uint8Array([1]), 'image/png', limits, undefined, {
      createWorker: () => { throw new Error('worker missing') },
      optimizeInProcess: async () => { throw new Error('fallback crashed') },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('image_resize_failed')
      expect(result.detail).toContain('fallback crashed')
    }
  })

  it('falls back when the Worker fails before processing starts', async () => {
    let fallbackCalls = 0
    class StartupFailureWorker extends EventEmitter {
      postMessage(): void {
        queueMicrotask(() => this.emit('error', new Error('worker startup failed')))
      }
      async terminate(): Promise<number> { return 0 }
    }

    const result = await runImageOptimizer(new Uint8Array([1]), 'image/png', limits, undefined, {
      createWorker: () => new StartupFailureWorker() as unknown as Worker,
      optimizeInProcess: async () => {
        fallbackCalls += 1
        return { ok: false, code: 'image_runtime_unavailable', detail: 'fallback result' }
      },
    })

    expect(result).toEqual({
      ok: false,
      code: 'image_runtime_unavailable',
      detail: 'fallback result',
    })
    expect(fallbackCalls).toBe(1)
  })

  it('does not repeat processing in-process when the Worker crashes after starting', async () => {
    let fallbackCalls = 0
    class ProcessingCrashWorker extends EventEmitter {
      postMessage(): void {
        queueMicrotask(() => {
          this.emit('message', { type: 'started' })
          this.emit('error', new Error('decoder crashed'))
        })
      }
      async terminate(): Promise<number> { return 0 }
    }

    const result = await runImageOptimizer(new Uint8Array([1]), 'image/png', limits, undefined, {
      createWorker: () => new ProcessingCrashWorker() as unknown as Worker,
      optimizeInProcess: async () => {
        fallbackCalls += 1
        return { ok: false, code: 'image_resize_failed', detail: 'must not run' }
      },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('image_resize_failed')
      expect(result.detail).toContain('decoder crashed')
    }
    expect(fallbackCalls).toBe(0)
  })

  it('falls back when a stale Worker returns an incomplete success payload', async () => {
    let fallbackCalls = 0
    class StaleWorker extends EventEmitter {
      postMessage(): void {
        queueMicrotask(() => this.emit('message', {
          ok: true,
          bytes: new Uint8Array([1]),
          mimeType: 'image/png',
          width: 1,
          height: 1,
        }))
      }
      async terminate(): Promise<number> { return 0 }
    }

    const expected: ImageOptimizationResult = {
      ok: false,
      code: 'image_runtime_unavailable',
      detail: 'fallback after invalid response',
    }
    const result = await runImageOptimizer(new Uint8Array([1]), 'image/png', limits, undefined, {
      createWorker: () => new StaleWorker() as unknown as Worker,
      optimizeInProcess: async () => {
        fallbackCalls += 1
        return expected
      },
    })

    expect(result).toEqual(expected)
    expect(fallbackCalls).toBe(1)
  })

  it('does not retry a valid processing failure returned by the Worker', async () => {
    let fallbackCalls = 0
    class FailedWorker extends EventEmitter {
      postMessage(): void {
        queueMicrotask(() => this.emit('message', {
          ok: false,
          code: 'image_decode_failed',
          detail: 'invalid image',
        }))
      }
      async terminate(): Promise<number> { return 0 }
    }

    const result = await runImageOptimizer(new Uint8Array([1]), 'image/png', limits, undefined, {
      createWorker: () => new FailedWorker() as unknown as Worker,
      optimizeInProcess: async () => {
        fallbackCalls += 1
        return { ok: false, code: 'image_resize_failed', detail: 'must not run' }
      },
    })

    expect(result).toEqual({
      ok: false,
      code: 'image_decode_failed',
      detail: 'invalid image',
    })
    expect(fallbackCalls).toBe(0)
  })

  it('does not fall back when processing is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let fallbackCalls = 0

    await expect(runImageOptimizer(new Uint8Array([1]), 'image/png', limits, controller.signal, {
      optimizeInProcess: async () => {
        fallbackCalls += 1
        return { ok: false, code: 'image_resize_failed', detail: 'must not run' }
      },
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(fallbackCalls).toBe(0)
  })

  it('reports AbortError if cancellation wins a Worker startup race', async () => {
    const controller = new AbortController()
    let fallbackCalls = 0

    await expect(runImageOptimizer(new Uint8Array([1]), 'image/png', limits, controller.signal, {
      createWorker: () => {
        controller.abort()
        throw new Error('worker startup failed')
      },
      optimizeInProcess: async () => {
        fallbackCalls += 1
        return { ok: false, code: 'image_resize_failed', detail: 'must not run' }
      },
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(fallbackCalls).toBe(0)
  })

  it('terminates an active Worker without falling back when aborted', async () => {
    const controller = new AbortController()
    let fallbackCalls = 0
    let terminateCalls = 0
    class HangingWorker extends EventEmitter {
      postMessage(): void {}
      async terminate(): Promise<number> {
        terminateCalls += 1
        return 0
      }
    }

    const processing = runImageOptimizer(new Uint8Array([1]), 'image/png', limits, controller.signal, {
      createWorker: () => new HangingWorker() as unknown as Worker,
      optimizeInProcess: async () => {
        fallbackCalls += 1
        return { ok: false, code: 'image_resize_failed', detail: 'must not run' }
      },
    })
    controller.abort()

    await expect(processing).rejects.toMatchObject({ name: 'AbortError' })
    expect(terminateCalls).toBe(1)
    expect(fallbackCalls).toBe(0)
  })
})
