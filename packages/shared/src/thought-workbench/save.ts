import { mergeThoughtDocuments, type ThoughtConflictChoice } from './merge.ts';
import type { ThoughtDocument } from './types.ts';

/** Rebase independent edits after a failed CAS, never bypassing revision checks. */
export async function saveThoughtWithMerge(input: {
  base: ThoughtDocument;
  local: ThoughtDocument;
  write: (document: ThoughtDocument) => Promise<ThoughtDocument>;
  load: () => Promise<ThoughtDocument>;
  resolutions?: Record<string, ThoughtConflictChoice>;
}): Promise<ThoughtDocument> {
  let base = input.base;
  let pending = input.local;
  for (;;) {
    try { return await input.write(pending); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes('Workbench revision conflict')) throw error;
      const remote = await input.load();
      // No newer authoritative revision means this error cannot be fixed by
      // rebasing. Avoid endlessly retrying a transport or malformed request.
      if (remote.revision <= pending.revision) throw error;
      pending = await mergeThoughtDocuments(base, pending, remote, input.resolutions);
      base = remote;
    }
  }
}
