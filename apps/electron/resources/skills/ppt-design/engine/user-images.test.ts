import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import JSZip from 'jszip'
import { argumentTheme } from './argument-layouts.ts'
import { checkDeck } from './check.ts'
import { effectiveCrop, exportDeck, imagePlacement } from './export-pptx.ts'
import { PICTURE_SLOT_CATALOGS, computePictureSlotCatalog } from './picture-slot-catalog.ts'
import { pictureSlotPages } from './picture-slots.ts'
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

const EMU = 12700

function aspect(box: { w: number; h: number }): number { return box.w / box.h }

describe('用户图片原样放进图片位：不裁切、不改比例', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ppt-user-images-'))
  const wide = join(dir, 'wide.png')
  const tall = join(dir, 'tall.png')
  const imported = join(dir, 'slide1-e3.png')
  writeFileSync(wide, png(160, 120))
  writeFileSync(tall, png(90, 135))
  writeFileSync(imported, png(160, 120))

  it('按原比例缩进图框并居中，fill 和 contain 一样', () => {
    for (const fit of ['fill', 'contain'] as const) {
      const box = { x: 40, y: 100, w: 400, h: 200 }
      const placed = imagePlacement(image('a', wide, box, { fit }))
      expect(Math.abs(aspect(placed) / (160 / 120) - 1)).toBeLessThan(0.005)
      expect(placed.h).toBeCloseTo(200, 5)
      expect(placed.x - box.x).toBeCloseTo(box.x + box.w - placed.x - placed.w, 5)
      expect(placed.x).toBeGreaterThanOrEqual(box.x)
      expect(placed.x + placed.w).toBeLessThanOrEqual(box.x + box.w + 1e-9)
      const square = { x: 0, y: 0, w: 300, h: 300 }
      const portrait = imagePlacement(image('b', tall, square, { fit }))
      expect(Math.abs(aspect(portrait) / (90 / 135) - 1)).toBeLessThan(0.005)
      expect(portrait.h).toBeCloseTo(300, 5)
      expect(portrait.x).toBeCloseTo((300 - portrait.w) / 2, 5)
      expect(effectiveCrop(image('a', wide, box, { fit }))).toBeUndefined()
    }
  })

  it('导入稿作者写的 crop 和原样带来的图片保持原稿几何', () => {
    const box = { x: 0, y: 0, w: 400, h: 200 }
    const crop = { l: 0, t: 1 / 6, r: 0, b: 1 / 6 }
    expect(effectiveCrop(image('c', wide, box, { crop }))).toEqual(crop)
    expect(imagePlacement(image('c', wide, box, { crop }))).toEqual(box)
    expect(imagePlacement(image('d', imported, box), { version: 2 })).toEqual(box)
    // 同一张图放进模板稿（version 1），仍按原比例放。
    expect(imagePlacement(image('d', imported, box), { version: 1 }).w).toBeCloseTo(200 * 160 / 120, 5)
  })

  it('导出的用户图片没有 srcRect，画面比例和原图一致；占位框仍是最后手段', async () => {
    const deck = deckOf([
      image('photo', wide, { x: 40, y: 100, w: 400, h: 200 }),
      image('tall', tall, { x: 500, y: 100, w: 400, h: 200 }),
      image('empty', 'placeholder:团队合影', { x: 500, y: 320, w: 400, h: 200 }),
    ])
    const issues = checkDeck(deck)
    expect(issues.find(item => item.elementId === 'empty')?.severity).toBe('warning')
    const out = join(dir, 'deck.pptx')
    await exportDeck(deck, out, { platform: 'mac' })
    const zip = await JSZip.loadAsync(readFileSync(out))
    const slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
    const pics = slide.match(/<p:pic\b[\s\S]*?<\/p:pic>/g)!
    expect(pics).toHaveLength(2)
    expect(slide).not.toContain('<a:srcRect')
    for (const [name, ratio, box] of [['photo', 160 / 120, { x: 40, w: 400 }], ['tall', 90 / 135, { x: 500, w: 400 }]] as const) {
      const pic = pics.find(block => block.includes(`name="${name}"`))!
      const [, x, , cx, cy] = pic.match(/<a:off x="(\d+)" y="(\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/)!.map(Number)
      expect(Math.abs(cx! / cy! / ratio - 1)).toBeLessThan(0.005)
      const left = x! / EMU - box.x
      const right = box.x + box.w - (x! + cx!) / EMU
      expect(Math.abs(left - right)).toBeLessThan(0.5)
    }
    expect(slide).toContain('图片占位：请放入你的图片')
  })

  it('导入稿的 crop 写成 srcRect，位置在 blip 之后、stretch 之前', async () => {
    const deck: Deck = { ...deckOf([image('cut', imported, { x: 40, y: 100, w: 400, h: 200 }, { crop: { l: 0, t: 1 / 6, r: 0, b: 1 / 6 } })]), version: 2 } as Deck
    const out = join(dir, 'imported.pptx')
    await exportDeck(deck, out, { platform: 'mac' })
    const slide = await (await JSZip.loadAsync(readFileSync(out))).file('ppt/slides/slide1.xml')!.async('string')
    const pic = slide.match(/<p:pic\b[\s\S]*?<\/p:pic>/)![0]
    expect(pic.indexOf('<a:srcRect')).toBeGreaterThan(pic.indexOf('<a:blip '))
    expect(pic.indexOf('<a:srcRect')).toBeLessThan(pic.indexOf('<a:stretch'))
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))
})

