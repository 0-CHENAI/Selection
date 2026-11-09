import { expect, it } from 'bun:test';
import { promptContextCases, scorePolicyResponse } from './prompt-context-cases.ts';

it('separates policy errors from wrappers or object-shaped answers', () => {
  const expected = promptContextCases.map(() => 'A');
  expect(scorePolicyResponse(JSON.stringify(expected), expected)).toMatchObject({ passed: promptContextCases.length, exactFormat: true });
  expect(scorePolicyResponse('\n\n```json\n' + JSON.stringify(expected) + '\n```\n', expected))
    .toMatchObject({ passed: promptContextCases.length, exactFormat: false });
  expect(scorePolicyResponse(JSON.stringify(expected.map(choice => ({ choice }))), expected))
    .toMatchObject({ passed: promptContextCases.length, exactFormat: false });
  expect(scorePolicyResponse('not JSON', expected)).toMatchObject({ passed: 0, exactFormat: false });
  expect(scorePolicyResponse(JSON.stringify(['B', ...expected.slice(1)]), expected))
    .toMatchObject({ passed: promptContextCases.length - 1, failures: ['swarm-off'], exactFormat: true });
  const writingCases = promptContextCases.filter(([id]) => id.startsWith('writing-'));
  expect(scorePolicyResponse(JSON.stringify(writingCases.map(() => 'A')), writingCases.map(() => 'A'), writingCases))
    .toMatchObject({ passed: writingCases.length, exactFormat: true });
});
