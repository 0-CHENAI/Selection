import { beforeAll, describe, expect, it, mock } from 'bun:test'
import i18next, { type InitOptions } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'

mock.module('@craft-agent/ui', () => ({ Spinner: () => null }))

let SessionSearchHeader: typeof import('../SessionSearchHeader').SessionSearchHeader

beforeAll(async () => {
  ;({ SessionSearchHeader } = await import('../SessionSearchHeader'))
})

function renderSearchHeader(language: keyof typeof LOCALE_REGISTRY): string {
  const instance = i18next.createInstance()
  void instance.init({
    lng: language,
    fallbackLng: 'en',
    initImmediate: false,
    resources: Object.fromEntries(
      Object.entries(LOCALE_REGISTRY).map(([code, entry]) => [
        code,
        { translation: entry.messages },
      ]),
    ),
  } as InitOptions)

  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <SessionSearchHeader searchQuery="" />
    </I18nextProvider>,
  )
}

describe('SessionSearchHeader localization', () => {
  it('uses the Chinese search placeholder from i18n', () => {
    const html = renderSearchHeader('zh-Hans')

    expect(html).toContain('placeholder="搜索标题和内容…"')
    expect(html).not.toContain('Search titles and content...')
  })

  it('keeps the English placeholder for the English interface', () => {
    expect(renderSearchHeader('en')).toContain(
      'placeholder="Search titles and content..."',
    )
  })
})
