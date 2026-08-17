import { describe, expect, it } from 'bun:test';
import { build } from 'esbuild';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..', '..', '..', '..', '..');

describe('bootstrap preload bundle boundary', () => {
  it('does not pull the Claude SDK through shared utility exports', async () => {
    const result = await build({
      entryPoints: [join(repoRoot, 'apps/electron/src/preload/bootstrap.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      write: false,
      metafile: true,
      logLevel: 'silent',
    });

    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.some(path => path.includes('@anthropic-ai/claude-agent-sdk'))).toBe(false);
    expect(inputs.some(path => path.endsWith('packages/session-tools-core/src/index.ts'))).toBe(false);
    expect(inputs.some(path => path.endsWith('packages/session-tools-core/src/runtime/officecli.ts'))).toBe(true);
  });
});
