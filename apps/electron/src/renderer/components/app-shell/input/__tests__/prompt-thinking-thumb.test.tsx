import { createElement, Fragment, type ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next, { type InitOptions } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { THINKING_LEVELS, type ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import { EFFORT_FIELD_FADE_MS } from '../effort-theme'

const passthrough = ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children)
mock.module('@craft-agent/ui', () => ({
  Tooltip: passthrough,
  TooltipTrigger: passthrough,
  TooltipContent: () => null,
}))
mock.module('@radix-ui/react-dropdown-menu', () => ({ Item: passthrough }))

let PromptThinkingSettings: typeof import('../PromptBarEffects').PromptThinkingSettings

beforeAll(async () => {
  ;({ PromptThinkingSettings } = await import('../PromptBarEffects'))
})

function renderSettings(value: React.ComponentProps<typeof PromptThinkingSettings>['value'] = 'medium', overrides: Partial<React.ComponentProps<typeof PromptThinkingSettings>> = {}) {
  const i18n = i18next.createInstance()
  void i18n.init({
    lng: 'zh-Hans',
    fallbackLng: 'en',
    initImmediate: false,
    resources: {
      'zh-Hans': { translation: LOCALE_REGISTRY['zh-Hans'].messages },
    },
  } as InitOptions)
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <PromptThinkingSettings
        value={value}
        levels={THINKING_LEVELS}
        workMode="NORM"
        {...overrides}
        onChange={() => {}}
      />
    </I18nextProvider>,
  )
}

describe('thinking effort', () => {
  it('exposes the selected stop and keyboard bounds', () => {
    const html = renderSettings('medium')
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-valuemin="0"')
    expect(html).toContain('aria-valuemax="6"')
    expect(html).toContain('aria-valuenow="3"')
    expect(html).toContain('aria-disabled="false"')
  })

  it('shows the field only at Max, not at other models’ highest stops', () => {
    expect(renderSettings('max')).toContain('<canvas')
    for (const value of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const) {
      expect(renderSettings(value)).not.toContain('<canvas')
    }
    expect(renderSettings('high', { levels: THINKING_LEVELS.filter(level => ['low', 'medium', 'high'].includes(level.id)) })).not.toContain('<canvas')
  })

  it('does not ignite unavailable, disabled, binary, or stale Max selections', () => {
    for (const overrides of [
      { disabled: true },
      { binary: true },
      { unavailable: 'always-on' as const },
      { levels: THINKING_LEVELS.filter(level => level.id !== 'max') },
    ]) {
      expect(renderSettings('max', overrides)).not.toContain('<canvas')
    }
    const disabled = renderSettings('medium', { disabled: true, inMenu: false })
    expect(disabled).toContain('aria-disabled="true"')
    expect(disabled).toContain('tabindex="-1"')
  })

  it('marks PRO so the Max field can follow the gold accent', () => {
    expect(renderSettings('max', { workMode: 'PRO' })).toContain('data-work-mode="PRO"')
    expect(renderSettings('max', { workMode: 'PRO' })).toContain('<canvas')
    expect(renderSettings('max', { workMode: 'NORM' })).toContain('data-work-mode="NORM"')
  })
})

const hostKeys = ['window', 'requestAnimationFrame', 'cancelAnimationFrame'] as const

function restoreHost(previous: Array<PropertyDescriptor | undefined>) {
  hostKeys.forEach((key, index) => {
    const descriptor = previous[index]
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  })
}

describe('max effort field fade', () => {
  const previous = hostKeys.map(key => Object.getOwnPropertyDescriptor(globalThis, key))
  afterEach(() => restoreHost(previous))

  function host(reduced: boolean) {
    const frames: FrameRequestCallback[] = []
    const timers: Array<{ fn: () => void; ms: number }> = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        matchMedia: (query: string) => ({
          matches: reduced && query.includes('reduce'),
          addEventListener() {},
          removeEventListener() {},
        }),
        setTimeout(fn: () => void, ms?: number) {
          timers.push({ fn, ms: ms ?? 0 })
          return timers.length
        },
        clearTimeout() {},
      },
    })
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      },
    })
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => {} })
    return { frames, timers }
  }

  function flush(frames: FrameRequestCallback[]) {
    const pending = frames.splice(0)
    for (const frame of pending) frame(0)
  }

  function mount(value: ThinkingLevel) {
    let renderer: ReactTestRenderer
    const i18n = i18next.createInstance()
    void i18n.init({
      lng: 'zh-Hans',
      fallbackLng: 'en',
      initImmediate: false,
      resources: { 'zh-Hans': { translation: LOCALE_REGISTRY['zh-Hans'].messages } },
    } as InitOptions)
    act(() => {
      renderer = create(
        <I18nextProvider i18n={i18n}>
          <PromptThinkingSettings value={value} levels={THINKING_LEVELS} workMode="NORM" onChange={() => {}} />
        </I18nextProvider>,
      )
    })
    return {
      canvas: () => renderer.root.findAllByType('canvas'),
      update: (next: ThinkingLevel) => act(() => {
        renderer.update(
          <I18nextProvider i18n={i18n}>
            <PromptThinkingSettings value={next} levels={THINKING_LEVELS} workMode="NORM" onChange={() => {}} />
          </I18nextProvider>,
        )
      }),
      unmount: () => act(() => renderer.unmount()),
    }
  }

  it('fades out of Max before the canvas unmounts', () => {
    const { frames, timers } = host(false)
    const view = mount('max')
    expect(view.canvas()).toHaveLength(1)
    expect(view.canvas()[0]?.props['data-visible']).toBeUndefined()
    act(() => flush(frames))
    act(() => flush(frames))
    expect(view.canvas()[0]?.props['data-visible']).toBe(true)
    view.update('medium')
    expect(view.canvas()).toHaveLength(1)
    expect(view.canvas()[0]?.props['data-visible']).toBeUndefined()
    expect(timers.map(timer => timer.ms)).toEqual([EFFORT_FIELD_FADE_MS])
    act(() => { timers[0]?.fn() })
    expect(view.canvas()).toHaveLength(0)
    view.unmount()
  })

  it('settles immediately when reduced motion is requested', () => {
    const { frames, timers } = host(true)
    const view = mount('max')
    expect(view.canvas()).toHaveLength(1)
    expect(view.canvas()[0]?.props['data-visible']).toBe(true)
    expect(frames).toHaveLength(0)
    expect(timers).toHaveLength(0)
    view.update('low')
    expect(view.canvas()).toHaveLength(0)
    expect(timers).toHaveLength(0)
    expect(frames).toHaveLength(0)
    view.unmount()
  })
})
