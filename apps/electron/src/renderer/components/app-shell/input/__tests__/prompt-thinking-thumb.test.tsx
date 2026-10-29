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

function renderSettings(value: 'medium' | 'max' = 'medium', disabled = false, headingAction?: ReactNode) {
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
        headingAction={headingAction}
        onChange={() => {}}
      />
    </I18nextProvider>,
  )
}

describe('thinking effort menu', () => {
  it('lists the real levels and marks medium as Default', () => {
    const html = renderSettings('medium')
    expect(html).toContain('思考强度')
    expect(html).toContain('中等')
    expect(html).toContain('默认')
    expect(html).toContain('data-testid="effort-level-medium"')
    expect(html).toContain('data-testid="effort-level-max"')
    expect(html).toContain('aria-checked="true"')
    expect(html).not.toContain('role="slider"')
    expect(html).not.toContain('prompt-effort-particles')
    expect(html).not.toContain('prompt-effort-shimmer')
    expect(css).not.toContain('prompt-effort-track')
    expect(css).not.toContain('prompt-effort-particles')
  })

  it('shows the Max usage note when Max is selected', () => {
    const html = renderSettings('max')
    expect(html).toContain('data-max="true"')
    expect(html).toContain('data-testid="effort-level-max"')
    expect(html).toContain('最彻底，但更慢，也会更快用完额度')
    const maxAt = html.indexOf('data-testid="effort-level-max"')
    expect(html.slice(maxAt - 80, maxAt + 700)).toContain('aria-checked="true"')
  })

  it('disables the choices when effort cannot change', () => {
    const disabled = renderSettings('medium', true)
    expect(disabled).toContain('disabled=""')
    expect(disabled).not.toContain('prompt-effort-thumb')
  })

  it('keeps a heading action beside the effort name', () => {
    const html = renderSettings('medium', false, createElement('span', { 'data-testid': 'effort-heading-action' }, 'Fast'))
    const heading = html.slice(html.indexOf('prompt-effort-heading'), html.indexOf('prompt-effort-options'))
    expect(heading).toContain('data-testid="effort-heading-action"')
    expect(heading).toContain('Fast')
  })

  it('drops motion on Fast when the user prefers less motion', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.prompt-fast-button[data-active] svg { animation: none; transition: none; }')
    expect(reduced).toContain('.prompt-sparks { display: none; }')
  })
})
