import { describe, expect, it } from 'bun:test'
import { buildClaudeResumeOptions } from '../claude-agent.ts'

describe('Claude fresh-session resume isolation', () => {
  it('does not resume or fork for a new independent Craft Session', () => {
    expect(buildClaudeResumeOptions({
      isRetry: false,
      sessionId: null,
      branchFromSdkSessionId: null,
      branchFromSdkTurnId: null,
    })).toEqual({})
  })

  it('resumes only the SDK ID explicitly owned by the current session', () => {
    expect(buildClaudeResumeOptions({
      isRetry: false,
      sessionId: 'sdk-session-b',
      branchFromSdkSessionId: null,
      branchFromSdkTurnId: null,
    })).toEqual({ resume: 'sdk-session-b' })
  })

  it('forks only when explicit branch metadata is present', () => {
    expect(buildClaudeResumeOptions({
      isRetry: false,
      sessionId: null,
      branchFromSdkSessionId: 'sdk-session-a',
      branchFromSdkTurnId: 'turn-a',
    })).toEqual({
      resume: 'sdk-session-a',
      forkSession: true,
      resumeSessionAt: 'turn-a',
    })
  })

  it('drops all resume context during recovery retry', () => {
    expect(buildClaudeResumeOptions({
      isRetry: true,
      sessionId: 'sdk-session-a',
      branchFromSdkSessionId: 'sdk-parent-a',
      branchFromSdkTurnId: 'turn-a',
    })).toEqual({})
  })
})
