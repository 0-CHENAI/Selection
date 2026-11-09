import { createHash } from 'crypto';

export function etagForYaml(yaml: string): string {
  return createHash('sha256').update(yaml, 'utf8').digest('hex');
}

export class TaskEtagConflictError extends Error {
  readonly code = 'etag-conflict' as const;
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super('Task file changed on disk; reload or compare before saving');
    this.name = 'TaskEtagConflictError';
  }
}
