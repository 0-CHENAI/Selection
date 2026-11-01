import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { resolveOfficecliBinary } from '../../../../../../packages/shared/src/utils/officecli.ts'
import { fixtureTheme, makeDeck, makePage } from '../styles/kit.ts'
import { exportDeck } from './export-pptx.ts'
import type { DeckElement } from './types.ts'

// DrawingML ST_PathFillMode. A fill rule is not one of them.
const PATH_FILL_MODES = new Set(['none', 'norm', 'lighten', 'lightenLess', 'darken', 'darkenLess'])

describe('shape XML stays schema-valid', () => {
  it('writes holes as subpaths of one path, with no invalid fill attribute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'path-rule-'))
    try {
      const ring: DeckElement = {
        id: 'ring',
        type: 'shape',
        bounds: { x: 100, y: 100, w: 40, h: 40 },
        shape: 'path',
        fill: '$accent',
        path: 'M 0 0 L 40 0 L 40 40 L 0 40 Z M 10 10 L 30 10 L 30 30 L 10 30 Z',
        pathRule: 'evenodd',
      }
      const out = join(dir, 'ring.pptx')
      await exportDeck(makeDeck('ring', fixtureTheme, [makePage('p1', 'free', 'p1', '$paper', [ring], '')]), out, { enforceCheck: false, platform: 'linux' })
      const slide = Buffer.from(unzipSync(readFileSync(out))['ppt/slides/slide1.xml']!).toString('utf8')
      const block = slide.slice(slide.indexOf('name="ring"'))
      const geometry = block.slice(0, block.indexOf('</a:custGeom>'))
      expect(geometry.match(/<a:path\b/g)?.length).toBe(1)
      expect(geometry.match(/<a:moveTo>/g)?.length).toBe(2)
      for (const [, mode] of slide.matchAll(/<a:path\b[^>]*\bfill="([^"]*)"/g)) expect(PATH_FILL_MODES.has(mode!)).toBe(true)
      expect(slide).not.toContain('evenOdd')
      const binary = resolveOfficecliBinary()
      if (!binary) return
      const proc = Bun.spawn([binary, 'validate', out], { env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1', OFFICECLI_NO_AUTO_RESIDENT: '1' }, stdout: 'pipe', stderr: 'pipe' })
      const [report] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
      expect(report).toContain('no errors')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the outline ahead of the shadow when a gradient replaces the fill', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gradient-shadow-'))
    try {
      const gem: DeckElement = {
        id: 'gem',
        type: 'shape',
        bounds: { x: 100, y: 100, w: 120, h: 60 },
        shape: 'path',
        path: 'M 60 0 L 120 15 L 120 45 L 60 60 L 0 45 L 0 15 Z',
        fill: '#C4B5FD',
        gradient: { kind: 'linear', angle: 23, stops: [{ offset: 0, color: '#C4B5FD' }, { offset: 1, color: '#8B5CF6' }] },
        shadow: { color: '#A78BFA', opacity: 0.45, blur: 12, offset: 0.5, angle: 0 },
      }
      const out = join(dir, 'gem.pptx')
      await exportDeck(makeDeck('gem', fixtureTheme, [makePage('p1', 'free', 'p1', '$paper', [gem], '')]), out, { enforceCheck: false, platform: 'linux' })
      const slide = Buffer.from(unzipSync(readFileSync(out))['ppt/slides/slide1.xml']!).toString('utf8')
      const properties = slide.slice(slide.indexOf('name="gem"')).match(/<p:spPr>[\s\S]*?<\/p:spPr>/)![0]
      expect(properties).toContain('<a:gradFill')
      expect(properties).toContain('<a:effectLst>')
      if (properties.includes('<a:ln')) expect(properties.indexOf('<a:ln')).toBeLessThan(properties.indexOf('<a:effectLst>'))
      const binary = resolveOfficecliBinary()
      if (!binary) return
      const proc = Bun.spawn([binary, 'validate', out], { env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1', OFFICECLI_NO_AUTO_RESIDENT: '1' }, stdout: 'pipe', stderr: 'pipe' })
      const [report] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
      expect(report).toContain('no errors')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
