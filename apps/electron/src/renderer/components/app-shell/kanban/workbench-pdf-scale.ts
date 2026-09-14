/** Bound the raster allocation, not the original document or extracted text. */
export function pdfRasterScale(width: number, height: number, desired = 1.25): number {
  if (![width, height, desired].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid PDF page dimensions')
  const maxDimension = 4096
  const maxPixels = 8 * 1024 * 1024
  // Divide roots separately so width * height cannot overflow before capping.
  return Math.min(desired, maxDimension / width, maxDimension / height, Math.sqrt(maxPixels) / Math.sqrt(width) / Math.sqrt(height))
}
