import { describe, expect, it } from 'bun:test'
import type { Turn } from '@craft-agent/ui'
import { getWorkTimings } from '../ChatDisplay.work-status'

const user = (timestamp: number): Turn => ({ type: 'user', timestamp,
  message: { id: `user-${timestamp}`, role: 'user', content: '问题', timestamp } })
const reply = (timestamp: number): Turn => ({ type: 'assistant', turnId: `turn-${timestamp}`,
  timestamp, activities: [], isComplete: true, isStreaming: false,
  response: { text: '回复', timestamp, isStreaming: false } })
const stop = (timestamp: number, role: 'info' | 'error' = 'info'): Turn => ({ type: 'system', timestamp,
  message: { id: `stop-${timestamp}`, role, content: role === 'info' ? 'Response interrupted' : '连接失败', timestamp } })

describe('work status for each user request', () => {
  it('uses the regenerated execution clock after completion and session reopening', () => {
    const timings = getWorkTimings([user(1000), reply(3608000)], {
      startedAt: 3600000, completedAt: 3609000,
    })
    expect(timings.get(1)).toEqual({ startTime: 3600000, endTime: 3609000, interrupted: false, recorded: true })
  })
  it('does not reuse the previous attempt clock for a newer response', () => {
    expect(getWorkTimings([user(1000), reply(3608000)], {
      startedAt: 1000, completedAt: 9000,
    }, { startedAt: 3600000 }).get(1)?.recorded).toBeUndefined()
  })
  it('uses backend execution time even when the renderer receives the final text later', () => {
    expect(getWorkTimings([user(1000), reply(3610000)], {
      startedAt: 3600000, completedAt: 3609000,
    }).get(1)?.endTime).toBe(3609000)
  })
  it('freezes a stopped regeneration using the new execution clock and keeps the cross', () => {
    expect(getWorkTimings([user(1000), reply(3605000), stop(3608000)], {
      startedAt: 3600000, completedAt: 3609000,
    }).get(1)).toEqual({ startTime: 3600000, endTime: 3609000, interrupted: true, recorded: true })
  })
  it('keeps the completed execution clock with its request when the next prompt arrives', () => {
    const timings = getWorkTimings([user(1000), reply(3608000), user(3610000), reply(3611000)], {
      startedAt: 3600000, completedAt: 3609000,
    })
    expect(timings.get(1)?.startTime).toBe(3600000)
    expect(timings.get(3)?.recorded).toBeUndefined()
  })
  it('retains completed timings when the next request starts', () => {
    const timings = getWorkTimings([user(1000), reply(8000), user(10000), reply(13000)])
    expect(timings.get(1)).toEqual({ startTime: 1000, endTime: 8000, interrupted: false })
    expect(timings.get(3)).toEqual({ startTime: 10000, endTime: 13000, interrupted: false })
  })
  it('places one summary above the last card when tools split a reply', () => {
    const timings = getWorkTimings([user(1000), reply(2000), reply(7000)])
    expect([...timings.keys()]).toEqual([2])
    expect(timings.get(2)?.startTime).toBe(1000)
  })
  it('marks a stopped partial reply with a cross and includes its stop timestamp', () => {
    expect(getWorkTimings([user(1000), reply(5000), stop(9000)]).get(1))
      .toEqual({ startTime: 1000, endTime: 9000, interrupted: true })
  })
  it('retains work even when stopped before the first assistant token', () => {
    expect(getWorkTimings([user(1000), stop(4000)]).get(1))
      .toEqual({ startTime: 1000, endTime: 4000, interrupted: true })
  })
  it('uses a cross for terminal errors and a check after a successful recovery', () => {
    const failed = [user(1000), reply(2000), stop(3000, 'error')]
    expect(getWorkTimings(failed).get(1)?.interrupted).toBe(true)
    expect(getWorkTimings([...failed, reply(6000)]).get(3)?.interrupted).toBe(false)
  })
  it('does not treat informational messages or recovered tool errors as an interruption', () => {
    const assistant = reply(5000)
    if (assistant.type !== 'assistant') throw new Error('Expected assistant fixture')
    assistant.activities = [{ id: 'tool', type: 'tool', status: 'error', timestamp: 2000, error: '重试后恢复' }]
    const info = stop(6000)
    if (info.type !== 'system') throw new Error('Expected system fixture')
    info.message.content = 'Compaction complete'
    expect(getWorkTimings([user(1000), assistant, info]).get(1)?.interrupted).toBe(false)
  })
  it('treats a localized cancel marker as an interruption', () => {
    const marker = stop(4000)
    if (marker.type !== 'system') throw new Error('Expected system fixture')
    marker.message.content = '已取消'
    marker.message.statusType = 'turn_cancelled'
    expect(getWorkTimings([user(1000), marker]).get(1)?.interrupted).toBe(true)
  })
})
