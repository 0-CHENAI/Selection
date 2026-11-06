#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { repairDocxOutlineHeadings } from './officecli-heading-repair.ts';

function findDocxArg(args: string[]): string | undefined {
  return args.find(arg => !arg.startsWith('-') && /\.(?:docx|docm)$/i.test(arg));
}

function firstVerb(args: string[]): string | undefined {
  return args.find(arg => !arg.startsWith('-'))?.toLowerCase();
}

const binary = process.argv[2] ? resolve(process.argv[2]) : '';
const args = process.argv.slice(3);
if (!binary || !existsSync(binary)) {
  console.error('Selection does not include bundled OfficeCLI for this platform. Repair or reinstall Selection.');
  process.exit(127);
}

const wordGuide = resolve(dirname(binary), '../../skills/officecli/guides/word-reference.md');
if (args.length === 2 && args[0] === 'load_skill' && args[1] === 'word' && existsSync(wordGuide)) {
  process.stdout.write(readFileSync(wordGuide, 'utf8'));
  process.exit(0);
}

if (process.platform === 'win32' && process.env.SELECTION_WINDOWS_SANDBOX === '1' && firstVerb(args) === 'open') {
  const file = args.slice(1).find(arg => !arg.startsWith('-'));
  console.log(`Direct file mode for ${file ?? 'document'}: the Windows isolated worker disables resident processes. OfficeCLI edits are saved to disk.`);
  process.exit(0);
}

const child = spawnSync(binary, args, {
  stdio: 'inherit',
  env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' },
});
if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}
const exitCode = child.status ?? 1;
if (exitCode !== 0) process.exit(exitCode);

const docx = findDocxArg(args);
if (firstVerb(args) === 'create' && docx) {
  const repaired = repairDocxOutlineHeadings(binary, docx);
  if (!repaired.ok) {
    console.error(repaired.error ?? 'Selection created the Word file, but could not verify Heading 1-3 outline levels.');
    process.exit(1);
  }
}
