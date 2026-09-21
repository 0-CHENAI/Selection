import { expect, it } from 'bun:test'
import { collectSourceMetadata } from '../source-metadata'

it('reads actual search results as distinct plain text title and summary', () => {
  const result = collectSourceMetadata([{role:'tool',toolName:'web_search',content:'Search results for "test" (via search):\n\n1. **Page one**\n   https://example.com/one\n   A **bold** summary.\n\n2. **Page two**\n   https://example.com/two\n   <b>Second</b> description.'}])
  expect(result.get('https://example.com/one')).toEqual({title:'Page one',description:'A bold summary.'})
  expect(result.get('https://example.com/two')).toEqual({title:'Page two',description:'Second description.'})
})
it('falls back to retrieved page content without inventing a summary', () => {
  const result = collectSourceMetadata([{role:'tool',toolName:'web_fetch',content:'Content from https://example.com/page (asked: "overview"):\n\n# Heading\n\nActual page text.'}])
  expect(result.get('https://example.com/page')?.description).toBe('Heading Actual page text.')
  expect(result.get('https://missing.com')).toBeUndefined()
})
it('does not turn user or assistant statements into page metadata', () => {
  expect(collectSourceMetadata([{role:'assistant',content:'Content from https://example.com:\n\nInvented.'}]).size).toBe(0)
})

import { collectTurnResearchSources } from '../source-metadata'
it('shows sources for a researched answer with no links or source section', () => {
  const sources = collectTurnResearchSources([
    {type:'tool',status:'completed',toolName:'WebSearch',content:'Search results for "models" (via search):\n\n1. **Official documentation**\n   https://docs.example.com/model\n   Model specifications.'},
    {type:'tool',status:'completed',toolName:'WebFetch',toolInput:{url:'https://docs.example.com/model'},content:'Content from https://docs.example.com/model:\n\n# Model\nDetailed specifications.'},
    {type:'tool',status:'error',toolName:'WebFetch',toolInput:{url:'https://failed.example.com'},content:'Failed to fetch'},
  ])
  expect(sources).toHaveLength(1)
  expect(sources[0]?.title).toBe('Official documentation')
  expect(sources[0]?.description).toContain('Detailed specifications')
})
it('does not fabricate sources from unrelated tools or unfinished research', () => {
  expect(collectTurnResearchSources([
    {type:'tool',status:'running',toolName:'WebFetch',toolInput:{url:'https://example.com'}},
    {type:'tool',status:'completed',toolName:'Bash',content:'https://unrelated.com'},
    {type:'tool',status:'completed',toolName:'WebFetch',toolInput:{url:'https://failed.com'},content:'Failed to fetch https://failed.com: 403'},
  ])).toEqual([])
})
it('keeps source extraction scoped to the activities supplied by the owning turn', () => {
  const previous = [{type:'tool',status:'completed',toolName:'WebFetch',toolInput:{url:'https://old.example.com'},content:'Content from https://old.example.com:\n\nOld page'}]
  expect(collectTurnResearchSources(previous)).toHaveLength(1)
  expect(collectTurnResearchSources([])).toEqual([])
})

it('does not interpret web-like text emitted by unrelated tools as research', () => {
  expect(collectTurnResearchSources([{ type: 'tool', status: 'completed', toolName: 'Bash', content: 'Content from https://example.com:\n\nThis is a shell fixture.' }])).toEqual([])
})
