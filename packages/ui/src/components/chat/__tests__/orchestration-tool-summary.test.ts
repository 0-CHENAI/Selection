import { describe, expect, it } from 'bun:test'
import { formatOrchestrationToolSummary } from '../turn-utils'

describe('formatOrchestrationToolSummary', () => {
  it('summarizes spawn_session wait results', () => {
    expect(formatOrchestrationToolSummary(
      'mcp__session__spawn_session',
      JSON.stringify({
        sessionId: 'child-1',
        status: 'completed',
        finalText: 'Found login.ts in src/auth',
      }),
    )).toBe('completed · child-1 · Found login.ts in src/auth')
  })

  it('summarizes run_task results with runId', () => {
    expect(formatOrchestrationToolSummary(
      'run_task',
      JSON.stringify({ slug: 'review-auth', runId: 'run-9', status: 'running' }),
    )).toBe('running · run-9')
  })

  it('summarizes the legacy Selection session alias', () => {
    expect(formatOrchestrationToolSummary(
      'session__spawn_session',
      JSON.stringify({ sessionId: 'child-2', status: 'started' }),
    )).toBe('started · child-2')
  })

  it('truncates long finalText onto one line', () => {
    const summary = formatOrchestrationToolSummary(
      'spawn_session',
      JSON.stringify({
        sessionId: 's1',
        status: 'completed',
        finalText: `${'word '.repeat(80)}\nMore`,
      }),
    )
    expect(summary?.startsWith('completed · s1 · ')).toBe(true)
    expect(summary).toContain('…')
    expect(summary?.includes('\n')).toBe(false)
    expect(summary!.length).toBeLessThan(160)
  })

  it('ignores unrelated tools and help payloads', () => {
    expect(formatOrchestrationToolSummary('Read', '{"status":"ok"}')).toBeNull()
    expect(formatOrchestrationToolSummary(
      'mcp__vendor__spawn_session',
      '{"status":"started","sessionId":"vendor-child"}',
    )).toBeNull()
    expect(formatOrchestrationToolSummary('spawn_session', '{"connections":[]}')).toBeNull()
    expect(formatOrchestrationToolSummary('spawn_session', 'not json')).toBeNull()
  })
})
