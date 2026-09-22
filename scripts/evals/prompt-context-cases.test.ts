import { expect, it } from 'bun:test';
import { promptContextCases, scorePolicyResponse } from './prompt-context-cases.ts';

it('separates policy errors from wrappers or object-shaped answers', () => {
  const expected = promptContextCases.map(() => 'A');
  expect(scorePolicyResponse(JSON.stringify(expected), expected)).toMatchObject({ passed: 30, exactFormat: true });
  expect(scorePolicyResponse('\n\n```json\n' + JSON.stringify(expected) + '\n```\n', expected))
    .toMatchObject({ passed: 30, exactFormat: false });
  expect(scorePolicyResponse(JSON.stringify(expected.map(choice => ({ choice }))), expected))
    .toMatchObject({ passed: 30, exactFormat: false });
  expect(scorePolicyResponse('not JSON', expected)).toMatchObject({ passed: 0, exactFormat: false });
  expect(scorePolicyResponse(JSON.stringify(['B', ...expected.slice(1)]), expected))
    .toMatchObject({ passed: 29, failures: ['swarm-off'], exactFormat: true });
});
