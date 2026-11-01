import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import JSZip from 'jszip'
import { argumentTheme } from './argument-layouts.ts'
import { checkDeck } from './check.ts'
import { effectiveCrop, exportDeck } from './export-pptx.ts'
import { DECK_FORMAT, DECK_VERSION, type Deck, type DeckElement } from './types.ts'

/** 最小合法 PNG，只为让导出读到宽高。 */
function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const rows = Buffer.alloc((width * 3 + 1) * height, 0x80)
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function image(id: string, src: string, bounds: DeckElement['bounds'], extra: Partial<DeckElement> = {}): DeckElement {
  return { id, type: 'image', role: 'content', bounds, src, fit: 'fill', ...extra }
}

function deckOf(elements: DeckElement[]): Deck {
  return {
    format: DECK_FORMAT,
    version: DECK_VERSION,
    title: '用户图片',
    canvas: { width: 960, height: 540 },
    theme: argumentTheme,
    pages: [{ id: 'p1', elements: [{ id: 't', type: 'text', role: 'title', bounds: { x: 40, y: 30, w: 600, h: 40 }, text: '用户图片放进图片槽' }, ...elements] }],
  }
}

describe('用户图片放进模板图片槽', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ppt-user-images-'))
  const wide = join(dir, 'wide.png')
  const tall = join(dir, 'tall.png')
  writeFileSync(wide, png(160, 120))
  writeFileSync(tall, png(90, 135))

  it('fill 按中心裁满图框，不拉伸', () => {
    const landscape = effectiveCrop(image('a', wide, { x: 0, y: 0, w: 400, h: 200 }))!
    expect(landscape.l).toBe(0)
    expect(landscape.r).toBe(0)
    expect(landscape.t).toBeCloseTo(1 / 6, 5)
    expect(landscape.b).toBeCloseTo(1 / 6, 5)
    const portrait = effectiveCrop(image('b', tall, { x: 0, y: 0, w: 300, h: 300 }))!
    expect(portrait.l).toBe(0)
    expect(portrait.t).toBeCloseTo(1 / 6, 5)
    expect(effectiveCrop(image('c', wide, { x: 0, y: 0, w: 400, h: 300 }))).toBeUndefined()
    expect(effectiveCrop(image('d', wide, { x: 0, y: 0, w: 400, h: 200 }, { fit: 'contain' }))).toBeUndefined()
    const explicit = { l: 0.1, t: 0, r: 0, b: 0 }
    expect(effectiveCrop(image('e', wide, { x: 0, y: 0, w: 400, h: 200 }, { crop: explicit }))).toEqual(explicit)
  })

  it('导出的 srcRect 在 stretch 前面，占位槽是可见的灰框而不是图片', async () => {
    const deck = deckOf([
      image('photo', wide, { x: 40, y: 100, w: 400, h: 200 }),
      image('empty', 'placeholder:团队合影', { x: 500, y: 100, w: 400, h: 200 }),
    ])
    const issues = checkDeck(deck)
    expect(issues.find(item => item.elementId === 'empty')?.severity).toBe('warning')
    const out = join(dir, 'deck.pptx')
    await exportDeck(deck, out, { platform: 'mac' })
    const zip = await JSZip.loadAsync(readFileSync(out))
    const slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
    const pic = slide.match(/<p:pic\b[\s\S]*?<\/p:pic>/)![0]
    expect(pic).toContain('name="photo"')
    expect(pic.indexOf('<a:srcRect')).toBeGreaterThan(pic.indexOf('<a:blip '))
    expect(pic.indexOf('<a:srcRect')).toBeLessThan(pic.indexOf('<a:stretch'))
    expect(slide.match(/<p:pic\b/g)).toHaveLength(1)
    expect(slide).toContain('图片占位：请放入你的图片')
    expect(Object.keys(zip.files).filter(name => name.startsWith('ppt/media/') && !zip.files[name]!.dir)).toHaveLength(1)
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))
})
