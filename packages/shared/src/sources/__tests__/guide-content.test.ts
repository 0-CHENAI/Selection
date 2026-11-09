import { describe, expect, it } from 'bun:test';
import { getSourceSlugForTool, hasMeaningfulSourceGuide } from '../guide-content.ts';

describe('hasMeaningfulSourceGuide', () => {
  it('ignores the automatically generated source guide skeleton', () => {
    expect(hasMeaningfulSourceGuide(`# anysearch

## Guidelines

(Add usage guidelines here)

## Context

(Add context about this source)
`)).toBe(false);
  });

  it('ignores empty guides, headings, comments, and cache-only frontmatter', () => {
    expect(hasMeaningfulSourceGuide(undefined)).toBe(false);
    expect(hasMeaningfulSourceGuide(' \n\t ')).toBe(false);
    expect(hasMeaningfulSourceGuide('# Source\n\n## Guidelines')).toBe(false);
    expect(hasMeaningfulSourceGuide('<!-- internal cache -->\n# Source')).toBe(false);
    expect(hasMeaningfulSourceGuide('---\ncache:\n  endpoints: []\n---\n# Source')).toBe(false);
  });

  it('recognizes short, localized, and code-based instructions', () => {
    expect(hasMeaningfulSourceGuide('# Source\nOnly read.')).toBe(true);
    expect(hasMeaningfulSourceGuide('# 搜索\n请优先使用官方来源。')).toBe(true);
    expect(hasMeaningfulSourceGuide('# API\n```json\n{"limit": 10}\n```')).toBe(true);
    expect(hasMeaningfulSourceGuide('# Source\n(Add usage guidelines here)\nUse v2.')).toBe(true);
  });

  it('treats ambiguous malformed frontmatter as meaningful', () => {
    expect(hasMeaningfulSourceGuide('---\nimportant: never delete data\n# Source')).toBe(true);
  });
});

describe('getSourceSlugForTool', () => {
  it('recognizes MCP and API source tools', () => {
    expect(getSourceSlugForTool('mcp__anysearch__search')).toBe('anysearch');
    expect(getSourceSlugForTool('api_example')).toBe('example');
  });

  it('ignores built-in, malformed, and internal source tools', () => {
    expect(getSourceSlugForTool('Read')).toBeNull();
    expect(getSourceSlugForTool('mcp__missing')).toBeNull();
    expect(getSourceSlugForTool('mcp__session__browser_tool')).toBeNull();
    expect(getSourceSlugForTool('mcp__craft-agents-docs__search')).toBeNull();
    expect(getSourceSlugForTool('api_')).toBeNull();
  });

  it('rejects source identifiers that could escape their workspace directory', () => {
    expect(getSourceSlugForTool('mcp__..__read')).toBeNull();
    expect(getSourceSlugForTool('mcp__../private__read')).toBeNull();
    expect(getSourceSlugForTool('mcp__/absolute__read')).toBeNull();
    expect(getSourceSlugForTool('api_../private')).toBeNull();
    expect(getSourceSlugForTool('api_/absolute')).toBeNull();
    expect(getSourceSlugForTool('api_Source Name')).toBeNull();
  });
});
