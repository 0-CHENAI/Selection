/**
 * Browser-safe wording for PPT visual QA.
 *
 * The renderer reaches this through `model-image-support` when it builds the
 * skipped-image note. Script inspection stays in `ppt-visual-qa-policy.ts`,
 * which imports `node:fs`. Vite externalizes that module as
 * `__vite-browser-external` and fails the renderer build on `existsSync`.
 */
export const PPT_VISUAL_QA_NO_OCR_NOTE =
  'Do not OCR or run a Swift/Vision/tesseract script in place of image input. For slide visual QA, report image_capability_mismatch and leave G4 blocked.';
