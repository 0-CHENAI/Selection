import { describe, expect, it } from 'bun:test'
import { PiAgent } from '../pi-agent.ts'
import type { BackendConfig } from '../backend/types.ts'

function createConfig(): BackendConfig {
  return {
    provider: 'pi',
    workspace: { id: 'ws-test', name: 'Test', rootPath: '/tmp/selection-test' } as any,
    session: {
      id: 'session-test', workspaceRootPath: '/tmp/selection-test',
      createdAt: 1, lastUsedAt: 1,
    } as any,
    isHeadless: true,
  }
}

describe('PiAgent OfficeCLI latency telemetry', () => {
  it('counts attempted model calls and settles calls that end without message_end', () => {
    const agent = new PiAgent(createConfig())
    const internal = agent as unknown as {
      startMeasuredModelCall(now: number): void
      settleMeasuredModelCall(now: number): void
      modelWaitMs: number
      measuredModelCalls: number
    }

    internal.startMeasuredModelCall(100)
    internal.settleMeasuredModelCall(250)
    internal.startMeasuredModelCall(300)
    // Starting another call closes the previous failed/retried interval.
    internal.startMeasuredModelCall(450)
    internal.settleMeasuredModelCall(500)

    expect(internal.measuredModelCalls).toBe(3)
    expect(internal.modelWaitMs).toBe(350)
    agent.destroy()
  })
})
