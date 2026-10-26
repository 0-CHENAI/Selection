import { describe, expect, it } from 'bun:test'
import {
  initialPptHistoryListChrome,
  pptHistoryListVisible,
  reducePptHistoryList,
} from './ppt-history-list-chrome'

describe('PPT history list chrome', () => {
  it('collapses when Office opens and restores that collapse when Office closes', () => {
    expect(pptHistoryListVisible(initialPptHistoryListChrome)).toBe(true)
    const collapsed = reducePptHistoryList(initialPptHistoryListChrome, { type: 'office', open: true })
    expect(collapsed).toEqual({ userChoice: null, autoCollapsed: true })
    expect(pptHistoryListVisible(collapsed)).toBe(false)
    expect(reducePptHistoryList(collapsed, { type: 'office', open: true })).toBe(collapsed)
    expect(reducePptHistoryList(collapsed, { type: 'office', open: false })).toEqual(initialPptHistoryListChrome)
  })

  it('keeps an explicit open or close for the rest of the window', () => {
    const collapsed = reducePptHistoryList(initialPptHistoryListChrome, { type: 'office', open: true })
    const reopened = reducePptHistoryList(collapsed, { type: 'toggle' })
    expect(reopened).toEqual({ userChoice: 'open', autoCollapsed: false })
    expect(pptHistoryListVisible(reopened)).toBe(true)
    expect(reducePptHistoryList(reopened, { type: 'office', open: false })).toBe(reopened)
    expect(reducePptHistoryList(reopened, { type: 'office', open: true })).toBe(reopened)

    const closed = reducePptHistoryList(initialPptHistoryListChrome, { type: 'toggle' })
    expect(closed).toEqual({ userChoice: 'closed', autoCollapsed: false })
    expect(pptHistoryListVisible(closed)).toBe(false)
    const stillClosed = reducePptHistoryList(closed, { type: 'office', open: true })
    expect(stillClosed).toBe(closed)
    expect(reducePptHistoryList(stillClosed, { type: 'office', open: false })).toBe(closed)
    expect(pptHistoryListVisible(reducePptHistoryList(closed, { type: 'toggle' }))).toBe(true)
  })
})
