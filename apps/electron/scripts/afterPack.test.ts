import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { pruneForeignPlatformRuntimes } = require('./afterPack.cjs') as {
  pruneForeignPlatformRuntimes: (
    context: { arch: string | number; electronPlatformName: string },
    resourcesRoot: string,
  ) => void
}

describe('afterPack OfficeCLI runtime pruning', () => {
  it('keeps only the target platform runtime in every packaged resource copy', () => {
    const root = mkdtempSync(join(tmpdir(), 'selection-after-pack-'))
    try {
      for (const relativeBin of ['app/resources/bin', 'app/dist/resources/bin']) {
        for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']) {
          const directory = join(root, relativeBin, target)
          mkdirSync(directory, { recursive: true })
          writeFileSync(join(directory, 'officecli'), target)
        }
      }

      pruneForeignPlatformRuntimes({ electronPlatformName: 'darwin', arch: 'arm64' }, root)
      for (const relativeBin of ['app/resources/bin', 'app/dist/resources/bin']) {
        expect(existsSync(join(root, relativeBin, 'darwin-arm64', 'officecli'))).toBe(true)
        expect(existsSync(join(root, relativeBin, 'darwin-x64'))).toBe(false)
        expect(existsSync(join(root, relativeBin, 'win32-x64'))).toBe(false)
        expect(existsSync(join(root, relativeBin, 'linux-x64'))).toBe(false)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails closed for an unreviewed package target', () => {
    expect(() => pruneForeignPlatformRuntimes(
      { electronPlatformName: 'linux', arch: 'arm64' },
      '/definitely-not-a-package',
    )).toThrow('Unsupported packaged OfficeCLI target')
  })
})
