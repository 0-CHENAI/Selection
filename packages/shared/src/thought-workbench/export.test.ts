import { expect, it } from 'bun:test';
import { newThoughtDocument, newThoughtNode } from './types.ts';
import { workbenchMarkdown, workbenchSvg } from './export.ts';

it('keeps Unicode while replacing invalid XML characters only in the image export', () => {
  const title = '中文 😀\u0000\u0001\uD800 &';
  const document = { ...newThoughtDocument('doc'), nodes: [{ ...newThoughtNode('node'), title }] };
  const svg = workbenchSvg(document);
  expect(svg).toContain('中文 😀��� &amp;');
  expect(svg).not.toContain('\u0000');
  expect(workbenchMarkdown(document)).toContain(title);
});

it('exports collapsed groups without exposing their hidden cards, retaining complete text in Markdown', () => {
  const document = { ...newThoughtDocument('doc'), nodes: [{ ...newThoughtNode('a'), answer: 'HIDDEN_CARD_CONTENT' }], groups: [{ id: 'g', title: 'Group <one>', nodeIds: ['a'], collapsed: true }] };
  expect(workbenchSvg(document)).toContain('Group &lt;one&gt; (1)');
  expect(workbenchSvg(document)).not.toContain('HIDDEN_CARD_CONTENT');
  expect(workbenchMarkdown(document)).toContain('HIDDEN_CARD_CONTENT');
  expect(workbenchMarkdown(document)).toContain('"collapsed": true');
});

it('retains complete answers and sources without letting content break report fences', () => {
  const document = { ...newThoughtDocument('doc'), nodes: [{ ...newThoughtNode('a'), answer: '```\n# not a heading\n```', source: { sessionId: 'session' } }] };
  const report = workbenchMarkdown(document);
  expect(report).toContain('````\n```\n# not a heading\n```\n````');
  expect(report).toContain('"sessionId": "session"');
  expect(report).toContain('## Relationships');
});
it('produces a self-contained SVG with escaped text, negative positions and reference edges', () => {
  const document = { ...newThoughtDocument('doc'), nodes: [{ ...newThoughtNode('a', { x: -300, y: -200 }), title: '<script>alert(1)</script>' }, newThoughtNode('b')],
    edges: [{ id: 'edge', source: 'a', target: 'b', kind: 'reference' as const, depth: 'quote' as const, order: 0 }] };
  const svg = workbenchSvg(document);
  expect(svg).not.toContain('<script>');
  expect(svg).toContain('&lt;script&gt;');
  expect(svg).toContain('viewBox="-340 -268');
  expect(svg).toContain('stroke-dasharray="6 4"');
  expect(svg).not.toContain('foreignObject');
});
