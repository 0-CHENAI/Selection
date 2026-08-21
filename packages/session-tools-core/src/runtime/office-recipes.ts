import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { extname } from 'node:path';

export interface OfficeMorphRecipe {
  name: 'clone' | 'ghost' | 'verify' | 'final-check' | 'clean-accumulation';
  implementation: string;
  mutatesDocument: boolean;
  requiresExplicitEditPermission: boolean;
}

export interface MorphRecipeIssue {
  code: 'missing_morph_transition' | 'unghosted_previous_content' | 'duplicate_adjacent_content' | 'ghost_accumulation';
  path?: string;
  message: string;
  blocking: boolean;
}

export interface MorphSlideVerification {
  ok: boolean;
  issues: MorphRecipeIssue[];
}

type MorphNode = Record<string, unknown>;
const MORPH_SCENE_KEYWORDS = [
  'ring', 'dot', 'line', 'circle', 'rect', 'slash', 'accent', 'actor',
  'star', 'triangle', 'diamond',
] as const;

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

/** Build audited native batch objects for the upstream clone recipe. */
export function buildMorphCloneCommands(fromSlide: number, toSlide: number): string[] {
  positiveInteger(fromSlide, 'fromSlide');
  positiveInteger(toSlide, 'toSlide');
  return [
    JSON.stringify({ command: 'add', parent: '/', from: `/slide[${fromSlide}]` }),
    JSON.stringify({ command: 'set', path: `/slide[${toSlide}]`, props: { transition: 'morph' } }),
  ];
}

/** Build one atomic ghost batch instead of launching the upstream helper script. */
export function buildMorphGhostCommands(slide: number, shapeIndexes: number[]): string[] {
  positiveInteger(slide, 'slide');
  if (shapeIndexes.length === 0) throw new Error('shapeIndexes must contain at least one shape.');
  return [...new Set(shapeIndexes.map(index => positiveInteger(index, 'shapeIndex')))]
    .map(index => JSON.stringify({
      command: 'set',
      path: `/slide[${slide}]/shape[${index}]`,
      props: { x: '36cm' },
    }));
}

function childNodes(node: MorphNode): MorphNode[] {
  return Array.isArray(node.children)
    ? node.children.filter((child): child is MorphNode => Boolean(child && typeof child === 'object' && !Array.isArray(child)))
    : [];
}

function walkNodes(root: unknown): MorphNode[] {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return [];
  const nodes: MorphNode[] = [];
  const visit = (node: MorphNode) => {
    nodes.push(node);
    childNodes(node).forEach(visit);
  };
  visit(root as MorphNode);
  return nodes;
}

function nodeFormat(node: MorphNode): MorphNode {
  return node.format && typeof node.format === 'object' && !Array.isArray(node.format)
    ? node.format as MorphNode
    : {};
}

function isMorphTransition(root: unknown): boolean {
  return walkNodes(root).some(node => {
    const format = nodeFormat(node);
    return String(format.transition ?? node.transition ?? '').toLowerCase() === 'morph';
  });
}

function textBoxes(root: unknown): Array<{ path: string; name: string; text: string; x: string; y: string }> {
  return walkNodes(root).flatMap(node => {
    if (node.type !== 'textbox') return [];
    const format = nodeFormat(node);
    const text = typeof node.text === 'string' ? node.text.trim() : '';
    if (text.length < 6) return [];
    const name = typeof format.name === 'string' ? format.name : '';
    const cleanName = name.replace(/!!/g, '').toLowerCase();
    const isPersistentSceneActor = MORPH_SCENE_KEYWORDS.some(keyword => cleanName.includes(keyword));
    const hasSlidePattern = Array.from({ length: 19 }, (_, index) => `s${index + 1}-`)
      .some(pattern => cleanName.includes(pattern));
    if (isPersistentSceneActor && !hasSlidePattern) return [];
    return [{
      path: typeof node.path === 'string' ? node.path : '',
      name,
      text: text.slice(0, 50),
      x: String(format.x ?? ''),
      y: String(format.y ?? ''),
    }];
  });
}

