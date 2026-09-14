import { createHash } from 'node:crypto';
import { realpathSync, openSync, closeSync, fstatSync, readFileSync, constants } from 'node:fs';
import { sep, resolve } from 'node:path';
import type { Message } from '@craft-agent/core/types';
import { getSessionPath } from '../sessions/storage.ts';
import { MAX_WORKBENCH_MATERIAL_BYTES, storeWorkbenchMaterialBlob } from './materials.ts';
import type { ThoughtNode } from './types.ts';
import { extractWorkbenchFile } from './extract-file.ts';

/** Only copies persisted attachments owned by the selected session, not arbitrary user paths. */
export async function attachSessionMaterials(root: string, documentId: string, sessionId: string, messages: Message[], nodes: ThoughtNode[]): Promise<ThoughtNode[]> {
  const byId = new Map(messages.map(message => [message.id, message]));
  if (!nodes.some(node => byId.get(node.source?.messageId ?? '')?.attachments?.length)) return nodes;
  const workspace = realpathSync(root);
  const directory = realpathSync(getSessionPath(root, sessionId));
  if (!directory.startsWith(workspace + sep)) throw new Error('Session attachments are outside the workspace');
  const readOwned = (path: string): Buffer => {
    const resolved = realpathSync(resolve(directory, path));
    if (!resolved.startsWith(directory + sep)) throw new Error('Attachment is outside its session');
    const fd = openSync(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_WORKBENCH_MATERIAL_BYTES) throw new Error('Invalid or oversized session attachment');
      const bytes = readFileSync(fd);
      if (bytes.length > MAX_WORKBENCH_MATERIAL_BYTES) throw new Error('Oversized session attachment');
      return bytes;
    } finally { closeSync(fd); }
  };
  // Validate and read the whole batch before writing any source receipt or graph.
  const prepared = [];
  for (const node of nodes) {
    const attachments = [];
    for (const attachment of byId.get(node.source?.messageId ?? '')?.attachments ?? []) {
      const bytes = readOwned(attachment.storedPath);
      const extracted = attachment.markdownPath
        ? { text: new TextDecoder('utf-8', { fatal: true }).decode(readOwned(attachment.markdownPath)), pages: undefined }
        : await extractWorkbenchFile(bytes, attachment.name, attachment.mimeType);
      attachments.push({ attachment, bytes, ...extracted });
    }
    prepared.push({ node, attachments });
  }
  return prepared.map(({ node, attachments }) => ({ ...node, materials: attachments.map(({ attachment, bytes, text, pages }) => ({
    id: `attachment-${createHash('sha256').update(JSON.stringify([sessionId, node.source?.messageId, attachment.id])).digest('hex').slice(0, 32)}`,
    name: attachment.name, mimeType: attachment.mimeType, size: bytes.length, text, pages,
    digest: storeWorkbenchMaterialBlob(root, documentId, bytes),
  })) }));
}
