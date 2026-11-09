import { afterEach, describe, expect, it } from 'bun:test';
import { AnthropicSearchProvider, parseAnthropicSearchResults } from './anthropic.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('AnthropicSearchProvider', () => {
  it('uses the official server-side web search tool and returns its sources', async () => {
    let url = '';
    let body: any;
    let headers: Record<string, string> = {};
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      body = JSON.parse(String(init?.body));
      headers = init?.headers as Record<string, string>;
      return Response.json({
        content: [{
          type: 'web_search_tool_result',
          content: [{
            type: 'web_search_result',
            title: 'Claude docs',
            url: 'https://platform.claude.com/docs/',
            page_age: '2026-10-31',
          }],
        }],
      });
    }) as typeof fetch;

    const results = await new AnthropicSearchProvider('sk-ant-api', 'pi/claude-sonnet-4-6')
      .search('Claude web search', 3);

    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers['x-api-key']).toBe('sk-ant-api');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.tools).toEqual([{
      type: 'web_search_20260318',
      name: 'web_search',
      max_uses: 1,
      allowed_callers: ['direct'],
    }]);
    expect(results[0]).toEqual({
      title: 'Claude docs',
      url: 'https://platform.claude.com/docs/',
      description: '2026-10-31',
    });
  });

  it('falls back to citation metadata and filters unsafe URLs', () => {
    expect(parseAnthropicSearchResults({
      content: [{
        type: 'text',
        text: 'answer',
        citations: [
          { type: 'web_search_result_location', url: 'file:///tmp/nope', title: 'unsafe' },
          {
            type: 'web_search_result_location',
            url: 'https://example.com/source',
            title: 'Source',
            cited_text: 'Quoted source context',
          },
        ],
      }],
    }, 3)).toEqual([{
      title: 'Source',
      url: 'https://example.com/source',
      description: 'Quoted source context',
    }]);
  });
});
