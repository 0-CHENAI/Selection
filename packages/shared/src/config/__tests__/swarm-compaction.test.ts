import { describe, expect, it } from 'bun:test'
import {
  compactionTriggerTokens,
  swarmCompactionReserveTokens,
} from '../models.ts'

describe('Swarm context compaction', () => {
  it('reserves the final 20% and triggers at 80% of each model window', () => {
    const contextWindow = 262_144
    const reserve = swarmCompactionReserveTokens(contextWindow)

    expect(reserve).toBe(52_429)
    expect(compactionTriggerTokens(contextWindow, reserve)).toBe(209_715)
  })

  it('rounds conservatively and ignores invalid windows', () => {
    expect(swarmCompactionReserveTokens(131_072)).toBe(26_215)
    expect(swarmCompactionReserveTokens(0)).toBe(0)
    expect(swarmCompactionReserveTokens(Number.NaN)).toBe(0)
  })
})
