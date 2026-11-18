import type { TaskListItem } from '@craft-agent/session-tools-core';

export function isTaskListTool(name?: string): boolean {
  return !!name && ['update_task_list', 'TodoWrite'].includes(name.replace(/^(mcp__session__|session__)/, ''));
}

/** Only a successful, validated result can update the conversation plan. */
export function parseTaskListResult(content?: string): TaskListItem[] | undefined {
  if (!content) return undefined;
  try {
    const parsed = JSON.parse(content) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return undefined;
    const items = parsed.items as TaskListItem[];
    if (!items.every(item => item && typeof item.id === 'string' && item.id.trim()
      && typeof item.content === 'string' && item.content.trim()
      && ['pending', 'in_progress', 'completed', 'interrupted'].includes(item.status))) return undefined;
    return items;
  } catch { return undefined; }
}

export function latestTaskList(messages: Array<{ timestamp?: number; parentToolUseId?: string; toolName?: string; toolStatus?: string; toolResult?: string; content: string; isError?: boolean }>): TaskListItem[] | undefined {
  let latest: TaskListItem[] | undefined;
  let latestTimestamp = -Infinity;
  for (const message of messages) {
    if (message.parentToolUseId || !isTaskListTool(message.toolName) || message.toolStatus !== 'completed' || message.isError) continue;
    // Older transcripts without timestamps retain their recorded order.
    const timestamp = message.timestamp ?? latestTimestamp;
    if (timestamp < latestTimestamp) continue;
    const items = parseTaskListResult(message.toolResult ?? message.content);
    if (items) {
      latest = items;
      latestTimestamp = timestamp;
    }
  }
  return latest;
}

export function withoutInheritedTaskLists<T extends { toolName?: string }>(messages: T[]): T[] {
  return messages.filter(message => !isTaskListTool(message.toolName));
}
