import { afterEach, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWorkbenchWrite } from './atomic.ts';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function root() { const path = mkdtempSync(join(tmpdir(), 'workbench-atomic-')); roots.push(path); return path; }

it('does not follow the predictable temporary-file symlink', () => {
  const directory = root();
  const victim = join(directory, 'unrelated');
  const document = join(directory, 'document.json');
  writeFileSync(victim, 'untouched');
  symlinkSync(victim, document + '.tmp');
  atomicWorkbenchWrite(document, '保存的文档');
  expect(readFileSync(victim, 'utf8')).toBe('untouched');
  expect(readFileSync(document, 'utf8')).toBe('保存的文档');
  expect(readdirSync(directory).sort()).toEqual(['document.json', 'document.json.tmp', 'unrelated']);
});

it('cleans its own staging file when publishing fails', () => {
  const directory = root();
  const destination = join(directory, 'occupied');
  mkdirSync(destination);
  expect(() => atomicWorkbenchWrite(destination, 'not published')).toThrow();
  expect(readdirSync(directory)).toEqual(['occupied']);
});
