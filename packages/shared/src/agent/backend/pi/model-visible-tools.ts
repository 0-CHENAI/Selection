/** Legacy names stay registered for exact-name execution and resumed histories. */
export const PI_SESSION_TOOL_SHORT_NAME_ALIASES = [
  'submit_answer', 'spawn_session', 'call_llm', 'run_task', 'submit_task_definition',
] as const;

/** Hide only duplicate session aliases from model requests, never from execution. */
export function modelVisibleTools<T extends { name: string }>(tools: T[]): T[] {
  const names = new Set(tools.map(tool => tool.name));
  const aliases: ReadonlySet<string> = new Set(PI_SESSION_TOOL_SHORT_NAME_ALIASES);
  return tools.filter(tool => !aliases.has(tool.name) || !names.has(`mcp__session__${tool.name}`));
}
