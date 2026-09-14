import { compileThoughtContext } from './context.ts';
import type { ThoughtDocument, ThoughtVersion } from './types.ts';

/** Hashing yields to graph edits. Retry against the latest document instead of
 * losing a delivered answer when authoring races with the asynchronous hash.
 * load/commit are synchronous so the final revision check and CAS cannot yield.
 */
export async function commitThoughtAnswer(input: {
  nodeId: string;
  version: ThoughtVersion;
  active: () => boolean;
  load: () => ThoughtDocument;
  commit: (document: ThoughtDocument, revision: number) => void;
  hash?: (document: ThoughtDocument, nodeId: string) => Promise<string>;
}): Promise<boolean> {
  const hash = input.hash ?? (async (document, nodeId) => (await compileThoughtContext(document, nodeId)).hash);
  while (input.active()) {
    const document = input.load();
    const node = document.nodes.find(item => item.id === input.nodeId);
    if (!node) throw new Error('Node was removed during generation');
    if (node.versions.some(version => version.id === input.version.id)) return true;
    const unchanged = await hash(document, node.id) === input.version.contextHash;
    if (!input.active()) return false;
    if (input.load().revision !== document.revision) continue;
    const next = { ...document, nodes: document.nodes.map(item => item.id !== node.id ? item : {
      ...item, versions: [...item.versions, input.version],
      ...(unchanged ? { answer: input.version.answer, activeVersionId: input.version.id } : {}),
    }) };
    input.commit(next, document.revision);
    return true;
  }
  return false;
}
