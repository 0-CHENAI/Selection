export const OFFICE_STANDARD_TASK_SEQUENCE = [
  'skill-bootstrap',
  'create',
  'incremental-edit',
  'inspect-outline',
  'qa-issues',
  'finalize',
] as const;

export const OFFICE_STANDARD_TASK_HINT = Object.freeze({
  skipStatusAndHelp: false,
  reuse: Object.freeze(['cwd', 'documentPath'] as const),
  sequence: OFFICE_STANDARD_TASK_SEQUENCE,
});

export function countDuplicateStatusHelp(argvList: Array<readonly string[]>): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const argv of argvList) {
    const verb = argv[0];
    if (verb !== 'status' && verb !== 'help') continue;
    const key = JSON.stringify(argv);
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}
