import { z } from 'zod';

const OfficecliPropsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number().finite(), z.boolean()]),
);

export const OfficecliOperationSchema = z.object({
  command: z.enum(['add', 'set', 'remove', 'move', 'swap', 'get', 'query']),
  parent: z.string().optional().describe('Required for add; semantic parent path such as /body.'),
  path: z.string().optional().describe('Required for set, remove, move, swap, and get. Do not use parent for set.'),
  selector: z.string().optional().describe('Required for query.'),
  type: z.string().optional().describe('Required for add; OfficeCLI element type such as paragraph, table, toc, or footer.'),
  props: OfficecliPropsSchema.optional(),
  to: z.string().optional().describe('Destination path for move.'),
  before: z.string().optional().describe('Sibling path before which a move inserts.'),
  after: z.string().optional().describe('Sibling path after which a move inserts.'),
  path2: z.string().optional().describe('Required second path for swap.'),
}).strict().superRefine((operation, ctx) => {
  const allowedFields: Record<typeof operation.command, ReadonlySet<string>> = {
    add: new Set(['parent', 'type', 'props']),
    set: new Set(['path', 'props']),
    remove: new Set(['path']),
    move: new Set(['path', 'to', 'before', 'after']),
    swap: new Set(['path', 'path2']),
    get: new Set(['path']),
    query: new Set(['selector']),
  };
  for (const field of ['parent', 'path', 'selector', 'type', 'props', 'to', 'before', 'after', 'path2'] as const) {
    if (operation[field] !== undefined && !allowedFields[operation.command].has(field)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `'${operation.command}' does not accept ${field}.`,
      });
    }
  }
  const required = (field: keyof typeof operation, message: string) => {
    if (typeof operation[field] !== 'string' || !(operation[field] as string).trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
    }
  };
  switch (operation.command) {
    case 'add':
      required('parent', "'add' requires parent.");
      required('type', "'add' requires type.");
      break;
    case 'set':
    case 'remove':
    case 'get':
      required('path', `'${operation.command}' requires path.`);
      break;
    case 'move':
      required('path', "'move' requires path.");
      if ([operation.to, operation.before, operation.after]
        .filter(value => typeof value === 'string' && value.trim()).length !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: "'move' requires exactly one of to, before, or after." });
      }
      break;
    case 'swap':
      required('path', "'swap' requires path.");
      required('path2', "'swap' requires path2.");
      break;
    case 'query':
      required('selector', "'query' requires selector.");
      break;
  }
});

export const OfficecliBatchSchema = z.object({
  file: z.string().min(1).describe('Office document path, relative to the session working directory or absolute within it'),
  operations: z.array(OfficecliOperationSchema).min(1).max(50)
    .describe('Atomic OfficeCLI operations. Use 20–50 operations for long runs of content.'),
}).strict();

export const OfficecliQaSchema = z.object({
  file: z.string().min(1).describe('Word document path, relative to the session working directory or absolute within it'),
  mode: z.enum(['balanced', 'strict']).optional()
    .describe('balanced is the default. strict is for print-ready or explicitly requested detailed review.'),
}).strict();

export const OfficecliFinalizeSchema = z.object({
  file: z.string().min(1).describe('Office document path, relative to the session working directory or absolute within it'),
}).strict();
