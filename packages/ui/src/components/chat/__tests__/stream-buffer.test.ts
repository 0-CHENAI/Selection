import { describe, it, expect } from 'bun:test'
import {
  measureContentUnits,
  shouldShowContent,
  hasStructure,
  isQuestion,
  getNextBufferCheckDelayMs,
  resolveStreamElapsedMs,
  BUFFER_CONFIG,
} from '../stream-buffer.ts'

describe('measureContentUnits', () => {
  it('counts latin words by spaces', () => {
    expect(measureContentUnits('hello world foo')).toBe(3)
  })

  it('counts Chinese without spaces', () => {
    // 11 CJK chars → ceil(11/2) = 6
    expect(measureContentUnits('这个文件夹看起来是一个')).toBe(6)
  })

  it('handles mixed CJK and latin', () => {
    // "Selection" = 1, "工作区" = ceil(3/2) = 2 → 3
    expect(measureContentUnits('Selection 工作区')).toBe(3)
  })

  it('does not inflate units for CJK punctuation alone', () => {
    // pure punctuation tokens should not add latinish units
    expect(measureContentUnits('你好。')).toBe(1) // ceil(2/2)=1, 。 stripped
  })

  it('returns 0 for empty', () => {
    expect(measureContentUnits('   ')).toBe(0)
  })
})

describe('shouldShowContent', () => {
  const start = Date.now() - 200 // past MIN_BUFFER_MS

  it('always shows when not streaming', () => {
    const r = shouldShowContent('hi', false)
    expect(r.shouldShow).toBe(true)
    expect(r.reason).toBe('complete')
  })

  it('buffers during min flash window', () => {
    const r = shouldShowContent('hello world this is enough text already', true, Date.now())
    expect(r.shouldShow).toBe(false)
    expect(r.reason).toBe('min_time')
  })

  it('shows Chinese prose after structure with enough units', () => {
    const text = '这个文件夹看起来是一个 Selection 工作区，里面有很多配置。'
    const r = shouldShowContent(text, true, start)
    expect(r.shouldShow).toBe(true)
  })

  it('shows short Chinese after max buffer with minimal units', () => {
    const text = '你好世界' // 4 chars → 2 units
    const r = shouldShowContent(text, true, Date.now() - (BUFFER_CONFIG.MAX_BUFFER_MS + 50))
    expect(r.shouldShow).toBe(true)
    expect(r.reason).toBe('timeout')
  })

  it('does not permanently hide when streamStartTime is missing', () => {
    // Without clock, non-empty content must still be revealable
    const r = shouldShowContent('你好', true, undefined)
    expect(r.shouldShow).toBe(true)
    expect(r.reason).toBe('timeout')
  })

  it('keeps empty stream hidden', () => {
    const r = shouldShowContent('', true, start)
    expect(r.shouldShow).toBe(false)
    expect(r.reason).toBe('empty')
  })

  it('recognizes CJK question mark', () => {
    expect(isQuestion('这是什么？')).toBe(true)
    expect(hasStructure('好的。')).toBe(true)
  })

  it('shows code blocks early', () => {
    const text = '```ts\nconst x = 1\n```'
    const r = shouldShowContent(text, true, start)
    expect(r.shouldShow).toBe(true)
    expect(r.reason).toBe('code_block')
  })
})

describe('getNextBufferCheckDelayMs', () => {
  it('returns null when already showing', () => {
    expect(getNextBufferCheckDelayMs({ shouldShow: true, reason: 'complete' }, Date.now())).toBeNull()
  })

  it('returns null for empty (wait for tokens)', () => {
    expect(getNextBufferCheckDelayMs({ shouldShow: false, reason: 'empty' }, Date.now())).toBeNull()
  })

  it('schedules min window remaining', () => {
    const start = Date.now() - 20
    const delay = getNextBufferCheckDelayMs({ shouldShow: false, reason: 'min_time' }, start)
    expect(delay).not.toBeNull()
    expect(delay!).toBeGreaterThan(0)
    expect(delay!).toBeLessThanOrEqual(BUFFER_CONFIG.MIN_BUFFER_MS + 5)
  })

  it('schedules max window remaining when buffering', () => {
    const start = Date.now() - 100
    const delay = getNextBufferCheckDelayMs({ shouldShow: false, reason: 'buffering' }, start)
    expect(delay).not.toBeNull()
    expect(delay!).toBeGreaterThan(0)
    expect(delay!).toBeLessThanOrEqual(BUFFER_CONFIG.MAX_BUFFER_MS - 100 + 5)
  })
})

describe('resolveStreamElapsedMs', () => {
  it('reports hasClock when start provided', () => {
    const now = 1000
    const r = resolveStreamElapsedMs(now - 250, now)
    expect(r.hasClock).toBe(true)
    expect(r.elapsed).toBe(250)
  })

  it('skips min gate when clock missing', () => {
    const r = resolveStreamElapsedMs(undefined, 1000)
    expect(r.hasClock).toBe(false)
    expect(r.elapsed).toBe(BUFFER_CONFIG.MIN_BUFFER_MS)
  })
})
