import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BackendConfig } from '../backend/types.ts'
import { PiAgent } from '../pi-agent.ts'

function createConfig(workspaceRootPath: string): BackendConfig {
  return {
    provider: 'pi',
    workspace: {
      id: 'ws-feedback-consent',
      name: 'Feedback Consent Tests',
      rootPath: workspaceRootPath,
    } as any,
    session: {
      id: 'session-feedback-consent',
      workspaceRootPath,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    } as any,
    isHeadless: true,
  }
}

describe('PiAgent developer feedback consent', () => {
  let workspaceRootPath: string
  let agent: PiAgent
  let sent: Array<Record<string, unknown>>
  let automationEvents: Array<{ event: string; input?: Record<string, unknown> }>

  beforeEach(() => {
    workspaceRootPath = mkdtempSync(join(tmpdir(), 'selection-feedback-consent-'))
    agent = new PiAgent(createConfig(workspaceRootPath))
    agent.setPermissionMode('allow-all')
    sent = []
    automationEvents = []
    ;(agent as any).send = (message: Record<string, unknown>) => sent.push(message)
    ;(agent as any).emitAutomationEvent = async (
      event: string,
      input?: Record<string, unknown>,
    ) => automationEvents.push({ event, input })
  })

  afterEach(() => {
    agent.destroy()
    rmSync(workspaceRootPath, { recursive: true, force: true })
  })

  it('binds an approved exact message to a host-issued one-shot token', async () => {
    const message = 'Only report this product issue.'
    agent.onPermissionRequest = request => {
      expect(request.description).toContain(message)
      agent.respondToPermission(request.requestId, true)
    }

    await (agent as any).handlePreToolUseRequest({
      requestId: 'feedback-approved',
      toolCallId: 'feedback-call-approved',
      toolName: 'mcp__session__send_developer_feedback',
      input: { message },
    })

    const response = sent.at(-1)
    expect(response).toMatchObject({
      type: 'pre_tool_use_response',
      requestId: 'feedback-approved',
      action: 'modify',
    })
    const approvedInput = response?.input as Record<string, unknown>
    expect(approvedInput.message).toBe(message)
    expect(approvedInput.approvalToken).toMatch(/^feedback-approval-/)
    expect(automationEvents.map(({ event }) => event)).toEqual(['PermissionRequest', 'PreToolUse'])
    expect(automationEvents.at(-1)?.input?.tool_input).toEqual({ message })

    const context = (agent as any).getSessionToolContext()
    expect(context.consumeDeveloperFeedbackApproval(approvedInput.approvalToken, message)).toBe(true)
    expect(context.consumeDeveloperFeedbackApproval(approvedInput.approvalToken, message)).toBe(false)
  })

  it('does not issue a token when the user denies the request', async () => {
    agent.onPermissionRequest = request => {
      agent.respondToPermission(request.requestId, false)
    }

    await (agent as any).handlePreToolUseRequest({
      requestId: 'feedback-denied',
      toolCallId: 'feedback-call-denied',
      toolName: 'mcp__session__send_developer_feedback',
      input: { message: 'Do not send this.' },
    })

    expect(sent.at(-1)).toMatchObject({
      type: 'pre_tool_use_response',
      requestId: 'feedback-denied',
      action: 'block',
      reason: 'Permission denied by user.',
    })
    expect((agent as any).approvedDeveloperFeedbackMessages.size).toBe(0)
  })

  it('fails closed when no permission UI is available', async () => {
    await (agent as any).handlePreToolUseRequest({
      requestId: 'feedback-headless',
      toolCallId: 'feedback-call-headless',
      toolName: 'mcp__session__send_developer_feedback',
      input: { message: 'No UI is available.' },
    })

    expect(sent.at(-1)).toMatchObject({
      type: 'pre_tool_use_response',
      requestId: 'feedback-headless',
      action: 'block',
    })
    expect(String(sent.at(-1)?.reason)).toContain('explicit user approval')
    expect((agent as any).approvedDeveloperFeedbackMessages.size).toBe(0)
  })
})