describe('没给图片就不用图片位', () => {
  const sample = 'styles/examples/_assets/0b0b62ee5d313b48.jpg'
  const carrier: DeckElement = { id: 'grid-picture-one-carrier', type: 'shape', shape: 'rect', role: 'decoration', bounds: { x: 480, y: 0, w: 480, h: 270 }, line: { color: '$line', width: 1, style: 'dash' } }

  it('成稿里留着模板样例照片是错误，空图片框和占位框是提醒', () => {
    const issues = checkDeck(deckOf([image('sample', sample, { x: 40, y: 100, w: 417, h: 201 }), carrier, image('ph', 'placeholder:合影', { x: 40, y: 320, w: 300, h: 200 })]))
    expect(issues.find(item => item.elementId === 'sample')?.severity ?? 'error').toBe('error')
    expect(issues.find(item => item.elementId === 'sample')?.message).toContain('没有图片位的版式')
    expect(issues.find(item => item.elementId === carrier.id)).toMatchObject({ code: 'empty_picture_slot', severity: 'warning' })
    expect(issues.find(item => item.elementId === 'ph')?.severity).toBe('warning')
  })

  it('图片框放了图就不再提醒；模板样例稿本身不报错', () => {
    const filled = checkDeck(deckOf([carrier, image('user', '/tmp/user.jpg', { x: 480, y: 0, w: 480, h: 270 })]))
    expect(filled.some(item => item.elementId === carrier.id)).toBe(false)
    const example = { ...deckOf([image('sample', sample, { x: 40, y: 100, w: 417, h: 201 })]), profile: 'example' } as Deck
    expect(checkDeck(example).some(item => item.elementId === 'sample')).toBe(false)
  })

  it('没有图片位的页拼成的稿没有图片位问题', () => {
    const page = deckOf([])
    expect(pictureSlotPages(page)).toEqual([])
    expect(checkDeck(page).filter(item => item.code === 'missing_asset')).toEqual([])
  })

  it('catalog 的 pictureSlotPages 与参考页同步', () => {
    const root = join(import.meta.dir, '..')
    for (const path of PICTURE_SLOT_CATALOGS) {
      expect(JSON.parse(readFileSync(join(root, path), 'utf8'))).toEqual(computePictureSlotCatalog(root, path))
    }
    const styles = JSON.parse(readFileSync(join(root, 'styles/catalog.json'), 'utf8')) as Record<string, { pictureSlotPages?: number[] }>
    expect(styles['solution-proposal']!.pictureSlotPages).toEqual([1, 6, 14])
    const layouts = JSON.parse(readFileSync(join(root, 'layouts/catalog.json'), 'utf8')) as Record<string, { pictureSlotPages?: number[] }>
    expect(layouts['presentation_core']!.pictureSlotPages).toEqual([9, 11, 16, 17, 18])
  })
})
