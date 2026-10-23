#!/usr/bin/env bun
// Packaged entry is scripts/deck.js (self-contained PptxGenJS). Rebuild after engine changes:
// bun build apps/electron/resources/skills/ppt-design/scripts/deck.ts --outfile apps/electron/resources/skills/ppt-design/scripts/deck.js --target=bun --external sharp
import { run } from '../engine/cli';

if (import.meta.main) {
  run().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(JSON.stringify({ outcome: 'FAILED', error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
