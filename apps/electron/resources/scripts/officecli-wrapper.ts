#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import {
  docxOutlineEnsureTiming,
  ensureDocxOutlineHeadingStyles,
  findDocxArgInOfficecliArgs,
} from '../../../../packages/shared/src/utils/officecli.ts';
import { inspectOfficecliAttribution, sanitizeOfficecliMetadata } from '../../../../packages/session-tools-core/src/handlers/officecli-metadata.ts';

const binary = process.argv[2] ? resolve(process.argv[2]) : '';
const args = process.argv.slice(3);
if (!binary || !existsSync(binary)) {
  console.error('Selection\'s app-managed OfficeCLI binary is unavailable.');
  process.exit(127);
}

const officeFile = args.find(arg =>
  !arg.startsWith('-') && ['.docx', '.docm', '.xlsx', '.xlsm', '.pptx'].includes(extname(arg).toLowerCase())
);
const docx = findDocxArgInOfficecliArgs(args);
const timing = docxOutlineEnsureTiming(args);
const verb = args.find(arg => /^(?:create|batch|save|close|add|set|remove|move|swap)$/i.test(arg))?.toLowerCase();

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
if (verb && officeFile && existsSync(officeFile)) {
  try {
    sanitizeOfficecliMetadata(officeFile);
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
