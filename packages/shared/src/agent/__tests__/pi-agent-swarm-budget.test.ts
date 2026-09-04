import { describe, expect, it } from 'bun:test'
import type { SessionConfig } from '../../sessions/types.ts'
import { buildPiSwarmInitConfig } from '../pi-agent.ts'

function session(overrides: Partial<SessionConfig>): SessionConfig {
  return {
    id: 'session',
    workspaceRootPath: '/tmp/workspace',
    createdAt: 1,
    lastUsedAt: 1,
    ...overrides,
  }
}

describe('PiAgent Swarm init payload', () => {
  it('sends the independent 256 Ki budget for a spawned agent', () => {
    expect(buildPiSwarmInitConfig(session({
      id: 'child',
      swarmEnabled: true,
      orchestrationId: 'orch',
      orchestrationRootSessionId: 'root',
      orchestrationDepth: 1,
      orchestrationTokenBudget: 262_144,
    }))).toEqual({
      swarmEnabled: true,
      swarmAgentTokenBudget: 262_144,
    })
  })

  it('keeps the budget for an explicitly spawned child when its toggle is off', () => {
    expect(buildPiSwarmInitConfig(session({
      id: 'child',
      swarmEnabled: false,
      orchestrationId: 'orch',
      orchestrationRootSessionId: 'root',
      orchestrationDepth: 1,
      orchestrationTokenBudget: 262_144,
    }))).toEqual({
      swarmEnabled: false,
      swarmAgentTokenBudget: 262_144,
    })
  })

  it('does not budget a root coordinator even when it belongs to a board task', () => {
    expect(buildPiSwarmInitConfig(session({
      id: 'dag-worker',
      swarmEnabled: true,
      orchestrationId: 'orch',
      orchestrationRootSessionId: 'dag-worker',
      orchestrationDepth: 0,
      orchestrationTokenBudget: 262_144,
    }))).toEqual({
      swarmEnabled: true,
      swarmAgentTokenBudget: undefined,
    })
  })
})
