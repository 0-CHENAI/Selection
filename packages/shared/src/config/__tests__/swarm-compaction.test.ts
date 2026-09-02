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

  it('compacts a child at 80% of its own 256 Ki budget on larger model windows', () => {
    const contextWindow = 1_000_000
    const agentTokenBudget = 262_144
    const reserve = swarmCompactionReserveTokens(contextWindow, agentTokenBudget)

    expect(reserve).toBe(790_285)
    expect(compactionTriggerTokens(contextWindow, reserve)).toBe(209_715)
  })

  it('still protects a smaller model context before the agent budget is reached', () => {
    const contextWindow = 131_072
    const reserve = swarmCompactionReserveTokens(contextWindow, 262_144)

    expect(compactionTriggerTokens(contextWindow, reserve)).toBe(104_857)
  })
})
