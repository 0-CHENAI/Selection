import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pptRouteMismatch, readPptRoute } from './ppt-route'
import { recordVisualInspection } from './ppt-visual-record'

test('office_edit reminds instead of failing when a later step imports a whole deck', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ppt-route-'))
  try {
    mkdirSync(join(dir, 'data'), { recursive: true })
    writeFileSync(join(dir, 'data', 'design-plan.md'), '路由: office_edit\n范围: 第 3 页的数字\n')
    expect(readPptRoute(dir)).toBe('office_edit')
    const message = pptRouteMismatch(dir, 'Bash', { command: 'bun deck-cli.mjs import ./来稿.pptx --out ./import' })
    expect(message).toContain('路由提醒')
    expect(message).toContain('不是失败')
    expect(pptRouteMismatch(dir, 'Bash', { command: 'bun deck-cli.mjs check ./deck.json' })).toBeUndefined()
    writeFileSync(join(dir, 'data', 'design-plan.md'), '路由: import_rebuild\n')
    expect(pptRouteMismatch(dir, 'ppt_template_create_project', {})).toBeUndefined()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('visual inspection records page hashes and flags the third round', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ppt-visual-'))
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const first = recordVisualInspection(dir, '/tmp/deck.pptx', 'officecli-html', [{ label: '1', bytes: png }])
    expect(first).toEqual({ rounds: 1, atLimit: false })
    recordVisualInspection(dir, '/tmp/deck.pptx', 'officecli-html', [{ label: '1', bytes: png }])
    const third = recordVisualInspection(dir, '/tmp/deck.pptx', 'officecli-html', [{ label: '2', bytes: png }])
    expect(third).toEqual({ rounds: 3, atLimit: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})