/** Pure TypeScript port of the upstream verify recipe. */
export function verifyMorphSlide(
  current: unknown,
  previous: unknown | undefined,
  previousSlide: number | undefined,
): MorphSlideVerification {
  const issues: MorphRecipeIssue[] = [];
  if (!isMorphTransition(current)) {
    issues.push({
      code: 'missing_morph_transition',
      message: 'Slide is missing transition=morph.',
      blocking: true,
    });
  }
  if (previous && previousSlide) {
    positiveInteger(previousSlide, 'previousSlide');
    for (const node of walkNodes(current)) {
      const format = nodeFormat(node);
      const name = String(format.name ?? '');
      const x = String(format.x ?? '');
      if (name.includes(`#s${previousSlide}-`) && x !== '36cm') {
        issues.push({
          code: 'unghosted_previous_content',
          path: typeof node.path === 'string' ? node.path : undefined,
          message: `${name || 'Previous-slide actor'} must be ghosted to x=36cm.`,
          blocking: true,
        });
      }
    }
    const previousBoxes = textBoxes(previous);
    for (const currentBox of textBoxes(current)) {
      const duplicate = previousBoxes.some(previousBox => (
        previousBox.text === currentBox.text
        && previousBox.x === currentBox.x
        && previousBox.y === currentBox.y
        && currentBox.x !== '36cm'
      ));
      if (duplicate) {
        issues.push({
          code: 'duplicate_adjacent_content',
          path: currentBox.path || undefined,
          message: `Adjacent slides contain identical text at (${currentBox.x}, ${currentBox.y}); verify actor naming and ghosting.`,
          blocking: true,
        });
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

function ghostResults(queryData: unknown): MorphNode[] {
  if (!queryData || typeof queryData !== 'object' || Array.isArray(queryData)) return [];
  const results = (queryData as MorphNode).results;
  return Array.isArray(results)
    ? results.filter((item): item is MorphNode => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : [];
}

export function checkMorphGhostAccumulation(
  queryData: unknown,
  totalSlides: number,
): MorphSlideVerification {
  positiveInteger(totalSlides, 'totalSlides');
  const count = ghostResults(queryData).length;
  const expectedMax = Math.max(50, totalSlides * 4);
  const issues: MorphRecipeIssue[] = count > expectedMax ? [{
    code: 'ghost_accumulation',
    message: `Found ${count} off-canvas ghost shapes; expected at most ${expectedMax}.`,
    blocking: true,
  }] : [];
  return { ok: issues.length === 0, issues };
}

/** Build reviewed remove objects only after query results identify exact paths. */
export function buildMorphCleanAccumulationCommands(queryData: unknown, threshold = 50): string[] {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 500) {
    throw new Error('threshold must be an integer between 0 and 500.');
  }
  return ghostResults(queryData).slice(threshold).flatMap(shape => {
    const path = typeof shape.path === 'string' ? shape.path : '';
    return path.startsWith('/slide[') ? [JSON.stringify({ command: 'remove', path })] : [];
  });
}

/**
 * Host-validated replacements for the upstream Morph shell/Python helpers.
 * These recipes intentionally describe only Selection tool calls; they never
 * produce a command string for a shell.
 */
export const OFFICE_MORPH_RECIPES: readonly OfficeMorphRecipe[] = [
  {
    name: 'clone',
    implementation: 'buildMorphCloneCommands(fromSlide, toSlide) returns validated add/set objects for one atomic office_document_edit batch.',
    mutatesDocument: true,
    requiresExplicitEditPermission: true,
  },
  {
    name: 'ghost',
    implementation: 'buildMorphGhostCommands(slide, shapeIndexes) returns validated x=36cm set objects; never execute morph-helpers.py or morph-helpers.sh.',
    mutatesDocument: true,
    requiresExplicitEditPermission: true,
  },
  {
    name: 'verify',
    implementation: 'verifyMorphSlide(current, previous, previousSlide) analyzes get JSON for transition, unghosted actors, and adjacent duplicate content.',
    mutatesDocument: false,
    requiresExplicitEditPermission: false,
  },
  {
    name: 'final-check',
    implementation: 'verify every slide with verifyMorphSlide, apply checkMorphGhostAccumulation to query shape[x>=34cm], then preview.render and strict finalize.',
    mutatesDocument: false,
    requiresExplicitEditPermission: false,
  },
  {
    name: 'clean-accumulation',
    implementation: 'buildMorphCleanAccumulationCommands(queryData, threshold) accepts exact authorized query paths and returns reviewed remove objects for an explicitly permissioned atomic edit batch.',
    mutatesDocument: true,
    requiresExplicitEditPermission: true,
  },
] as const;

export function validateMorphGlb(path: string, maxBytes = 50 * 1024 * 1024): string | undefined {
  if (extname(path).toLowerCase() !== '.glb') return 'Morph 3D references must use the .glb extension.';
  if (!existsSync(path)) return `GLB file not found: ${path}`;
  const stats = statSync(path);
  if (!stats.isFile()) return `GLB reference is not a file: ${path}`;
  if (stats.size < 12) return 'GLB file is too small to contain a valid header.';
  if (stats.size > maxBytes) return `GLB file exceeds the ${maxBytes}-byte safety limit.`;
  const header = Buffer.alloc(12);
  const fd = openSync(path, 'r');
  try {
    if (readSync(fd, header, 0, header.length, 0) !== header.length) {
      return 'GLB header could not be read completely.';
    }
  } finally {
    closeSync(fd);
  }
  if (header.subarray(0, 4).toString('ascii') !== 'glTF') {
    return 'GLB header is invalid (expected glTF magic bytes).';
  }
  if (header.readUInt32LE(4) !== 2) return 'GLB version is unsupported (expected version 2).';
  if (header.readUInt32LE(8) !== stats.size) {
    return `GLB declared length does not match the file size (${header.readUInt32LE(8)} != ${stats.size}).`;
  }
  return undefined;
}
