import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PiAgent } from '../pi-agent'
import type { AnswerDeliveryControl } from '../backend/types'
import { answerToolBlock } from '../answer-delivery'
import * as config from '../../config'

const request = { requestId: 'req', toolName: 'mcp__session__submit_answer', args: { markdown: '完整答案。', featuredArtifacts: [] }, toolCallId: 'call', sdkMessageId: 'sdk-message', sdkTurnAnchor: 'sdk-entry', answerRunId: 'run' }
describe('answer delivery execution bridge', () => {
  let root: string
  let agent: PiAgent
  let sent: any[]
  let submitted: any[]
  let control: AnswerDeliveryControl
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'selection-answer-bridge-'))
    agent = new PiAgent({ provider: 'pi', isHeadless: true, explicitAnswerDelivery: true,
      workspace: { id: 'test', name: 'Test', rootPath: root } as any,
      session: { id: 'test-session', workspaceRootPath: root, createdAt: Date.now(), lastUsedAt: Date.now() } as any })
    sent = []; submitted = []
    ;(agent as any).send = (message: unknown) => sent.push(message)
    control = { runId: 'run', recovery: false, isActive: () => true, submit: async value => { submitted.push(value) } }
    agent.configureAnswerDelivery(control)
  })
  afterEach(() => { agent.destroy(); rmSync(root, { recursive: true, force: true }) })
  it('never executes submit_answer: natural-v1 commits the final message instead', async () => {
    await (agent as any).handleToolExecuteRequest(request)
    expect(sent.at(-1).result.isError).toBe(true)
    expect(JSON.stringify(sent.at(-1))).toContain('no answer submission tool')
    await (agent as any).handlePreToolUseRequest({ requestId: 'pre', toolName: 'submit_answer', input: {}, answerRunId: 'run' })
    expect(sent.at(-1).action).toBe('block')
    expect(submitted).toHaveLength(0)
    expect(answerToolBlock(undefined, false, 'mcp__session__submit_answer')).toContain('no answer submission tool')
    expect(answerToolBlock(control, false, 'Bash', 'run')).toBeUndefined()
  })
  it('blocks stale run requests at both permission and execution boundaries', async () => {
    await (agent as any).handleToolExecuteRequest({ ...request, toolName: 'Bash', args: { command: 'echo' }, answerRunId: 'old' })
    expect(sent.at(-1).result.isError).toBe(true)
    await (agent as any).handlePreToolUseRequest({ requestId: 'old', toolName: 'Bash', input: {}, answerRunId: 'old' })
    expect(sent.at(-1).action).toBe('block')
    expect(submitted).toHaveLength(0)
  })
  it('keeps internal coordination tools active', () => {
    control.coordinationOnly = true
    expect(answerToolBlock(control, false, 'mcp__session__submit_orchestration_decision', 'run')).toBeUndefined()
    expect(answerToolBlock(control, false, 'submit_answer', 'run')).toBeDefined()
  })
  it('never registers a delivery tool, even for a restored canonical root', () => {
    ;(agent as any).config.session.taskSlug = 'existing-plan'
    const browser = spyOn(config, 'getBrowserToolEnabled').mockReturnValue(false)
    try { (agent as any).registerSessionToolsWithSubprocess() }
    finally { browser.mockRestore() }
    const names = sent.at(-1).tools.map((tool: any) => tool.name)
    expect(names).not.toContain('mcp__session__submit_answer')
    expect(names).not.toContain('submit_answer')
    expect(names).not.toContain('mcp__session__submit_task_output')
    expect(names).not.toContain('mcp__session__submit_task_node_verdict')
  })
  it('makes recovery a text-only step and fails closed after cancellation', () => {
    control.recovery = true
    expect(answerToolBlock(control, false, 'Bash', 'run')).toContain('Tools are unavailable')
    expect(answerToolBlock(control, false, 'submit_answer', 'run')).toBeDefined()
    control.recovery = false
    control.isActive = () => false
    expect(answerToolBlock(control, false, 'Bash', 'run')).toContain('no longer active')
  })
  it('reads only its own live runtime context during recovery and rejects stale turns', async () => {
    control.recovery = true
    const routed: unknown[] = []
    ;(agent as any).routeToolCall = async (...args: unknown[]) => {
      routed.push(args)
      return { content: '{"orchestration":{"status":"running"}}', isError: false }
    }
    await (agent as any).handleRuntimeContextRequest({ requestId: 'context', answerRunId: 'run',
      toolName: 'Bash', args: { command: 'forbidden', sessionId: 'other' } })
    expect(routed).toEqual([['mcp__session__get_session_info', {}]])
    expect(sent.at(-1).result.isError).toBe(false)
    await (agent as any).handleRuntimeContextRequest({ requestId: 'old', answerRunId: 'old' })
    expect(sent.at(-1).result.isError).toBe(true)
    control.isActive = () => false
    await (agent as any).handleRuntimeContextRequest({ requestId: 'cancelled', answerRunId: 'run' })
    expect(sent.at(-1).result.isError).toBe(true)
    expect(routed).toHaveLength(1)
    expect(answerToolBlock({ ...control, isActive: () => true }, false, 'get_session_info', 'run')).toContain('Tools are unavailable')
  })
})
