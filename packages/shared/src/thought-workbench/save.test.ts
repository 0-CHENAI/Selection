import { expect, it } from 'bun:test';
import { saveThoughtWithMerge } from './save.ts';
import { newThoughtDocument } from './types.ts';

it('retries a revision conflict with merged edits and the fresh revision', async () => {
  const base = newThoughtDocument('doc');
  const revisions: number[] = [];
  const result = await saveThoughtWithMerge({ base, local: { ...base, title: 'local' }, load: async () => ({ ...base, revision: 2, projectId: 'remote-project' }),
    write: async document => {
      revisions.push(document.revision);
      if (revisions.length === 1) throw new Error('Workbench revision conflict');
      return { ...document, revision: document.revision + 1 };
    } });
  expect(revisions).toEqual([0, 2]);
  expect(result).toMatchObject({ title: 'local', projectId: 'remote-project', revision: 3 });
});

it('does not retry disk failures or a conflict with no newer revision', async () => {
  const base = newThoughtDocument('doc');
  let writes = 0;
  let reads = 0;
  for (const message of ['Disk full', 'Workbench revision conflict']) {
    await expect(saveThoughtWithMerge({ base, local: base, load: async () => { reads++; return base; }, write: async () => { writes++; throw new Error(message); } })).rejects.toThrow(message);
  }
  expect(writes).toBe(2);
  expect(reads).toBe(1);
});

it('rebases task linkage over independent graph edits but rejects competing task ETags', async () => {
  const base = { ...newThoughtDocument('doc'), revision: 1 };
  const local = { ...base, taskSlug: 'task', taskEtag: 'saved-task', executionYaml: 'next definition' };
  let attempt = 0;
  const linked = await saveThoughtWithMerge({ base, local, load: async () => ({ ...base, revision: 2, title: 'concurrent graph edit' }), write: async document => {
    if (!attempt++) throw new Error('Workbench revision conflict');
    return { ...document, revision: 3 };
  } });
  expect(linked).toMatchObject({ taskSlug: 'task', taskEtag: 'saved-task', title: 'concurrent graph edit', revision: 3 });
  await expect(saveThoughtWithMerge({ base, local, load: async () => ({ ...base, revision: 2, taskSlug: 'task', taskEtag: 'different-task-version' }), write: async () => { throw new Error('Workbench revision conflict'); } })).rejects.toThrow('Workbench edit conflict');
  let writes = 0;
  const resolved = await saveThoughtWithMerge({
    base, local,
    resolutions: { '/taskEtag': 'local' },
    load: async () => ({ ...base, revision: 2, taskSlug: 'task', taskEtag: 'different-task-version' }),
    write: async document => {
      if (!writes++) throw new Error('Workbench revision conflict');
      return { ...document, revision: 3 };
    },
  });
  expect(resolved).toMatchObject({ taskSlug: 'task', taskEtag: 'saved-task', revision: 3 });
});
