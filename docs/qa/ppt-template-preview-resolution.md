# PPT template preview resolution

Baseline: `test` at `80c42451349e38fb548e4e88e166b22c7976ee3d`.

The picker generation script rasterized every detail page at a 480px long edge
and WebP quality 74. The separate `previews/pages` directory did not contain
high-resolution resources. All 1,047 images had that same limit. In the China
Telecom dialog, a 480×270 source occupied 859×483 CSS pixels on a 2x display.
Neither CSS image smoothing nor sharpening could recover the missing text.

## Changes

- Gallery covers and references retain their existing WebP bytes. Detail PDFs
  are exported from the unchanged deck, retain text/paths/embedded fonts, and
  use the existing PDF.js dependency. No PowerPoint source or template content
  is changed. The old page-image RPC remains available for compatibility.
- The 89 catalog entries share 75 PDFs (100,479,427 bytes total; largest
  4,605,144 bytes). This increases bundled resources by about 95.8 MiB without
  adding a rendering runtime. The gallery does not fetch these documents.
  Each document, including base64 overhead, fits the 16 MiB WebUI RPC limit.
  Tracked bundled resources increase from 152,360,356 to 252,840,084 bytes
  (65.95%; includes the release note). Existing aliases already save
  13,919,676 bytes by sharing PDFs; SHA-256 comparison found no duplicate PDF
  files among the remaining 75. Self-contained font subsets can repeat across
  documents, but eliminating those would require a different resource format.
- Only pages within 400 CSS pixels of the dialog viewport mount a canvas.
  Their backing resolution follows display DPR, container size, and changes
  between displays; each canvas has an 8 MP ceiling. Distant canvases unmount
  and closing the dialog destroys its PDF document/worker.
  Pending page-size queries ignore close/retry generations. Late RPC results
  cannot update an unmounted preview; the bounded shared cache may finish an
  already-started request for reuse rather than issuing a duplicate on reopen.
- Encoded previews have a 24 MiB LRU budget, counting two bytes per JS character.
  Requests coalesce, failures can retry, and library refresh invalidates cache.
- Custom detail pages use OfficeCLI's existing HTML scene directly from the
  stored original PPTX. Raster screenshot viewport arguments cannot reliably
  increase PPT output resolution. HTML pages instead render in lazy opaque
  sandboxed iframes at browser DPR. They cannot access the parent document.
  A CSP limits resources to embedded assets and the same OfficeCLI dependency
  hosts used by its renderer. Rendering concurrency is two and the generated
  disk cache is capped at 128 MiB; original user files are never evicted.
  Custom catalog rasters are separately reduced to 480px. The pre-existing SVG
  geometry fallback remains available when the source renderer is unavailable.

## Verification

- All 75 PDF page counts were checked against the 89 catalog deck mappings.
  Tests check every detail resource and message size, old RPC compatibility,
  traversal rejection, custom source preservation, retry/deduplication and LRU
  eviction. Existing thumbnail bytes remain unchanged.
- The actual `TemplateGallery` component was exercised in Chromium at
  1440×1100. At 859×483 CSS pixels the detail canvas measured 861×484 at DPR 1,
  1722×968 at DPR 2 and 2582×1452 at DPR 3. Small Chinese text on China Telecom
  page 4 and its logos were opened and visually compared with the baseline.
- Scroll-to-end removed page 1's canvas, at most five nearby canvases remained,
  closing removed all canvases, and reopening reused the document request.
  4:3, A4, 9:16 and a second standard template were also rendered and inspected.
  An additional 24 rapid close/reopen cycles at different loading stages
  produced no page errors or retained canvases/iframes. Only two document RPCs
  were issued while alternating between two templates, and the final reopen
  rendered successfully after cancellation.
- A real imported China Telecom PPTX was exercised through the registered
  skills handlers and WebSocket transport. Only pages 1–3 were requested
  initially; scrolling to page 4 mounted four nearby frames. The rendered
  Chinese content was inspected, and parent access raised `SecurityError`.
- Electron 39.2.7 rendered the same component through those RPC handlers in a
  real offscreen BrowserWindow at DPR 2: 851 CSS px used a 1706px canvas, with
  only three canvases mounted. Its captured PNG was opened and inspected.
- `bun run typecheck:all`, the relevant 29 tests (including exhaustive local/
  remote RPC routing), lint and the WebUI production
  build were run. The local tracked suite hit an existing CJS bundling test's
  five-second timeout; that unchanged test passed alone in 3.62 seconds.
  Required remote CI must pass before merging.

## Visual evidence and limits

| View | Before | After |
| --- | --- | --- |
| Large cover, DPR 2 | [Before](ppt-template-preview-resolution/before-retina.png) | [After](ppt-template-preview-resolution/after-retina.png) |
| Chinese small text, page 4 | [Before](ppt-template-preview-resolution/before-small-text.png) | [After](ppt-template-preview-resolution/after-small-text.png) |
| Imported original PPTX | — | [Custom detail](ppt-template-preview-resolution/after-custom-small-text.png) |
| Electron 39.2.7, DPR 2 | — | [Electron detail](ppt-template-preview-resolution/after-electron.png) |

These are application preview checks using LibreOffice-exported PDFs and
OfficeCLI HTML, not native Microsoft PowerPoint rendering acceptance. Native
PowerPoint desktop rendering and animations were not tested. The original
user screenshot could not be transferred into this execution environment;
the same real bundled template reproduced the reported issue. Saving these
screenshots to Library was attempted using its standard prepared-upload flow,
which failed before preparation because its hosted tool discovery could not
connect. No screenshot Library IDs were issued; the original PNG evidence is
retained here for review.
