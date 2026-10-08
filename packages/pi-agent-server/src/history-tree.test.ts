import { test, expect } from 'bun:test';
import { historyTree } from './history-records';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
const message = (id: string, text: string) => ({ id, type: 'message', message: { role: 'user', content: text } });
test('native summary lineage expands exact original versions on the active branch and remains stable after restart', () => {
  const entries = [message('a', '原文A'), message('b', '原文B'), { id: 's1', type: 'compaction', firstKeptEntryId: 'b', summary: '摘要A' }, message('c', '原文C'), { id: 's2', type: 'compaction', firstKeptEntryId: 'c', summary: '摘要A和B' }] as SessionEntry[];
  const tree = historyTree(entries);
  expect(tree.find(record => record.id === 's1')).toMatchObject({ childIds: ['a'], parentId: 's2' });
  expect(tree.find(record => record.id === 's2')).toMatchObject({ childIds: ['s1', 'b'] });
  expect(tree.find(record => record.id === 'a')).toMatchObject({ text: '原文A', parentId: 's1' });
  expect(historyTree(JSON.parse(JSON.stringify(entries)))).toEqual(tree);
  expect(historyTree([message('a', 'changed')] as SessionEntry[])[0]!.version).not.toBe(tree[0]!.version);
  const edited = historyTree([message('a', 'changed'), ...entries.slice(1)] as SessionEntry[]);
  expect(edited.find(record => record.id === 's2')!.version).not.toBe(tree.find(record => record.id === 's2')!.version);
  expect(historyTree([])).toEqual([]);
  expect(historyTree([{ id: 'legacy', type: 'compaction', firstKeptEntryId: 'absent', summary: 'old' }] as SessionEntry[])[0]).toMatchObject({ childIds: [], limitation: expect.stringContaining('unavailable') });
});
