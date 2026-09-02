import { describe, expect, it } from 'bun:test'
import { wrapSpawnSessionToolError } from '../spawn-session-tool.ts'

describe('wrapSpawnSessionToolError', () => {
  it('does not nest already-formatted qualification failures', () => {
    const message = 'Unable to create Swarm workers: missing structured parallel contract. Pass qualification on spawn_session with tracks (at least two independent tracks), parallelBenefit, and finalAggregation. Writing a contract phrase into the name or prompt does not count.'
    expect(wrapSpawnSessionToolError(message)).toBe(message)
    expect(wrapSpawnSessionToolError(`spawn_session failed: ${message}`)).toBe(`spawn_session failed: ${message}`)
  })

  it('keeps a Chinese qualification failure unprefixed', () => {
    const message = '无法创建 Swarm 子代理：缺少结构化并行契约。请在 spawn_session 的 qualification 参数中提供 tracks（至少两条独立工作轨）、parallelBenefit 和 finalAggregation。把「任务契约」写进名称或提示词不算数。'
    expect(wrapSpawnSessionToolError(message)).toBe(message)
    const incomplete = '无法创建 Swarm 子代理：at least two independent tracks are required。请在 spawn_session 传入完整的 qualification 对象；把说明写进名称或提示词不算数。'
    expect(wrapSpawnSessionToolError(incomplete)).toBe(incomplete)
  })

  it('prefixes raw spawn errors once', () => {
    expect(wrapSpawnSessionToolError('No current-turn Swarm qualification credential is available'))
      .toBe('spawn_session failed: No current-turn Swarm qualification credential is available')
  })
})
