/**
 * Build a Windows desktop icon from the flattened macOS 27 glass PNG.
 * Does not touch icon.icns / Assets.car (macOS Liquid Glass).
 *
 * Usage: bun generate-win-icon.ts
 */
import sharp from 'sharp'
import { writeFileSync } from 'fs'
import { join } from 'path'

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const root = import.meta.dir
const source = join(root, 'icon.png')
const outPng = join(root, 'icon-win.png')
const outIco = join(root, 'icon.ico')

await sharp(source).png().toFile(outPng)
console.log(`icon-win.png from ${source}`)

const pngs: Buffer[] = []
for (const size of ICO_SIZES) {
  pngs.push(await sharp(source).resize(size, size).png().toBuffer())
}

const ico = encodeIco(pngs, ICO_SIZES)
writeFileSync(outIco, ico)
console.log(`icon.ico ${ico.length} bytes (${ICO_SIZES.join(', ')})`)

function encodeIco(images: Buffer[], sizes: number[]): Buffer {
  const count = images.length
  const headerSize = 6 + 16 * count
  const chunks: Buffer[] = []
  let offset = headerSize

  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)

  for (let i = 0; i < count; i++) {
    const size = sizes[i]!
    const image = images[i]!
    const entry = 6 + i * 16
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt8(0, entry + 2)
    header.writeUInt8(0, entry + 3)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(image.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    chunks.push(image)
    offset += image.length
  }

  return Buffer.concat([header, ...chunks])
}
