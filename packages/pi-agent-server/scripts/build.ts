import { dirname, join, resolve } from 'node:path'
import { copyPiAgentServerRuntimeAssets } from './copy-runtime-assets'

const packageDir = resolve(import.meta.dir, '..')
const sdkUtils = join(dirname(Bun.resolveSync('@earendil-works/pi-coding-agent', packageDir)), 'utils')
const outdir = join(packageDir, 'dist')
const photonRuntime = join(packageDir, 'src/tools/read/photon-runtime.ts')

// Pi addresses its prompt-image worker relative to the bundled index.js.
// Read uses a different worker protocol. Ship both next to the same Photon WASM.
const result = await Bun.build({
  entrypoints: [
    join(packageDir, 'src/index.ts'),
    join(packageDir, 'src/tools/read/read-image-resize-worker.ts'),
    join(sdkUtils, 'image-resize-worker.js'),
  ],
  outdir,
  naming: '[name].[ext]',
  target: 'bun',
  format: 'esm',
  external: ['koffi'],
  plugins: [{
    name: 'packaged-pi-photon',
    setup(build) {
      build.onResolve({ filter: /^\.\/photon\.js$/ }, args =>
        dirname(args.importer) === sdkUtils ? { path: photonRuntime } : undefined)
    },
  }],
})
if (!result.success) throw new AggregateError(result.logs, 'Pi agent server build failed')
copyPiAgentServerRuntimeAssets(resolve(packageDir, '../..'), outdir)
