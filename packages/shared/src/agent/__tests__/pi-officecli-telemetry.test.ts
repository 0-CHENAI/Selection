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

  it('preserves the budget for a continuation and resets it for a new user task', () => {
    const agent = new PiAgent(createConfig())
    const checkpoint = agent.getOfficecliContinuationState()
    checkpoint.execution.attemptedToolCalls = 8
    checkpoint.execution.toolCalls = 7
    checkpoint.execution.directMutations = 6
    checkpoint.modelWaitMs = 1234
    checkpoint.measuredModelCalls = 5
    agent.restoreOfficecliContinuationState(checkpoint)

    const internal = agent as unknown as {
      prepareOfficecliUserTask(continueUserTask: boolean): void
    }
    internal.prepareOfficecliUserTask(true)
    expect(agent.getOfficecliContinuationState()).toMatchObject({
      execution: { attemptedToolCalls: 8, toolCalls: 7, directMutations: 6 },
      modelWaitMs: 1234,
      measuredModelCalls: 5,
    })

    internal.prepareOfficecliUserTask(false)
    expect(agent.getOfficecliContinuationState()).toMatchObject({
      execution: { attemptedToolCalls: 0, toolCalls: 0, directMutations: 0 },
      modelWaitMs: 0,
      measuredModelCalls: 0,
    })
    agent.destroy()
  })

  it('includes trusted finalization latency in OfficeCLI execution telemetry', async () => {
    const agent = new PiAgent(createConfig())
    const internal = agent as unknown as {
      handleSubprocessEvent(event: Record<string, unknown>): void
    }
    internal.handleSubprocessEvent({
      type: 'tool_execution_start',
      toolCallId: 'finalize-1',
      toolName: 'mcp__session__officecli_finalize',
      args: { file: 'report.docx' },
    })
    await Bun.sleep(5)
    internal.handleSubprocessEvent({
      type: 'tool_execution_end',
      toolCallId: 'finalize-1',
      toolName: 'mcp__session__officecli_finalize',
      result: {},
      isError: false,
    })
    expect(agent.getOfficecliContinuationState().execution.executionMs).toBeGreaterThan(0)
    agent.destroy()
  })
})
