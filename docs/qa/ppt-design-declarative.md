# PPT declarative engine (#631)

Step 1 of #628. Branch targets `test`.

New-deck composition uses Selection Deck Document (960×540 pt, bounds, textCapacity, theme tokens) and PptxGenJS. OfficeCLI remains the editor for existing PPTX. The PPTD engine in dsh-desktop `packages/ppt-runtime/core/lib` was not copied.

## Engine

- Schema: `apps/electron/resources/skills/ppt-design/engine/types.ts`, `schema.ts`
- Check: `check.ts` (bounds, overlap, CJK capacity, contrast, orphans, literal `\\n`, adjacent layouts, missing images)
- Export: `export-pptx.ts` via PptxGenJS 4.0.1. Waterfall is a stacked column with a hidden base series.
- Preview: SVG → PNG via sharp. Packaged CLI is `scripts/deck.js` (rebuild after engine changes; `sharp` stays external).
- Path safety: `realpathSync` so macOS `/var` → `/private/var` tmpdir aliases cannot escape `--folder`.

## Styles

`swiss-signal` and `navy-brief`, 12 argument pages each (cover → conclusion → evidence-tree → matrix → waterfall → trend-callouts → scorecard → gantt → architecture → case-compare → funnel → closing). Covers are distinct compositions, not recolors.

## Tests

`apps/electron/resources/skills/ppt-design/engine/*.test.ts` plus bundled skill discovery in `packages/shared/src/skills/__tests__/ppt-design.test.ts`.
