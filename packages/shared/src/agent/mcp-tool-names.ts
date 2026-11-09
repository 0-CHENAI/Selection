/**
 * Read-only classification of MCP tool names from verbs.
 *
 * The bundled default permissions list read verbs as plain words ("get",
 * "list", "search", ...). Matching them as substrings of the full
 * `mcp__<source>__<tool>` name let write tools through Explore mode:
 * `delete_account` contains "count", `send_thread_reply` contains "read",
 * every tool of a source named "budget" contains "get". This module matches
 * them as whole words of the tool's own name instead, and any write verb in
 * the name disqualifies it.
 */

/**
 * Verbs that mark a tool as mutating even when its name also contains a read
 * verb (`get_or_create_issue`, `search_and_replace`, `run_query`,
 * `mark_as_read`). Words that are just as often nouns in read tools
 * (`get_commit`, `get_post`, `get_block`, `get_charge`, `list_trash`) are
 * deliberately absent: a name without a read verb is never read-only anyway.
 */
const MCP_WRITE_WORDS = new Set([
  'create', 'update', 'upsert', 'delete', 'del', 'remove', 'rm', 'destroy', 'drop', 'truncate',
  'purge', 'wipe', 'erase', 'clear', 'send', 'put', 'set', 'add', 'append', 'insert', 'write',
  'edit', 'modify', 'replace', 'rename', 'move', 'copy', 'duplicate', 'clone', 'rebase', 'revert',
  'unpublish', 'unarchive', 'reopen', 'cancel', 'approve', 'reject', 'dismiss', 'assign',
  'unassign', 'kick', 'ban', 'unban', 'unblock', 'mute', 'unmute', 'follow', 'unfollow', 'react',
  'upvote', 'downvote', 'enable', 'disable', 'activate', 'deactivate', 'restart', 'kill',
  'terminate', 'run', 'execute', 'exec', 'trigger', 'invoke', 'pay', 'buy', 'subscribe',
  'unsubscribe', 'grant', 'revoke', 'authorize', 'login', 'logout', 'reply', 'forward', 'mark',
  'submit', 'save', 'apply', 'uninstall', 'upgrade', 'downgrade', 'rollback', 'reboot',
  'shutdown', 'provision', 'allocate', 'accept', 'decline', 'attach', 'detach', 'notify', 'compose',
  'reset', 'archive', 'publish', 'deploy', 'restore', 'toggle', 'rebuild', 'refresh', 'flush',
  'optimize', 'install', 'sync', 'ack', 'confirm', 'expire', 'reindex', 'enqueue', 'dequeue', 'retry',
]);

/**
 * Default "verbs" that are really nouns and appear in write tools too
 * (`post_status`, `reset_status`, `upload_info`). They count only as the first
 * word of the name (`status`, `count_documents`).
 */
const NOUN_LIKE_READ_WORDS = new Set(['status', 'info', 'count', 'exists']);

/** Verbs that may also close a two-word `resource_verb` name (`issue_read`, `notion-search`). */
const TRAILING_READ_VERBS = new Set(['read', 'get', 'list', 'search', 'fetch', 'find', 'query']);

/** The tool's own name: the part after `mcp__<source>__` (or the whole name when it has no prefix). */
export function mcpToolActionName(toolName: string): string {
  if (!toolName.startsWith('mcp__')) return toolName;
  const separator = toolName.indexOf('__', 'mcp__'.length);
  return separator === -1 ? toolName.slice('mcp__'.length) : toolName.slice(separator + 2);
}

/** Lower-case words of a tool name, split on camelCase and on any non-alphanumeric separator. */
export function mcpToolNameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(word => word.toLowerCase());
}

/** Words of the source slug in `mcp__<source>__<tool>`: tool names often start with them (`slack_get_…`). */
function mcpSourceWords(toolName: string): Set<string> {
  if (!toolName.startsWith('mcp__')) return new Set();
  const separator = toolName.indexOf('__', 'mcp__'.length);
  return new Set(mcpToolNameWords(separator === -1 ? '' : toolName.slice('mcp__'.length, separator)));
}

/**
 * Whether an MCP tool counts as read-only by verbs. No word of its own name may
 * be a write verb, and the read verb must be where the action is named:
 * - first (`get_issue`, `listIssues`, `status`);
 * - right after the source's own name (`slack_get_channel_history` from source `slack`);
 * - last in a two-word `resource_verb` name (`issue_read`, `notion-search`).
 * A read verb elsewhere is usually a noun (`rebuild_search_index`,
 * `refresh_materialized_view`) and does not count.
 */
export function isReadOnlyMcpToolName(toolName: string, readVerbs: readonly string[]): boolean {
  if (readVerbs.length === 0) return false;
  const words = mcpToolNameWords(mcpToolActionName(toolName));
  if (words.length === 0 || words.some(word => MCP_WRITE_WORDS.has(word))) return false;
  const verbs = new Set(readVerbs.map(verb => verb.toLowerCase()));
  const [first, second] = words as [string, string | undefined];
  if (verbs.has(first)) return true;
  if (second !== undefined && verbs.has(second) && !NOUN_LIKE_READ_WORDS.has(second)) {
    if (mcpSourceWords(toolName).has(first)) return true;
    if (words.length === 2 && TRAILING_READ_VERBS.has(second)) return true;
  }
  return false;
}

/** Plain lowercase words in a permissions file are verbs; anything else is a regex. */
export function isPlainMcpVerb(pattern: string): boolean {
  return /^[a-z][a-z0-9]*$/.test(pattern);
}
