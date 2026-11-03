import { createElement, Fragment, type ReactNode } from 'react'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next, { type InitOptions } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'

const passthrough = ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children)
mock.module('@craft-agent/ui', () => ({
  Tooltip: passthrough,
  TooltipTrigger: passthrough,
  TooltipContent: passthrough,
}))
mock.module('@radix-ui/react-dropdown-menu', () => ({ Item: passthrough }))

let FastModeButton: typeof import('../FastModeButton').FastModeButton

beforeAll(async () => {
  ;({ FastModeButton } = await import('../FastModeButton'))
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

describe('Fast mode button', () => {
  it('keeps the control label but omits it from the concise description', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={createTestI18n()}>
        <FastModeButton enabled={false} supported family="chatgpt" onChange={() => {}} />
      </I18nextProvider>,
    )

    expect(html).toContain('<span>Fast</span>')
    expect(html).toContain('1.5x 速度 · 2 倍额度消耗')
    expect(html).not.toContain('Fast ·')
  })

  it('uses a non-rectangular keyboard focus treatment', () => {
    const css = readFileSync(join(import.meta.dir, '../FastModeButton.css'), 'utf8')
    const focusRule = css.slice(
      css.indexOf('.prompt-fast-button:focus-visible {'),
      css.indexOf('.prompt-fast-button:focus-visible svg'),
    )

    expect(focusRule).toContain('outline: none')
    expect(focusRule).not.toContain('border:')
    expect(focusRule).not.toContain('box-shadow:')
  })
})
