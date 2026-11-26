import { describe, expect, it } from 'bun:test'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import { SETTINGS_PAGES, isVisibleSettingsSubpage } from '../../../../shared/settings-registry'

describe('settings navigator descriptions', () => {
  it('keeps a non-empty description for every visible settings entry', () => {
    const en: Record<string, string> = LOCALE_REGISTRY.en.messages

    for (const page of SETTINGS_PAGES.filter((page) => isVisibleSettingsSubpage(page.id))) {
      expect(page.descriptionKey, `${page.id} description key`).toBeTruthy()
      expect(en[page.descriptionKey], `${page.id} English description`).toBeTruthy()
    }
  })

  it('describes messaging as more than a single platform connection', () => {
    const en = LOCALE_REGISTRY.en.messages
    const zhHans = LOCALE_REGISTRY['zh-Hans'].messages

    expect(en['settings.messaging.description']).toBe('Lark, WeChat, session bindings')
    expect(zhHans['settings.messaging.description']).toBe('飞书、微信与会话绑定')
  })
})
