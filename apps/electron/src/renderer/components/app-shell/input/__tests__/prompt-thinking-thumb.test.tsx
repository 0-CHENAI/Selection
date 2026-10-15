import { createElement, Fragment, type ReactNode } from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

const css = readFileSync(join(import.meta.dir, '../PromptBarEffects.css'), 'utf8')

function thumbRule(): string {
  const start = css.indexOf('left: var(--prompt-effort-x);')
  const blockStart = css.lastIndexOf('.prompt-effort-thumb {', start)
  const end = css.indexOf('}', start)
  return css.slice(blockStart, end)
}

function renderSettings(value: 'medium' | 'max' = 'medium', disabled = false) {
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
        disabled={disabled}
        onChange={() => {}}
      />
    </I18nextProvider>,
  )
}

describe('thinking effort thumb', () => {
  it('uses a circle the same size as the track, centered on the stop', () => {
    expect(css).toContain('.prompt-effort-track {\n  position: relative;\n  height: 22px;')
    const rule = thumbRule()
    expect(rule).toContain('top: 50%;')
    expect(rule).toContain('width: var(--prompt-effort-thumb);')
    expect(rule).toContain('height: var(--prompt-effort-thumb);')
    expect(rule).toContain('margin-top: calc(var(--prompt-effort-thumb) / -2);')
    expect(rule).toContain('margin-left: calc(var(--prompt-effort-thumb) / -2);')
    expect(rule).toContain('border-radius: 50%;')
    expect(rule).not.toContain('height: 28px')
    expect(rule).not.toContain('border-radius: 7px')
  })

  it('keeps hover, focus, disabled, and max-effort treatments', () => {
    expect(css).toContain('.prompt-effort-track:focus-visible:not(:hover) .prompt-effort-thumb')
    expect(css).toContain(".prompt-effort-track[aria-disabled='true'] { cursor: default; }")
    expect(css).toContain('.prompt-effort-settings[data-max] .prompt-effort-thumb { background: var(--prompt-spark); }')
    expect(css).toContain('.dark .prompt-effort-settings')
    expect(css).toContain('.prompt-effort-thumb { transition: background-color 300ms ease; }')
  })

  it('aligns the fill with the circular thumb and centers the value', () => {
    const html = renderSettings('medium')
    expect(html).toContain('思考强度')
    expect(html).toContain('中等')
    expect(html).toContain('class="prompt-effort-thumb"')
    expect(html).toContain('--prompt-effort-thumb:22px')
    // Medium is index 2 of 6. Fill reaches the thumb's right edge (center + 11px).
    expect(html).toContain('--prompt-effort-fill:calc(calc(11px + (100% - 22px) * 0.4) + 11px)')
    expect(html).toContain('aria-disabled="false"')

    const maxed = renderSettings('max')
    expect(maxed).toContain('data-max="true"')
    expect(maxed).toContain('--prompt-effort-fill:100%')

    const disabled = renderSettings('medium', true)
    expect(disabled).toContain('aria-disabled="true"')
  })
})
