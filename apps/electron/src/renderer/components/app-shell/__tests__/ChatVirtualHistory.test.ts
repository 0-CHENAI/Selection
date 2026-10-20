import { describe, expect, test } from 'bun:test'
import { Virtualizer } from '@tanstack/react-virtual'
import { shouldMeasureVirtualScrollMargin } from '../ChatVirtualHistory'

function history() {
  const corrections: number[] = []
  const list = new Virtualizer({
    count: 240, getScrollElement: () => null, estimateSize: () => 100,
    getItemKey: index => `turn-${index}`, initialRect: { width: 600, height: 200 }, initialOffset: 500,
    scrollToFn: (_offset, { adjustments }) => corrections.push(adjustments ?? 0),
    observeElementRect: () => {}, observeElementOffset: () => {}, overscan: 1,
  })
  return { list, corrections }
}

describe('virtual scroll margin', () => {
  const list = {}
  const viewport = {}
  test('ignores the list growing under a live stream', () => {
    expect(shouldMeasureVirtualScrollMargin([{ target: list }], list)).toBe(false)
  })
  test('still measures when the viewport or the content above the list changes', () => {
    expect(shouldMeasureVirtualScrollMargin([{ target: viewport }], list)).toBe(true)
    expect(shouldMeasureVirtualScrollMargin([{ target: list }, { target: viewport }], list)).toBe(true)
  })
})

describe('variable-height chat history', () => {
  test('keeps the full history extent with only viewport neighbours mounted', () => {
    const { list } = history()
    expect(list.getTotalSize()).toBe(24_000)
    expect(list.getVirtualItems().map(row => row.index)).toEqual([4, 5, 6, 7])
  })
  test('corrects an estimate above the fold without moving the reading anchor', () => {
    const { list, corrections } = history()
    list.getVirtualItems()
    list.resizeItem(0, 180)
    expect(corrections).toEqual([80])
    expect(list.getVirtualItems().map(row => row.index)).toEqual([4, 5, 6, 7])
  })
  test('streaming growth below the reader changes extent without scrolling them', () => {
    const { list, corrections } = history()
    list.getVirtualItems()
    list.resizeItem(239, 400)
    expect(corrections).toEqual([])
    expect(list.getTotalSize()).toBe(24_300)
  })
  test('retains measured heights after distant rows leave the rendered range', () => {
    const { list } = history()
    list.getVirtualItems()
    list.resizeItem(0, 280)
    list.getVirtualItems()
    expect(list.getVirtualItems().some(row => row.index === 0)).toBe(false)
    expect(list.getTotalSize()).toBe(24_180)
    expect(list.itemSizeCache.get('turn-0')).toBe(280)
  })
})
