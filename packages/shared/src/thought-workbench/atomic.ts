import { randomUUID } from 'node:crypto';
import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

/** Callers validate the document-owned directory. Exclusive randomized staging
 * avoids following a predictable .tmp symlink or clobbering another writer. */
export function atomicWorkbenchWrite(path: string, data: string): void {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const descriptor = openSync(temporary, 'wx', 0o600);
  let open = true;
  let published = false;
  try {
    writeFileSync(descriptor, data, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    open = false;
    renameSync(temporary, path);
    published = true;
  } finally {
    if (open) closeSync(descriptor);
    if (!published) unlinkSync(temporary);
  }
}
