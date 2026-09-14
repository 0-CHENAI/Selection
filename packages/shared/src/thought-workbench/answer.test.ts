import { expect, it } from 'bun:test';
import { commitThoughtAnswer } from './answer.ts';
import { compileThoughtContext } from './context.ts';
import { newThoughtDocument, newThoughtNode, type ThoughtVersion } from './types.ts';

it('retries a concurrent graph edit and retains the old-input answer as history only', async () => {
  let current = { ...newThoughtDocument('doc'), nodes: [{ ...newThoughtNode('node'), question: 'original' }] };
  const version: ThoughtVersion = { id: 'generation', question: 'original', answer: 'old input answer', contextHash: (await compileThoughtContext(current, 'node')).hash, model: 'model', createdAt: 'now', status: 'completed' };
  let hashes = 0;
  await commitThoughtAnswer({ nodeId: 'node', version, active: () => true, load: () => current,
    hash: async document => {
      const hash = (await compileThoughtContext(document, 'node')).hash;
      if (++hashes === 1) current = { ...current, revision: current.revision + 1, nodes: [{ ...current.nodes[0]!, question: 'edited' }] };
      return hash;
    },
    commit: (document, revision) => { expect(revision).toBe(current.revision); current = document; },
  });
  expect(hashes).toBe(2);
  expect(current.nodes[0]!.question).toBe('edited');
  expect(current.nodes[0]!.answer).toBe('');
  expect(current.nodes[0]!.versions).toEqual([version]);
});

it('does not commit after cancellation during hashing', async () => {
  const document = { ...newThoughtDocument('doc'), nodes: [newThoughtNode('node')] };
  let active = true;
  let writes = 0;
  const result = await commitThoughtAnswer({ nodeId: 'node', version: { id: 'v', question: '', answer: 'late', contextHash: 'hash', model: '', createdAt: 'now', status: 'completed' },
    active: () => active, load: () => document, hash: async () => { active = false; return 'hash'; }, commit: () => { writes++; } });
  expect(result).toBe(false);
  expect(writes).toBe(0);
});
