import { describe, expect, it } from 'bun:test';
import {
  isPlainMcpVerb,
  isReadOnlyMcpToolName,
  mcpToolActionName,
  mcpToolNameWords,
} from '../mcp-tool-names.ts';

const DEFAULT_READ_VERBS = [
  'search', 'list', 'get', 'read', 'info', 'describe', 'show', 'view',
  'find', 'query', 'count', 'exists', 'status', 'inspect', 'fetch',
];

describe('mcp-tool-names', () => {
  it('treats plain lowercase words as verbs and everything else as regex', () => {
    expect(isPlainMcpVerb('get')).toBe(true);
    expect(isPlainMcpVerb('count')).toBe(true);
    expect(isPlainMcpVerb('mcp__slack__.*list')).toBe(false);
    expect(isPlainMcpVerb('Get')).toBe(false);
  });

  it('strips the mcp source prefix so the source slug is not part of the action', () => {
    expect(mcpToolActionName('mcp__budget__create_entry')).toBe('create_entry');
    expect(mcpToolActionName('mcp__slack__get_channel')).toBe('get_channel');
    expect(mcpToolNameWords('send_thread_reply')).toEqual(['send', 'thread', 'reply']);
    expect(mcpToolNameWords('listIssues')).toEqual(['list', 'issues']);
  });

  it('blocks write tools that previously matched default.json as substrings', () => {
    const cases = [
      'mcp__slack__send_thread_reply',
      'mcp__sheets__update_spreadsheet',
      'mcp__admin__delete_account',
      'mcp__budget__create_entry',
      'mcp__github__get_or_create_issue',
    ];
    for (const toolName of cases) {
      expect(isReadOnlyMcpToolName(toolName, DEFAULT_READ_VERBS)).toBe(false);
    }
  });

  it('allows genuine read tools, including source-prefixed and trailing-verb names', () => {
    expect(isReadOnlyMcpToolName('mcp__slack__get_channel', DEFAULT_READ_VERBS)).toBe(true);
    expect(isReadOnlyMcpToolName('mcp__linear__list_issues', DEFAULT_READ_VERBS)).toBe(true);
    expect(isReadOnlyMcpToolName('mcp__slack__slack_get_channel_history', DEFAULT_READ_VERBS)).toBe(true);
    expect(isReadOnlyMcpToolName('mcp__notion__issue_read', DEFAULT_READ_VERBS)).toBe(true);
    expect(isReadOnlyMcpToolName('mcp__docs__search', DEFAULT_READ_VERBS)).toBe(true);
  });
});
