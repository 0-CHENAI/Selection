import { describe, expect, it } from 'bun:test'
import type { SessionConfig } from '../../sessions/types.ts'
import { buildPiSwarmInitConfig, buildPiExecutionScope } from '../pi-agent.ts'

function session(overrides: Partial<SessionConfig>): SessionConfig {
  return {
    id: 'session',
    workMode: 'PRO',
    workspaceRootPath: '/tmp/workspace',
    createdAt: 1,
    lastUsedAt: 1,
    ...overrides,
  }
}

describe('PiAgent Swarm init payload', () => {
  it('keeps root planning requirements separate from worker execution prohibitions', () => {
    const root = buildPiExecutionScope(session({ executionRootSessionId: 'session' }), 'session')
    expect(root).toContain('You are the PRO root coordinator')
    expect(root).toContain('create_task with a stable requestId')
    expect(root).not.toContain('Do not create or run plans')
    for (const child of [{ parentSessionId: 'root' }, { taskNodeId: 'a' }, { orchestrationRole: 'reviewer' as const }]) {
      const scope = buildPiExecutionScope(session(child), 'session')
      expect(scope).toContain('Do not create or run plans')
      expect(scope).not.toContain('You are the PRO root coordinator')
    }
    for (const denied of [{ workMode: 'NORM' as const }, { workModeNeedsReview: true }, { executionRootSessionId: 'other' }]) {
      expect(buildPiExecutionScope(session(denied), 'session')).toContain('unavailable in this execution scope')
    }
    const previous = process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE
    try {
      process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = '0'
      expect(buildPiExecutionScope(session({}), 'session')).toContain('unavailable in this execution scope')
    } finally {
      if (previous === undefined) delete process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE
      else process.env.CRAFT_FEATURE_TASKS_ORCHESTRATE = previous
    }
  })
  it('never enables delegation from a NORM toggle or disputed owner', () => {
    expect(buildPiSwarmInitConfig(session({ workMode: 'NORM', swarmEnabled: true })).swarmEnabled).toBe(false)
    expect(buildPiSwarmInitConfig(session({ workMode: 'PRO', workModeNeedsReview: true, swarmEnabled: true })).swarmEnabled).toBe(false)
  })
  it('sends the independent 256 Ki budget for a spawned agent', () => {
    expect(buildPiSwarmInitConfig(session({
      id: 'child',
      swarmEnabled: true,
      orchestrationId: 'orch',
      orchestrationRootSessionId: 'root',
      orchestrationDepth: 1,
      orchestrationTokenBudget: 262_144,
    }))).toEqual({
      swarmEnabled: false,
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
