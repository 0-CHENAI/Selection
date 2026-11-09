/**
 * Tools that are Conductor protocol, not workspace side effects.
 * workspace-pure cache still bypasses Read/Write/Bash/Skill/MCP/etc.
 */
const CONDUCTOR_PROTOCOL_TOOLS = new Set([
  'submit_task_output',
  'submit_task_verdict',
  'submit_task_node_verdict',
  'submit_orchestration_decision',
  'submit_orchestration_patch',
  'submit_task_definition',
  'control_task_run',
  'create_task',
  'run_task',
  'get_task_results',
]);

export function stripSessionToolPrefix(toolName: string): string {
  return toolName.startsWith('mcp__session__') ? toolName.slice('mcp__session__'.length) : toolName;
}

export function isConductorProtocolTool(toolName: string): boolean {
  return CONDUCTOR_PROTOCOL_TOOLS.has(stripSessionToolPrefix(toolName));
}

/** True when a tool call must bypass workspace-pure cache writes. */
export function toolCallBypassesWorkspaceCache(toolName: string): boolean {
  return !isConductorProtocolTool(toolName);
}
