import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'

const source = readFileSync(join(import.meta.dir, '../FreeFormInput.tsx'), 'utf8').replace(/\r\n/g, '\n')

describe('selected source badge chrome', () => {
  it('shows a localized selected count in desktop and compact layouts', () => {
    expect(source).toContain('const selectedSourcesLabel = t("chat.selectedSourcesCount", { count: optimisticSourceSlugs.length })')
    expect(LOCALE_REGISTRY['zh-Hans'].messages['chat.selectedSourcesCount']).toBe('已选用{{count}}个数据源')

    const sourceBadges = source.split('buttonRef={sourceButtonRef}').slice(1)
    expect(sourceBadges).toHaveLength(2)
    for (const chunk of sourceBadges) {
      const badgeProps = chunk.slice(0, chunk.indexOf('showChevron='))
      expect(badgeProps).toContain(': selectedSourcesLabel')
      expect(badgeProps).toContain('selectionChrome={false}')
    }
  })
})
