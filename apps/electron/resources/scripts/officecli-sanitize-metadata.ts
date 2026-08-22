#!/usr/bin/env bun
import { extname, resolve } from 'node:path';
import { inspectOfficecliAttribution, sanitizeOfficecliMetadata } from '../../../../packages/session-tools-core/src/handlers/officecli-metadata.ts';

const file = process.argv[2] ? resolve(process.argv[2]) : '';
const inspectVisible = process.argv.includes('--inspect-visible');
const allowed = new Set(['.docx', '.docm', '.xlsx', '.xlsm', '.pptx']);
if (!file || !allowed.has(extname(file).toLowerCase())) {
  console.error('Usage: officecli-sanitize-metadata <office-file>');
  process.exit(2);
}

try {
  // Shell fallback is deliberately fail-closed. Explicit attribution is
  // preserved only by typed tools whose policy comes from trusted turn state.
  sanitizeOfficecliMetadata(file);
  if (inspectVisible) {
    const attribution = inspectOfficecliAttribution(file);
    if (!attribution.clean) {
      console.error(`Unrequested OfficeCLI generator attribution remains in ${attribution.entries.join(', ')}.`);
      process.exit(1);
    }
  }
} catch (error) {
  console.error(`Failed to remove OfficeCLI attribution metadata: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
