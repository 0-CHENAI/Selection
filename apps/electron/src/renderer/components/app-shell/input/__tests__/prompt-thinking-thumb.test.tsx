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

function createTestI18n() {
  const i18n = i18next.createInstance()
  void i18n.init({
    lng: 'zh-Hans',
    fallbackLng: 'en',
    initImmediate: false,
    resources: {
      'zh-Hans': { translation: LOCALE_REGISTRY['zh-Hans'].messages },
    },
  } as InitOptions)
  return i18n
}

function renderSettings(value: React.ComponentProps<typeof PromptThinkingSettings>['value'] = 'medium', overrides: Partial<React.ComponentProps<typeof PromptThinkingSettings>> = {}) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={createTestI18n()}>
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

  it('tracks dragging and maps both track ends to the correct effort levels', () => {
    const changes: ThinkingLevel[] = []
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<I18nextProvider i18n={createTestI18n()}><PromptThinkingSettings value="medium" levels={THINKING_LEVELS} inMenu={false} onChange={level => changes.push(level)} /></I18nextProvider>)
    })
    const slider = () => renderer.root.findByProps({ role: 'slider' })
    const target = { setPointerCapture: () => {}, focus: () => {}, getBoundingClientRect: () => ({ left: 0, width: 200 }) }
    act(() => slider().props.onPointerDown({ button: 0, pointerId: 1, clientX: 13, currentTarget: target }))
    expect(slider().props['data-dragging']).toBe(true)
    act(() => slider().props.onPointerMove({ buttons: 1, clientX: 187, currentTarget: target }))
    expect(changes).toEqual([THINKING_LEVELS[0]!.id, THINKING_LEVELS.at(-1)!.id])
    act(() => slider().props.onPointerUp())
    expect(slider().props['data-dragging']).toBeUndefined()
    act(() => renderer.unmount())
  })

  it('places the supplied action in the heading instead of the help button', () => {
    const html = renderSettings('medium', { headingAction: <button type="button">Fast</button> })
    const heading = html.slice(html.indexOf('prompt-effort-heading'), html.indexOf('prompt-effort-track'))
    expect(heading).toContain('>Fast</button>')
    expect(heading).not.toContain('prompt-effort-help')
    expect(renderSettings('medium')).toContain('prompt-effort-help')

    const alwaysOn = renderSettings('medium', { unavailable: 'always-on', headingAction: <button type="button">Fast</button> })
    expect(alwaysOn).toContain('>Fast</button>')
  })

  it('keeps endpoint labels only when the slider represents an on/off choice', () => {
    expect(renderSettings('medium')).not.toContain('prompt-effort-endpoints')
    const binary = renderSettings('off', { binary: true, levels: THINKING_LEVELS.filter(level => ['off', 'high'].includes(level.id)) })
    expect(binary).toContain('prompt-effort-endpoints')
    expect(binary).toContain('>无思考</span>')
    expect(binary).toContain('>开启</span>')
  })

  it('keeps Fast in the effort heading rather than a model-browse overview', () => {
    const html = renderSettings('high', {
      headingAction: <button type="button" aria-label="Fast">⚡</button>,
    })
    expect(html).toContain('prompt-effort-heading')
    expect(html).toContain('aria-label="Fast"')
    expect(html).toContain('role="slider"')
    expect(html).not.toContain('data-overview')
    expect(html).not.toContain('prompt-effort-overview')
    expect(html).not.toContain('prompt-effort-endpoints')
  })

  it('shows the field at the highest available stop for each model', () => {
    expect(renderSettings('max')).toContain('<canvas')
    for (const value of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const) {
      expect(renderSettings(value)).not.toContain('<canvas')
    }
    const moLevels = THINKING_LEVELS.filter(level => ['low', 'medium', 'xhigh'].includes(level.id))
    expect(renderSettings('xhigh', { levels: moLevels })).toContain('<canvas')
    expect(renderSettings('medium', { levels: moLevels })).not.toContain('<canvas')
    expect(renderSettings('high', { levels: THINKING_LEVELS.filter(level => ['low', 'medium', 'high'].includes(level.id)) })).toContain('<canvas')
    expect(renderSettings('high', { binary: true, levels: THINKING_LEVELS.filter(level => ['off', 'high'].includes(level.id)) })).toContain('<canvas')
  })

  it('does not ignite unavailable, disabled, single-stop, or stale selections', () => {
    for (const overrides of [
      { disabled: true },
      { levels: THINKING_LEVELS.filter(level => level.id === 'max') },
      { unavailable: 'always-on' as const },
      { levels: THINKING_LEVELS.filter(level => level.id !== 'max') },
    ]) {
      expect(renderSettings('max', overrides)).not.toContain('<canvas')
    }
    const disabled = renderSettings('medium', { disabled: true, inMenu: false })
    expect(disabled).toContain('aria-disabled="true"')
    expect(disabled).toContain('tabindex="-1"')
  })

  it('shows the selected label without a slider for a single available stop', () => {
    const html = renderSettings('xhigh', { levels: THINKING_LEVELS.filter(level => level.id === 'xhigh') })
    expect(html).toContain('超高')
    expect(html).not.toContain('role="slider"')
    expect(html).not.toContain('<canvas')
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
