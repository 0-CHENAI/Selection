const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

function startsWithAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false
  }
  return true
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) << 8)
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0)
    + ((bytes[offset + 1] ?? 0) << 8)
    + ((bytes[offset + 2] ?? 0) << 16)
    + (bytes[offset + 3] ?? 0) * 0x1000000)
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) * 0x1000000
    + ((bytes[offset + 1] ?? 0) << 16)
    + ((bytes[offset + 2] ?? 0) << 8)
    + (bytes[offset + 3] ?? 0))
}

function isStaticPng(bytes: Uint8Array): boolean {
  if (
    bytes.length < 24
    || !startsWith(bytes, PNG_SIGNATURE)
    || readUInt32BE(bytes, PNG_SIGNATURE.length) !== 13
    || !startsWithAscii(bytes, 12, 'IHDR')
  ) return false

  let offset = PNG_SIGNATURE.length
  while (offset + 8 <= bytes.length) {
    const chunkLength = readUInt32BE(bytes, offset)
    const chunkTypeOffset = offset + 4
    if (startsWithAscii(bytes, chunkTypeOffset, 'acTL')) return false
    if (startsWithAscii(bytes, chunkTypeOffset, 'IDAT')) return true
    const nextOffset = offset + 8 + chunkLength + 4
    if (nextOffset <= offset || nextOffset > bytes.length) return true
    offset = nextOffset
  }
  return true
}

function isBmp(bytes: Uint8Array): boolean {
  if (bytes.length < 26 || !startsWithAscii(bytes, 0, 'BM')) return false
  const declaredFileSize = readUInt32LE(bytes, 2)
  const pixelDataOffset = readUInt32LE(bytes, 10)
  const dibHeaderSize = readUInt32LE(bytes, 14)
  if (declaredFileSize !== 0 && declaredFileSize < 26) return false
  if (pixelDataOffset < 14 + dibHeaderSize) return false
  if (declaredFileSize !== 0 && pixelDataOffset >= declaredFileSize) return false

  let colorPlanes: number
  let bitsPerPixel: number
  if (dibHeaderSize === 12) {
    colorPlanes = readUInt16LE(bytes, 22)
    bitsPerPixel = readUInt16LE(bytes, 24)
  } else if (dibHeaderSize >= 40 && dibHeaderSize <= 124 && bytes.length >= 30) {
    colorPlanes = readUInt16LE(bytes, 26)
    bitsPerPixel = readUInt16LE(bytes, 28)
  } else {
    return false
  }
  return colorPlanes === 1 && [1, 4, 8, 16, 24, 32].includes(bitsPerPixel)
}

/** Match the Pi read tool's supported image sniffing without invoking its image processor. */
export function detectReadImageMimeType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return bytes[3] === 0xf7 ? null : 'image/jpeg'
  }
  if (isStaticPng(bytes)) return 'image/png'
  if (startsWithAscii(bytes, 0, 'GIF')) return 'image/gif'
  if (startsWithAscii(bytes, 0, 'RIFF') && startsWithAscii(bytes, 8, 'WEBP')) {
    return 'image/webp'
  }
  if (isBmp(bytes)) return 'image/bmp'
  return null
}
