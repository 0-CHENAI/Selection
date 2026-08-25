#!/usr/bin/env bun

import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const child = Bun.spawn([
  process.execPath,
  'test',
  'packages/shared/src/utils/__tests__/officecli-bundled.integration.test.ts',
  'packages/shared/src/utils/__tests__/officecli.test.ts',
  'packages/shared/src/agent/__tests__/base-agent.test.ts',
  'packages/shared/src/skills/__tests__/storage.test.ts',
  'packages/session-tools-core/src/tool-defs-filtering.test.ts',
], {
  cwd: repoRoot,
  env: {
    ...process.env,
    OFFICECLI_INTEGRATION: '1',
    OFFICECLI_SKIP_UPDATE: '1',
  },
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});

process.exitCode = await child.exited;
