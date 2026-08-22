import { describe, expect, it } from 'bun:test'
import { build, type BuildOptions } from 'esbuild'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '..', '..', '..', '..', '..')

const CJS_ENTRIES: Array<{ name: string; options: BuildOptions }> = [
  {
    name: 'main process',
    options: {
      entryPoints: [join(repoRoot, 'apps/electron/src/main/index.ts')],
      external: ['electron'],
      alias: {
        'node-fetch': join(repoRoot, 'apps/electron/src/main/shims/node-fetch.cjs'),
        'abort-controller': join(repoRoot, 'apps/electron/src/main/shims/abort-controller.cjs'),
      },
    },
  },
  {
    name: 'preload',
    options: {
      entryPoints: [join(repoRoot, 'apps/electron/src/preload/bootstrap.ts')],
      external: ['electron'],
    },
  },
]

describe('Electron CJS import.meta boundary', () => {
  it('does not emit empty-import-meta when bundling the desktop CJS entries', async () => {
    for (const entry of CJS_ENTRIES) {
      const result = await build({
        bundle: true,
        platform: 'node',
        format: 'cjs',
        write: false,
        logLevel: 'silent',
        ...entry.options,
      })

      expect(
        result.warnings.filter(warning => warning.id === 'empty-import-meta'),
        `${entry.name} must not read import.meta in the CJS bundle`,
      ).toEqual([])
    }
  })
})
