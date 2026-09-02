/** Tools the Pi subprocess may fire in parallel on message_end despite sequential execute(). */
export const PREFETCHABLE_TOOLS = new Set(['call_llm', 'spawn_session'])

export function isPrefetchableTool(toolName: string): boolean {
  const stripped = toolName.replace(/^(mcp__session__|session__)/, '')
  return PREFETCHABLE_TOOLS.has(stripped)
}
