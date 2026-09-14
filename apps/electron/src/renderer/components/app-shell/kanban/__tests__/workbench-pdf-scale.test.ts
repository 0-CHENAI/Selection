import { expect, it } from 'bun:test'
import { pdfRasterScale } from '../workbench-pdf-scale'

it('keeps normal pages sharp and bounds pathological PDF raster allocations', () => {
  expect(pdfRasterScale(612, 792)).toBe(1.25)
  for (const [width, height] of [[100000, 100000], [1e200, 1e200], [1, 1e200], [10000, 100]]) {
    const scale = pdfRasterScale(width!, height!)
    expect(scale).toBeGreaterThan(0)
    expect(width! * scale).toBeLessThanOrEqual(4096.0001)
    expect(height! * scale).toBeLessThanOrEqual(4096.0001)
    expect((width! * scale) * (height! * scale)).toBeLessThanOrEqual(8 * 1024 * 1024 + 1)
  }
  for (const value of [0, -1, Infinity, NaN]) expect(() => pdfRasterScale(value, 792)).toThrow('Invalid PDF page dimensions')
})
