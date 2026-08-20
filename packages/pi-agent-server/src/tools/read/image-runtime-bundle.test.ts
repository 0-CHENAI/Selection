import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const rootDir = resolve(import.meta.dir, '..', '..', '..', '..', '..')
const tempDir = mkdtempSync(join(tmpdir(), 'selection-image-runtime-bundle-'))
const completeRuntimeDir = join(tempDir, 'complete-runtime')
const withoutWorkerDir = join(tempDir, 'without-worker')
const withoutWasmDir = join(tempDir, 'without-wasm')
const imagePath = join(tempDir, 'large.png')

beforeAll(async () => {
  for (const dir of [completeRuntimeDir, withoutWorkerDir, withoutWasmDir]) {
    mkdirSync(dir, { recursive: true })
  }

  const photon = await import('@silvia-odwyer/photon-node')
  const pixels = new Uint8Array(2700 * 4)
  pixels.fill(255)
  const image = new photon.PhotonImage(pixels, 2700, 1)
  try {
    writeFileSync(imagePath, image.get_bytes())
  } finally {
    image.free()
  }

  const processorBundlePath = join(tempDir, 'image-processing.js')
  const workerBundlePath = join(tempDir, 'image-resize-worker.js')
  const processorBuild = Bun.spawnSync({
    cmd: [
      process.execPath,
      'build',
      join(rootDir, 'packages', 'pi-agent-server', 'src', 'tools', 'read', 'image-processing.ts'),
      '--outfile',
      processorBundlePath,
      '--target=bun',
      '--format=esm',
    ],
    cwd: rootDir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (processorBuild.exitCode !== 0) throw new Error(processorBuild.stderr.toString())
  const workerBuild = Bun.spawnSync({
    cmd: [
      process.execPath,
      'build',
      join(rootDir, 'packages', 'pi-agent-server', 'src', 'tools', 'read', 'image-resize-worker.ts'),
      '--outfile',
      workerBundlePath,
      '--target=bun',
      '--format=esm',
    ],
    cwd: rootDir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (workerBuild.exitCode !== 0) throw new Error(workerBuild.stderr.toString())

  const photonSourceDir = join(rootDir, 'node_modules', '@silvia-odwyer', 'photon-node')
  const isolateBundle = (bundlePath: string): string => {
    const bundle = readFileSync(bundlePath, 'utf8')
    const isolated = bundle.split(photonSourceDir).join('/missing-build-machine/photon-node')
    if (isolated === bundle) throw new Error(`Photon source path was not embedded in ${bundlePath}`)
    return isolated
  }
  const isolatedProcessor = isolateBundle(processorBundlePath)
  const isolatedWorker = isolateBundle(workerBundlePath)

  for (const dir of [completeRuntimeDir, withoutWorkerDir, withoutWasmDir]) {
    writeFileSync(join(dir, 'image-processing.js'), isolatedProcessor)
  }
  for (const dir of [completeRuntimeDir, withoutWasmDir]) {
    writeFileSync(join(dir, 'image-resize-worker.js'), isolatedWorker)
  }
  for (const dir of [completeRuntimeDir, withoutWorkerDir]) {
    copyFileSync(
      join(photonSourceDir, 'photon_rs_bg.wasm'),
      join(dir, 'photon_rs_bg.wasm'),
    )
  }
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function runBundledProcessor(bundlePath: string) {
  const script = `
    const bytes = new Uint8Array(await Bun.file(process.env.IMAGE_PATH).arrayBuffer());
    const { processReadImage } = await import(process.env.BUNDLE_PATH);
    console.log(JSON.stringify(await processReadImage(bytes, 'image/png')));
  `
  const result = Bun.spawnSync({
    cmd: [process.execPath, '-e', script],
    cwd: tempDir,
    env: {
      ...process.env,
      BUNDLE_PATH: bundlePath,
      IMAGE_PATH: imagePath,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return JSON.parse(result.stdout.toString()) as {
    ok: boolean
    code?: string
    message?: string
    hints?: string[]
  }
}

describe('bundled Pi image runtime', () => {
  it('uses the adjacent Worker and Photon WASM in a build-machine-independent bundle', () => {
    const success = runBundledProcessor(join(completeRuntimeDir, 'image-processing.js'))
    expect(success.ok).toBe(true)
    expect(success.hints?.join('\n')).toContain('displayed at 2560x1')
  })

  it('falls back in-process when the Worker is unavailable', () => {
    const fallback = runBundledProcessor(join(withoutWorkerDir, 'image-processing.js'))
    expect(fallback.ok).toBe(true)
    expect(fallback.hints?.join('\n')).toContain('displayed at 2560x1')
  })

  it('reports a missing adjacent Photon WASM explicitly', () => {
    const missingRuntime = runBundledProcessor(join(withoutWasmDir, 'image-processing.js'))
    expect(missingRuntime.ok).toBe(false)
    expect(missingRuntime.code).toBe('image_runtime_unavailable')
    expect(missingRuntime.message).toContain('photon_rs_bg.wasm')
  })
})
