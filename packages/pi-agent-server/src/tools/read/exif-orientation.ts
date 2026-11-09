import type { PhotonImageLike, PhotonModuleLike } from './photon-runtime.ts'

function hasExifHeader(bytes: Uint8Array, offset: number): boolean {
  return bytes[offset] === 0x45
    && bytes[offset + 1] === 0x78
    && bytes[offset + 2] === 0x69
    && bytes[offset + 3] === 0x66
    && bytes[offset + 4] === 0x00
    && bytes[offset + 5] === 0x00
}

function readOrientationFromTiff(bytes: Uint8Array, tiffStart: number): number {
  if (tiffStart + 8 > bytes.length) return 1
  const littleEndian = (((bytes[tiffStart] ?? 0) << 8) | (bytes[tiffStart + 1] ?? 0)) === 0x4949
  const read16 = (position: number): number => littleEndian
    ? (bytes[position] ?? 0) | ((bytes[position + 1] ?? 0) << 8)
    : ((bytes[position] ?? 0) << 8) | (bytes[position + 1] ?? 0)
  const read32 = (position: number): number => littleEndian
    ? ((bytes[position] ?? 0)
      | ((bytes[position + 1] ?? 0) << 8)
      | ((bytes[position + 2] ?? 0) << 16)
      | ((bytes[position + 3] ?? 0) << 24)) >>> 0
    : (((bytes[position] ?? 0) << 24)
      | ((bytes[position + 1] ?? 0) << 16)
      | ((bytes[position + 2] ?? 0) << 8)
      | (bytes[position + 3] ?? 0)) >>> 0

  const directoryStart = tiffStart + read32(tiffStart + 4)
  if (directoryStart + 2 > bytes.length) return 1
  const entryCount = read16(directoryStart)
  for (let index = 0; index < entryCount; index += 1) {
    const entryPosition = directoryStart + 2 + index * 12
    if (entryPosition + 12 > bytes.length) return 1
    if (read16(entryPosition) !== 0x0112) continue
    const orientation = read16(entryPosition + 8)
    return orientation >= 1 && orientation <= 8 ? orientation : 1
  }
  return 1
}

function findJpegTiffOffset(bytes: Uint8Array): number {
  let offset = 2
  while (offset < bytes.length - 1) {
    if (bytes[offset] !== 0xff) return -1
    const marker = bytes[offset + 1]
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0xe1) {
      if (offset + 4 >= bytes.length) return -1
      const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)
      if (length < 2 || offset + 2 + length > bytes.length) return -1
      const segmentStart = offset + 4
      if (segmentStart + 6 <= bytes.length && hasExifHeader(bytes, segmentStart)) {
        return segmentStart + 6
      }
      offset += 2 + length
      continue
    }
    if (offset + 4 > bytes.length) return -1
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)
    if (length < 2 || offset + 2 + length > bytes.length) return -1
    offset += 2 + length
  }
  return -1
}

function findWebpTiffOffset(bytes: Uint8Array): number {
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const chunkId = String.fromCharCode(
      bytes[offset] ?? 0,
      bytes[offset + 1] ?? 0,
      bytes[offset + 2] ?? 0,
      bytes[offset + 3] ?? 0,
    )
    const chunkSize = ((bytes[offset + 4] ?? 0)
      | ((bytes[offset + 5] ?? 0) << 8)
      | ((bytes[offset + 6] ?? 0) << 16)
      | ((bytes[offset + 7] ?? 0) << 24)) >>> 0
    const dataStart = offset + 8
    if (chunkId === 'EXIF') {
      if (dataStart + chunkSize > bytes.length) return -1
      return chunkSize >= 6 && hasExifHeader(bytes, dataStart) ? dataStart + 6 : dataStart
    }
    offset = dataStart + chunkSize + (chunkSize % 2)
  }
  return -1
}

function getExifOrientation(bytes: Uint8Array): number {
  let tiffOffset = -1
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    tiffOffset = findJpegTiffOffset(bytes)
  } else if (
    bytes.length >= 12
    && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  ) {
    tiffOffset = findWebpTiffOffset(bytes)
  }
  return tiffOffset === -1 ? 1 : readOrientationFromTiff(bytes, tiffOffset)
}

function rotate90(
  photon: PhotonModuleLike,
  image: PhotonImageLike,
  destinationIndex: (x: number, y: number, width: number, height: number) => number,
): PhotonImageLike {
  const width = image.get_width()
  const height = image.get_height()
  const source = image.get_raw_pixels()
  const destination = new Uint8Array(source.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = (y * width + x) * 4
      const targetIndex = destinationIndex(x, y, width, height) * 4
      destination[targetIndex] = source[sourceIndex] ?? 0
      destination[targetIndex + 1] = source[sourceIndex + 1] ?? 0
      destination[targetIndex + 2] = source[sourceIndex + 2] ?? 0
      destination[targetIndex + 3] = source[sourceIndex + 3] ?? 0
    }
  }
  return new photon.PhotonImage(destination, height, width)
}

export function applyExifOrientation(
  photon: PhotonModuleLike,
  image: PhotonImageLike,
  originalBytes: Uint8Array,
): PhotonImageLike {
  switch (getExifOrientation(originalBytes)) {
    case 2:
      photon.fliph(image)
      return image
    case 3:
      photon.fliph(image)
      photon.flipv(image)
      return image
    case 4:
      photon.flipv(image)
      return image
    case 5: {
      const rotated = rotate90(photon, image, (x, y, _width, height) => x * height + (height - 1 - y))
      photon.fliph(rotated)
      return rotated
    }
    case 6:
      return rotate90(photon, image, (x, y, _width, height) => x * height + (height - 1 - y))
    case 7: {
      const rotated = rotate90(photon, image, (x, y, width, height) => (width - 1 - x) * height + y)
      photon.fliph(rotated)
      return rotated
    }
    case 8:
      return rotate90(photon, image, (x, y, width, height) => (width - 1 - x) * height + y)
    default:
      return image
  }
}
