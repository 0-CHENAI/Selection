import { describe, expect, it } from 'bun:test';
import { isConductorProtocolTool, toolCallBypassesWorkspaceCache } from './session-tool-usage.ts';

describe('session tool usage', () => {
  it('treats conductor protocol tools as non-bypass even with the session prefix', () => {
    expect(isConductorProtocolTool('submit_task_output')).toBe(true);
    expect(isConductorProtocolTool('mcp__session__submit_task_node_verdict')).toBe(true);
    expect(toolCallBypassesWorkspaceCache('submit_orchestration_decision')).toBe(false);
  });

  it('bypasses workspace-pure when the session used a real tool', () => {
    expect(toolCallBypassesWorkspaceCache('Read')).toBe(true);
    expect(toolCallBypassesWorkspaceCache('Bash')).toBe(true);
    expect(toolCallBypassesWorkspaceCache('mcp__github__list_issues')).toBe(true);
  });
});
