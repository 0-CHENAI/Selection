import { describe, expect, it } from 'bun:test'
import { nodeKindLabelKey, runStatusLabelKey, runnerLabelKey } from '../task-labels.ts'

describe('task-labels', () => {
  it('maps authored kinds and run statuses to i18n keys', () => {
    expect(nodeKindLabelKey('approval')).toBe('tasks.nodeKindApproval')
    expect(nodeKindLabelKey(undefined)).toBe('tasks.nodeKindSession')
    expect(nodeKindLabelKey('mystery')).toBe('tasks.nodeKindSession')
    expect(runStatusLabelKey('waiting-approval')).toBe('tasks.runStatusWaitingApproval')
    expect(runStatusLabelKey('waiting-coordinator')).toBe('tasks.runStatusWaitingCoordinator')
    expect(runStatusLabelKey('unknown')).toBeNull()
  })

  it('uses the beta copy when orchestrate is selected but the flag is off', () => {
    expect(runnerLabelKey('conduct', false)).toBe('tasks.runnerConduct')
    expect(runnerLabelKey('orchestrate', true)).toBe('tasks.runnerOrchestrate')
    expect(runnerLabelKey('orchestrate', false)).toBe('tasks.orchestrateBeta')
  })
})
