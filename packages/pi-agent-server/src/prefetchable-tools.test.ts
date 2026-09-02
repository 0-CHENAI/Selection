import { describe, expect, it } from 'bun:test'
import { isPrefetchableTool } from './prefetchable-tools.ts'

describe('isPrefetchableTool', () => {
  it('prefetches call_llm and spawn_session including session prefixes', () => {
    expect(isPrefetchableTool('call_llm')).toBe(true)
    expect(isPrefetchableTool('mcp__session__call_llm')).toBe(true)
    expect(isPrefetchableTool('spawn_session')).toBe(true)
    expect(isPrefetchableTool('mcp__session__spawn_session')).toBe(true)
    expect(isPrefetchableTool('session__spawn_session')).toBe(true)
    expect(isPrefetchableTool('browser_tool')).toBe(false)
  })
})
