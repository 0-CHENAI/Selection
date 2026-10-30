import sharp from 'sharp'

/** Detect card covers whose Chinese became empty boxes, or covers with no drawing at all. */
export async function coverQuality(bytes: Buffer): Promise<{ blank: boolean; tofu: boolean; boxes: number }> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const width = info.width
  const height = info.height
  const lum = new Uint8Array(width * height)
  let sum = 0
  let sum2 = 0
  let dark = 0
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel++) {
    const y = data[index]! * 0.2126 + data[index + 1]! * 0.7152 + data[index + 2]! * 0.0722
    lum[pixel] = y
    sum += y
    sum2 += y * y
    if (y < 80) dark++
  }
  const count = width * height
  const mean = sum / count
  const stddev = Math.sqrt(Math.max(0, sum2 / count - mean * mean))
  const seen = new Uint8Array(count)
  const stack: number[] = []
  const rings: Array<{ x: number; y: number; w: number; h: number; pixels: number }> = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x
      if (seen[start] || lum[start]! >= 80) continue
      stack.length = 0
      stack.push(start)
      seen[start] = 1
      let minX = x
      let maxX = x
      let minY = y
      let maxY = y
      let pixels = 0
      while (stack.length) {
        const current = stack.pop()!
        pixels++
        const cy = Math.floor(current / width)
        const cx = current - cy * width
        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy
        for (const next of [current - 1, current + 1, current - width, current + width]) {
          if (next < 0 || next >= count || seen[next]) continue
          const ny = Math.floor(next / width)
          if (Math.abs(ny - cy) > 1) continue
          if (lum[next]! >= 80) continue
          seen[next] = 1
          stack.push(next)
        }
      }
      const boxW = maxX - minX + 1
      const boxH = maxY - minY + 1
      const fill = pixels / (boxW * boxH)
      if (boxW >= 8 && boxH >= 8 && boxW <= 42 && boxH <= 42 && Math.abs(boxW - boxH) <= 8 && fill > 0.15 && fill < 0.55) {
        rings.push({ x: minX, y: minY, w: boxW, h: boxH, pixels })
      }
    }
  }
  // Tofu is a row of nearly identical hollow glyphs, and those outlines are most of the ink.
  let boxes = 0
  let boxedInk = 0
  for (const ring of rings) {
    const row = rings.filter(other => Math.abs(other.y - ring.y) <= 4 && Math.abs(other.h - ring.h) <= 3 && Math.abs(other.w - ring.w) <= 3)
    if (row.length >= 4) {
      boxes = Math.max(boxes, row.length)
      boxedInk = Math.max(boxedInk, row.reduce((sum, item) => sum + item.pixels, 0))
    }
  }
  return { blank: stddev < 4, tofu: boxes >= 4 && dark > 0 && boxedInk / dark > 0.45, boxes }
}
