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
