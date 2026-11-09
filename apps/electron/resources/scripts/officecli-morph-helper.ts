#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type JsonRecord = Record<string, unknown>;

const binary = process.argv[2] ? resolve(process.argv[2]) : '';
const [command, deck, ...rest] = process.argv.slice(3);

function usage(): never {
  console.error([
    'Usage: officecli-morph-helper <command> <deck.pptx> [arguments]',
    '  clone <deck> <from-slide> <to-slide>',
    '  ghost <deck> <slide> <shape-index> [shape-index ...]',
    '  verify <deck> <slide>',
    '  final-check <deck>',
    '  clean-accumulation <deck> [keep-count]',
  ].join('\n'));
  process.exit(2);
}

if (!binary || !existsSync(binary)) {
  console.error('Selection does not include bundled OfficeCLI for this platform. Repair or reinstall Selection.');
  process.exit(127);
}
if (!command || !deck || command === '--help' || command === 'help') usage();

function run(args: string[]): string {
  const child = spawnSync(binary, args, { encoding: 'utf8', env: process.env });
  if (child.error) throw child.error;
  const stdout = child.stdout ?? '';
  const stderr = child.stderr ?? '';
  if ((child.status ?? 1) !== 0) {
    throw new Error(`officecli ${args.join(' ')} failed (${child.status ?? 1}): ${stderr || stdout}`);
  }
  if (/\b(?:WARNING|UNSUPPORTED)\b/i.test(`${stdout}\n${stderr}`)) {
    throw new Error(`officecli ${args.join(' ')} returned an incomplete result: ${stderr || stdout}`);
  }
  return stdout;
}

function positiveInteger(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function parseData(value: string): JsonRecord {
  const envelope = JSON.parse(value) as JsonRecord;
  const data = envelope.data;
  return data && typeof data === 'object' ? data as JsonRecord : envelope;
}

function childrenOf(node: JsonRecord): JsonRecord[] {
  return Array.isArray(node.children)
    ? node.children.filter(child => child && typeof child === 'object') as JsonRecord[]
    : [];
}

function walk(node: JsonRecord, visit: (child: JsonRecord) => void): void {
  for (const child of childrenOf(node)) {
    visit(child);
    walk(child, visit);
  }
}

function formatOf(node: JsonRecord): JsonRecord {
  return node.format && typeof node.format === 'object' ? node.format as JsonRecord : {};
}

function hasMorphTransition(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if ((node as JsonRecord).transition === 'morph') return true;
  return Object.values(node as JsonRecord).some(hasMorphTransition);
}

function slideData(slide: number): JsonRecord {
  return parseData(run(['get', deck, `/slide[${slide}]`, '--json']));
}

function verifySlide(slide: number): boolean {
  const current = slideData(slide);
  const issues: string[] = [];
  if (!hasMorphTransition(current)) issues.push('missing transition=morph');

  if (slide > 1) {
    walk(current, child => {
      const format = formatOf(child);
      const name = String(format.name ?? '');
      if (name.includes(`#s${slide - 1}-`) && String(format.x ?? '') !== '36cm') {
        issues.push(`${String(child.path ?? 'shape')}: previous-slide content is not ghosted`);
      }
    });

    const previous = slideData(slide - 1);
    const signature = (root: JsonRecord): Set<string> => {
      const values = new Set<string>();
      walk(root, child => {
        if (child.type !== 'textbox') return;
        const format = formatOf(child);
        const text = String(child.text ?? '').trim();
        const x = String(format.x ?? '');
        const y = String(format.y ?? '');
        const name = String(format.name ?? '').replace(/^!!/, '');
        const scene = ['ring', 'dot', 'line', 'circle', 'rect', 'slash', 'accent', 'actor', 'star', 'triangle', 'diamond']
          .some(keyword => name.toLowerCase().includes(keyword));
        if (text.length >= 6 && x !== '36cm' && (!scene || /s\d+-/.test(name))) values.add(`${text}\0${x}\0${y}`);
      });
      return values;
    };
    const previousSignatures = signature(previous);
    for (const value of signature(current)) {
      if (previousSignatures.has(value)) issues.push('duplicate visible text remains at the same position across adjacent slides');
    }
  }

  if (issues.length > 0) {
    console.error(`Slide ${slide} verification failed:\n- ${[...new Set(issues)].join('\n- ')}`);
    return false;
  }
  console.log(`Slide ${slide} verification passed`);
  return true;
}

function queryResults(selector: string): JsonRecord[] {
  const data = parseData(run(['query', deck, selector, '--json']));
  return Array.isArray(data.results)
    ? data.results.filter(item => item && typeof item === 'object') as JsonRecord[]
    : [];
}

try {
  switch (command) {
    case 'clone': {
      const from = positiveInteger(rest[0], 'from-slide');
      const to = positiveInteger(rest[1], 'to-slide');
      run(['add', deck, '/', '--from', `/slide[${from}]`]);
      run(['set', deck, `/slide[${to}]`, '--prop', 'transition=morph']);
      process.stdout.write(run(['get', deck, `/slide[${to}]`, '--depth', '1']));
      if (!hasMorphTransition(slideData(to))) throw new Error(`transition=morph was not persisted on slide ${to}`);
      break;
    }
    case 'ghost': {
      const slide = positiveInteger(rest[0], 'slide');
      if (rest.length < 2) throw new Error('ghost requires at least one shape index');
      for (const value of rest.slice(1)) {
        const shape = positiveInteger(value, 'shape-index');
        run(['set', deck, `/slide[${slide}]/shape[${shape}]`, '--prop', 'x=36cm']);
      }
      break;
    }
    case 'verify': {
      if (!verifySlide(positiveInteger(rest[0], 'slide'))) process.exitCode = 1;
      break;
    }
    case 'final-check': {
      const slides = queryResults('slide').length;
      if (slides === 0) throw new Error('no slides found in deck');
      const ghosts = queryResults('shape[x>=34cm]').length;
      const maximum = Math.max(50, slides * 4);
      if (ghosts > maximum) throw new Error(`ghost accumulation: ${ghosts} shapes found, expected at most ${maximum}`);
      let passed = true;
      for (let slide = 2; slide <= slides; slide += 1) passed = verifySlide(slide) && passed;
      if (!passed) process.exitCode = 1;
      break;
    }
    case 'clean-accumulation': {
      const keep = rest[0] === undefined ? 50 : positiveInteger(rest[0], 'keep-count');
      const ghosts = queryResults('shape[x>=34cm]');
      for (const shape of ghosts.slice(keep)) {
        const path = typeof shape.path === 'string' ? shape.path : undefined;
        const id = formatOf(shape).id;
        if (path) run(['remove', deck, path]);
        else if (id !== undefined) run(['remove', deck, `/shape[@id=${String(id)}]`]);
        else throw new Error('cannot remove a ghost shape without a path or id');
      }
      console.log(`Removed ${Math.max(0, ghosts.length - keep)} accumulated ghost shapes`);
      break;
    }
    default:
      usage();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
