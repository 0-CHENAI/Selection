import { describe, expect, it } from 'bun:test';
import { parseResponsesApiResults } from './responses-api-parser.ts';

describe('parseResponsesApiResults', () => {
  it('uses annotation offsets relative to their own text part', () => {
    const results = parseResponsesApiResults({
      output: [{
        type: 'message',
        content: [
          { type: 'output_text', text: 'Unrelated first content part.' },
          {
            type: 'output_text',
            text: 'Second source description.',
            annotations: [{
              type: 'url_citation',
              url: 'https://example.com/source',
              title: 'Source',
              start_index: 0,
              end_index: 6,
            }],
          },
        ],
      }],
    }, 'query', 5);

    expect(results[0]?.description).toBe('Second');
  });

  it('ignores non-HTTP citations', () => {
    const results = parseResponsesApiResults({
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: 'Sources',
          annotations: [
            { type: 'url_citation', url: 'javascript:alert(1)', title: 'unsafe' },
            { type: 'url_citation', url: 'https://safe.example', title: 'safe' },
          ],
        }],
      }],
    }, 'query', 5);

    expect(results).toEqual([{
      title: 'safe',
      url: 'https://safe.example/',
      description: '',
    }]);
  });
});

it('recovers distinct URLs from completed search actions when annotations are missing', () => {
  const output = [
    { type: 'web_search_call', status: 'failed', action: { type: 'search', sources: [{ type: 'url', url: 'https://failed.example' }] } },
    { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [
      { type: 'url', url: 'javascript:alert(1)' }, { type: 'url', url: 'https://one.example' },
      { type: 'url', url: 'https://one.example/' }, { type: 'url', url: 'https://two.example/' },
    ] } },
  ];
  expect(parseResponsesApiResults({ output, output_text: 'Summary' }, 'test', 2).map(r => r.url))
    .toEqual(['https://one.example/', 'https://two.example/']);
  expect(parseResponsesApiResults({ output }, 'test', 1)).toHaveLength(1);
  expect(parseResponsesApiResults({ output: [...output, { type: 'message', content: [{ annotations: [
    { type: 'url_citation', url: 'https://cited.example' },
  ] }] }] }, 'test', 3).map(r => r.url)).toEqual(['https://cited.example/']);
});
