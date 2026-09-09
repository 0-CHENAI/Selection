import { describe, expect, it } from 'bun:test'
import { formatDistanceStrict, type Locale } from 'date-fns'
import { setupI18n } from '@craft-agent/shared/i18n'
import { createShortTimeLocale, formatCompactRelativeTime } from '../session'

const i18n = setupI18n()

function translatorFor(language: 'en' | 'zh-Hans') {
  const t = i18n.getFixedT(language)
  return (key: string, options: { count: number }) => t(key, options)
}

describe('formatCompactRelativeTime', () => {
  it('maps every supported token to unambiguous Simplified Chinese elapsed time', () => {
    const t = translatorFor('zh-Hans')

    expect(formatCompactRelativeTime('xSeconds', 4, t)).toBe('4秒前')
    expect(formatCompactRelativeTime('xMinutes', 5, t)).toBe('5分钟前')
    expect(formatCompactRelativeTime('xHours', 2, t)).toBe('2小时前')
    expect(formatCompactRelativeTime('xDays', 3, t)).toBe('3天前')
    expect(formatCompactRelativeTime('xWeeks', 2, t)).toBe('2周前')
    expect(formatCompactRelativeTime('xMonths', 3, t)).toBe('3个月前')
    expect(formatCompactRelativeTime('xYears', 2, t)).toBe('2年前')
  })

  it('keeps compact English abbreviations through the production token mapping', () => {
    const t = translatorFor('en')

    expect(formatCompactRelativeTime('xHours', 2, t)).toBe('2h')
    expect(formatCompactRelativeTime('xDays', 3, t)).toBe('3d')
    expect(formatCompactRelativeTime('xMonths', 3, t)).toBe('3mo')
  })

  it('integrates the translator with the date-fns locale contract', () => {
    const locale = createShortTimeLocale(translatorFor('zh-Hans')) as Locale
    const earlier = new Date(2020, 0, 1)
    const later = new Date(2020, 0, 4)

    expect(formatDistanceStrict(earlier, later, { locale })).toBe('3天前')
  })

  it('falls back safely when date-fns supplies an unknown token', () => {
    expect(formatCompactRelativeTime('unknown', 7, translatorFor('zh-Hans'))).toBe('7')
  })
})
