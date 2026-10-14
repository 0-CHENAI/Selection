import { describe, expect, it } from 'bun:test'
import { answerExecutionError, answerTurnToolNames, isTurnCompletionTool, acceptsTurnCompletion } from './answer-delivery-guard'

describe('SDK answer delivery boundary', () => {
  const normal = { runId: 'run', accepted: false, recovery: false, batchSize: 1 }
  it('switches between coordination, failure delivery and final verification tool sets', () => {
    const tools = ['WebFetch', 'mcp__session__submit_orchestration_decision', 'mcp__session__submit_task_verdict', 'mcp__session__submit_answer']
    expect(answerTurnToolNames(tools, { runId: 'run', coordinationOnly: true })).toEqual(tools.slice(0, -1))
    // natural-v1: recovery is text-only and no delivery tool is ever model-visible.
    expect(answerTurnToolNames(tools, { runId: 'run', recovery: true })).toEqual([])
    expect(answerTurnToolNames(tools, { runId: 'run' })).toEqual(tools.slice(0, -1))
    expect(answerTurnToolNames(tools, {})).toEqual(tools.slice(0, -1))
    expect(tools).toHaveLength(4)
  })
  it('rejects an answer in a parallel batch, without blocking its business tools', () => {
    const batch = { ...normal, batchSize: 2 }
    expect(answerExecutionError(batch, 'mcp__session__submit_answer')).toContain('no answer submission tool')
    expect(answerExecutionError(batch, 'Bash')).toBeUndefined()
  })
  it('rejects remembered delivery calls even after sibling business tools have settled', () => {
    for (const name of ['submit_answer', 'mcp__session__submit_answer', 'session__submit_answer']) {
      expect(answerExecutionError({ ...normal, batchSize: 2, siblingsSettled: true, answerCalls: 1 }, name)).toContain('no answer submission tool')
    }
  })
  it('rejects duplicate answer calls in the same batch', () => {
    expect(answerExecutionError({ ...normal, batchSize: 2 }, 'submit_answer')).toContain('no answer submission tool')
    expect(answerExecutionError({ ...normal, batchSize: 3, siblingsSettled: true, answerCalls: 2 }, 'submit_answer')).toContain('no answer submission tool')
  })
  it('rejects standalone delivery calls with and without an active protocol', () => {
    expect(answerExecutionError(normal, 'submit_answer')).toContain('no answer submission tool')
    expect(answerExecutionError({ ...normal, runId: undefined }, 'submit_answer')).toContain('no answer submission tool')
  })
  it('blocks native, proxy and answer tools after acceptance', () => {
    for (const name of ['Bash', 'Write', 'mcp__source__search', 'submit_answer']) {
      expect(answerExecutionError({ ...normal, accepted: true }, name)).toContain('already delivered')
    }
  })
  it('permits no tools during the text-only recovery step', () => {
    expect(answerExecutionError({ ...normal, recovery: true }, 'Read')).toContain('Tools are unavailable')
    expect(answerExecutionError({ ...normal, recovery: true }, 'submit_answer')).toContain('Tools are unavailable')
  })
  it('yields only after a standalone accepted coordinator decision, including aliases', () => {
    for (const name of ['submit_orchestration_decision', 'mcp__session__submit_orchestration_decision', 'session__submit_orchestration_patch']) {
      expect(isTurnCompletionTool(name)).toBe(true)
      expect(answerExecutionError(normal, name)).toBeUndefined()
      expect(answerExecutionError({ ...normal, batchSize: 2 }, name)).toContain('alone')
      expect(answerExecutionError({ ...normal, accepted: true }, name)).toBeDefined()
    }
    expect(isTurnCompletionTool('get_task_results')).toBe(false)
    expect(isTurnCompletionTool('mcp__session__submit_task_node_verdict')).toBe(false)
  })
  it('keeps the SDK turn open for a duplicate receipt with a newer pending gate', () => {
    const receipt = (body: unknown, isError = false) => ({ isError, content: [{ type: 'text', text: JSON.stringify(body) }] })
    for (const name of ['submit_orchestration_decision', 'mcp__session__submit_orchestration_decision', 'session__submit_orchestration_decision']) {
      expect(acceptsTurnCompletion(name, receipt({ alreadyApplied: true, status: 'waiting-coordinator', coordinatorGate: { checkpointId: 'new' } }))).toBe(false)
      expect(acceptsTurnCompletion(name, receipt({ status: 'waiting-coordinator', coordinatorGate: { checkpointId: 'new' } }))).toBe(true)
      expect(acceptsTurnCompletion(name, receipt({ alreadyApplied: true, status: 'running' }))).toBe(true)
      expect(acceptsTurnCompletion(name, receipt({ status: 'running' }, true))).toBe(false)
    }
    expect(acceptsTurnCompletion('submit_answer', receipt({ accepted: true }))).toBe(true)
    expect(acceptsTurnCompletion('Read', receipt({}))).toBe(false)
    expect(acceptsTurnCompletion('submit_orchestration_decision', { content: JSON.stringify({ alreadyApplied: true, status: 'waiting-coordinator', coordinatorGate: { checkpointId: 'new' } }) })).toBe(false)
  })
})
