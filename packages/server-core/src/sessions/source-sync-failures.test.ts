import { describe, expect, it } from 'bun:test'
import { collectSourceSyncFailures, nextSourceSyncNotices, sourceSyncModelReminder } from './source-sync-failures.ts'

describe('source sync failure notices', () => {
  it('deduplicates slugs and ignores junk', () => {
    expect(collectSourceSyncFailures(['github', 'github', '', 1, null, 'linear'])).toEqual(['github', 'linear'])
    expect(collectSourceSyncFailures(undefined)).toEqual([])
  })

  it('notifies a slug only the first time it fails', () => {
    const notified = new Set<string>()
    expect(nextSourceSyncNotices(notified, ['github', 'linear'])).toEqual(['github', 'linear'])
    expect(nextSourceSyncNotices(notified, ['github', 'linear'])).toEqual([])
    expect(nextSourceSyncNotices(notified, ['github'])).toEqual([])
    expect(notified.has('linear')).toBe(false)
    expect(nextSourceSyncNotices(notified, ['linear'])).toEqual(['linear'])
  })

  it('tells the model which sources are unavailable', () => {
    expect(sourceSyncModelReminder(['github', 'linear'])).toContain('github, linear')
    expect(sourceSyncModelReminder(['github'])).toContain('<system-reminder>')
    expect(sourceSyncModelReminder([])).toBe('')
  })
})
