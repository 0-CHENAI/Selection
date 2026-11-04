import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const rootDir = resolve(import.meta.dir, '..', '..', '..', '..', '..')
const fixturePath = join(import.meta.dir, 'fixtures', 'sample.heic')
const tempDir = mkdtempSync(join(tmpdir(), 'selection-heic-main-bundle-'))
const isolatedDir = join(tempDir, 'without-node-modules')
const bundlePath = join(isolatedDir, 'heic.cjs')

beforeAll(() => {
  mkdirSync(isolatedDir, { recursive: true })
  const build = Bun.spawnSync({
    cmd: [
      'node',
      join(rootDir, 'node_modules', 'esbuild', 'bin', 'esbuild'),
      join(rootDir, 'packages', 'shared', 'src', 'utils', 'heic.ts'),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${bundlePath}`,
    ],
    cwd: rootDir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (build.exitCode !== 0) throw new Error(build.stderr.toString() || 'esbuild failed')
  writeFileSync(join(isolatedDir, 'sample.heic'), readFileSync(fixturePath))
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('packaged HEIC converter', () => {
  it('converts a HEIC in the main-process bundle without node_modules', async () => {
    expect(existsSync(join(isolatedDir, 'node_modules'))).toBe(false)
    const source = readFileSync(bundlePath, 'utf8')
    expect(source).not.toContain('import("heic-convert")')
    expect(source).not.toContain("import('heic-convert')")
    expect(source).toMatch(/libheif|heic-convert/i)

    const result = Bun.spawnSync({
      cmd: [
        'node',
        '-e',
        `
          const { readFileSync } = require('node:fs');
          const { convertHeicToJpeg } = require(${JSON.stringify(bundlePath)});
          convertHeicToJpeg(readFileSync(${JSON.stringify(join(isolatedDir, 'sample.heic'))}))
            .then((jpeg) => {
              if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) {
                throw new Error('converter did not return JPEG');
              }
              console.log(jpeg.length);
            })
            .catch((error) => {
              console.error(error);
              process.exit(1);
            });
        `,
      ],
      cwd: isolatedDir,
      env: { ...process.env, NODE_PATH: '' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString() || 'isolated convert failed')
    expect(Number(result.stdout.toString().trim())).toBeGreaterThan(100)
  })
})
