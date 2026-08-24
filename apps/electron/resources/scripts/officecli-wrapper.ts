#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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

const child = spawnSync(binary, args, { stdio: 'inherit', env: process.env });
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
