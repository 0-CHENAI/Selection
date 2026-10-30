import { createElement, Fragment, type ReactNode } from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next, { type InitOptions } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { THINKING_LEVELS } from '@craft-agent/shared/agent/thinking-levels'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'

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
})
