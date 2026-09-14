import { expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateCopiedAssets } from './validate-assets'

it('rejects missing and stale copied assets, and accepts identical content', () => {
  const root = mkdtempSync(join(tmpdir(), 'selection-assets-'))
  try {
    const source = join(root, 'source'), target = join(root, 'target')
    mkdirSync(source); mkdirSync(target)
    writeFileSync(join(source, 'guide.md'), 'current')
    expect(validateCopiedAssets(source, target)[0]).toContain('Missing or invalid')
    writeFileSync(join(target, 'guide.md'), 'old')
    expect(validateCopiedAssets(source, target)[0]).toContain('Stale')
    writeFileSync(join(target, 'guide.md'), 'current')
    expect(validateCopiedAssets(source, target)).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('rejects missing empty directories and directory symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'selection-assets-'))
  try {
    const source = join(root, 'source'), target = join(root, 'target')
    mkdirSync(source)
    expect(validateCopiedAssets(source, target)[0]).toContain('Missing or invalid copied directory')
    symlinkSync(source, target)
    expect(validateCopiedAssets(source, target)[0]).toContain('Missing or invalid copied directory')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
