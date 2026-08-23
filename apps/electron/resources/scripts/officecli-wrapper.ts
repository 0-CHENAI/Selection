#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import {
  docxOutlineEnsureTiming,
  ensureDocxOutlineHeadingStyles,
  findDocxArgInOfficecliArgs,
  findOfficecliMutationVerb,
} from '../../../../packages/shared/src/utils/officecli.ts';
import { inspectOfficecliAttribution, sanitizeOfficecliAttribution } from '../../../../packages/session-tools-core/src/handlers/officecli-metadata.ts';

const binary = process.argv[2] ? resolve(process.argv[2]) : '';
const args = process.argv.slice(3);
if (!binary || !existsSync(binary)) {
  console.error('Selection\'s app-managed OfficeCLI binary is unavailable.');
  process.exit(127);
}

const officeFiles = args.filter(arg =>
  !arg.startsWith('-') && ['.docx', '.docm', '.xlsx', '.xlsm', '.pptx'].includes(extname(arg).toLowerCase())
);
const docx = findDocxArgInOfficecliArgs(args);
const timing = docxOutlineEnsureTiming(args);
const verb = findOfficecliMutationVerb(args);
const officeFile = verb === 'merge' ? officeFiles[1] : officeFiles[0];

if (verb && !officeFile) {
  console.error('Selection could not identify the Office document before mutation.');
  process.exit(2);
}

const ensureStyles = () => {
  if (!docx || !existsSync(docx)) return;
  ensureDocxOutlineHeadingStyles(docx, { binary, trustEnvironment: false });
};

if (timing.before) ensureStyles();
const child = spawnSync(binary, args, { stdio: 'inherit', env: process.env });
if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}
const exitCode = child.status ?? 1;
if (exitCode !== 0) process.exit(exitCode);

if (timing.after) ensureStyles();
if (verb) {
  if (!officeFile || !existsSync(officeFile)) {
    console.error('Selection could not verify the Office document after mutation.');
    process.exit(2);
  }
  if (verb !== 'close') {
    const closed = spawnSync(binary, ['close', officeFile, '--json'], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: process.env,
    });
    if (closed.error) {
      console.error(closed.error.message);
      process.exit(1);
    }
    if ((closed.status ?? 1) !== 0) process.exit(closed.status ?? 1);
  }
  try {
    sanitizeOfficecliAttribution(officeFile);
    if (verb === 'save' || verb === 'close') {
      const attribution = inspectOfficecliAttribution(officeFile);
      if (!attribution.clean) {
        console.error(`Unrequested OfficeCLI generator attribution remains in ${attribution.entries.join(', ')}.`);
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(`Failed to remove OfficeCLI attribution metadata: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
