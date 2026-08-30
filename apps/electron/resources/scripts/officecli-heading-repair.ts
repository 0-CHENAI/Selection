#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type HeadingSpec = {
  id: 'Heading1' | 'Heading2' | 'Heading3';
  outlineLvl: 0 | 1 | 2;
  size: string;
};

const HEADING_SPECS: HeadingSpec[] = [
  { id: 'Heading1', outlineLvl: 0, size: '18pt' },
  { id: 'Heading2', outlineLvl: 1, size: '14pt' },
  { id: 'Heading3', outlineLvl: 2, size: '12pt' },
];

const SUPPORTING_STYLES = [
  { id: 'Title', size: '24pt' },
  { id: 'TOCHeading', size: '16pt' },
] as const;

type CommandResult = {
  ok: boolean;
  output: string;
};

type BatchOperation = {
  command: 'add' | 'set';
  parent?: string;
  path?: string;
  type?: string;
  props: Record<string, string>;
};

export type HeadingRepairResult = {
  ok: boolean;
  error?: string;
};

function runOfficecli(binary: string, args: string[]): CommandResult {
  // Do not disable OfficeCLI's resident mode here. The create command may have
  // a live in-memory document, and bypassing it can make a later flush undo the
  // compatibility repair.
  const child = spawnSync(binary, args, {
    encoding: 'utf8',
    env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' },
  });
  const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
  const incomplete = /\b(?:WARNING|UNSUPPORTED)\b/i.test(output);
  return {
    ok: !child.error && (child.status ?? 1) === 0 && !incomplete,
    output: child.error ? `${output}${child.error.message}` : output,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function styleBlock(listing: string, id: string): string {
  const lines = listing.split(/\r?\n/);
  const marker = new RegExp(`\\bstyleId=${escapeRegExp(id)}\\b`);
  const start = lines.findIndex(line => marker.test(line));
  if (start < 0) return '';
  let end = start + 1;
  while (end < lines.length && !/\bstyleId=/.test(lines[end]!)) end += 1;
  return lines.slice(start, end).join('\n');
}

export function styleHasOutlineLevel(listing: string, id: string, level: number): boolean {
  return new RegExp(`\\boutlineLvl=${level}\\b`).test(styleBlock(listing, id));
}

export function styleHasAnyOutlineLevel(listing: string, id: string): boolean {
  return /\boutlineLvl=\d+\b/.test(styleBlock(listing, id));
}

export function listingHasRequiredOutlineHeadings(listing: string): boolean {
  return HEADING_SPECS.every(spec => styleHasOutlineLevel(listing, spec.id, spec.outlineLvl));
}

function listingHasStyle(listing: string, id: string): boolean {
  return styleBlock(listing, id).length > 0;
}

function addStyleOperation(id: string, size: string, outlineLvl?: number): BatchOperation {
  return {
    command: 'add',
    parent: '/styles',
    type: 'style',
    props: {
      id,
      type: 'paragraph',
      name: id,
      ...(outlineLvl === undefined ? {} : { outlineLvl: String(outlineLvl) }),
      size,
      bold: 'true',
    },
  };
}

/**
 * Add only missing Heading 1-3 outline levels after Word creation.
 * Existing style formatting is preserved. A conflicting custom outline level
 * is reported instead of silently rewritten.
 */
export function repairDocxOutlineHeadings(binaryPath: string, filePath: string): HeadingRepairResult {
  const binary = resolve(binaryPath);
  const file = resolve(filePath);
  if (!existsSync(binary)) return { ok: false, error: 'Bundled OfficeCLI binary is missing.' };
  if (!existsSync(file) || !/\.(?:docx|docm)$/i.test(file)) {
    return { ok: false, error: 'Created Word file is missing or is not OOXML.' };
  }

  const initial = runOfficecli(binary, ['get', file, '/styles', '--depth', '2']);
  if (!initial.ok) return { ok: false, error: `Could not inspect Word styles: ${initial.output}` };
  if (listingHasRequiredOutlineHeadings(initial.output)) return { ok: true };

  // The compatibility layer is allowed to fill a missing outlineLvl, not to
  // replace an existing custom value. Preflight before making any changes.
  for (const spec of HEADING_SPECS) {
    if (
      listingHasStyle(initial.output, spec.id)
      && styleHasAnyOutlineLevel(initial.output, spec.id)
      && !styleHasOutlineLevel(initial.output, spec.id, spec.outlineLvl)
    ) {
      return {
        ok: false,
        error: `${spec.id} already has a custom outlineLvl; Selection left it unchanged.`,
      };
    }
  }

  const operations: BatchOperation[] = [];
  for (const spec of HEADING_SPECS) {
    if (styleHasOutlineLevel(initial.output, spec.id, spec.outlineLvl)) continue;
    operations.push(listingHasStyle(initial.output, spec.id)
      ? {
          command: 'set',
          path: `/styles/${spec.id}`,
          props: { outlineLvl: String(spec.outlineLvl) },
        }
      : addStyleOperation(spec.id, spec.size, spec.outlineLvl));
  }

  for (const spec of SUPPORTING_STYLES) {
    if (listingHasStyle(initial.output, spec.id)) continue;
    operations.push(addStyleOperation(spec.id, spec.size));
  }

  if (operations.length > 0) {
    const repaired = runOfficecli(binary, [
      'batch', file, '--commands', JSON.stringify(operations), '--stop-on-error',
    ]);
    if (!repaired.ok) return { ok: false, error: `Atomic Heading repair failed: ${repaired.output}` };
  }

  const verified = runOfficecli(binary, ['get', file, '/styles', '--depth', '2']);
  if (!verified.ok || !listingHasRequiredOutlineHeadings(verified.output)) {
    return { ok: false, error: `Heading outline verification failed: ${verified.output}` };
  }
  return { ok: true };
}

if (import.meta.main) {
  const [binary, file] = process.argv.slice(2);
  if (!binary || !file) {
    console.error('Usage: officecli-heading-repair <bundled-officecli> <file.docx>');
    process.exit(2);
  }
  const result = repairDocxOutlineHeadings(binary, file);
  if (!result.ok) {
    console.error(result.error ?? 'Word Heading repair failed.');
    process.exit(1);
  }
}
