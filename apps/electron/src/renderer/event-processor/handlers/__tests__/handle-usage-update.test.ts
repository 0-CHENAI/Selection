import { describe, expect, it } from 'bun:test'
import { handleUsageUpdate } from '../session'
import type { SessionState, UsageUpdateEvent } from '../../types'

describe('handleUsageUpdate', () => {
  it('keeps the server accounting snapshot intact for the info panel', () => {
    const state = {
      session: {
        id: 'session-1',
        workspaceId: 'workspace-1',
        workspaceName: 'Workspace',
        lastMessageAt: 0,
        isProcessing: true,
        messages: [],
        tokenUsage: {
          inputTokens: 1,
          outputTokens: 2,
          totalTokens: 3,
          contextTokens: 0,
          costUsd: 0,
        },
      },
      streaming: null,
    } satisfies SessionState
    const event = {
      type: 'usage_update',
      sessionId: 'session-1',
      tokenUsage: {
        inputTokens: 350,
        outputTokens: 30,
        totalTokens: 380,
        contextTokens: 0,
        costUsd: 0.003,
        lastCall: {
          inputTokens: 350,
          outputTokens: 30,
          totalTokens: 380,
          cacheReadTokens: 150,
          cacheCreationTokens: 10,
          costUsd: 0.003,
        },
        currentTurn: {
          inputTokens: 700,
          outputTokens: 50,
          totalTokens: 750,
          cacheReadTokens: 300,
          cacheCreationTokens: 10,
          costUsd: 0.006,
          modelCallCount: 2,
          startedAt: 1_000,
          updatedAt: 3_000,
          wallClockMs: 2_000,
        },
      },
    } satisfies UsageUpdateEvent

    expect(handleUsageUpdate(state, event).state.session.tokenUsage).toEqual(event.tokenUsage)
  })
})
