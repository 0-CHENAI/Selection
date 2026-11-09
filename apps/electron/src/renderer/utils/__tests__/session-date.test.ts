import { describe, expect, it } from 'bun:test'
import { formatSessionDateGroupLabel } from '../session-date'

const labels = {
  'common.today': 'TODAY',
  'common.yesterday': 'YESTERDAY',
} as const

const t = (key: keyof typeof labels) => labels[key]

describe('formatSessionDateGroupLabel', () => {
  it('uses compact CJK month-day formatting in Simplified Chinese and Japanese', () => {
    const date = new Date(2020, 8, 2)

    expect(formatSessionDateGroupLabel(date, t, 'zh-Hans')).toBe('9月2日')
    expect(formatSessionDateGroupLabel(date, t, 'zh-CN')).toBe('9月2日')
    expect(formatSessionDateGroupLabel(date, t, 'ja-JP')).toBe('9月2日')
  })

  it('keeps the compact English format', () => {
    expect(formatSessionDateGroupLabel(new Date(2020, 8, 2), t, 'en')).toBe('Sep 2')
  })

  it('keeps today and yesterday translated', () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)

    expect(formatSessionDateGroupLabel(today, t, 'zh-Hans')).toBe('TODAY')
    expect(formatSessionDateGroupLabel(yesterday, t, 'zh-Hans')).toBe('YESTERDAY')
  })
})
