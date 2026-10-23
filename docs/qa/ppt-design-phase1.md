# PPT design phase 1 acceptance

> Historical note for #626. The live workflow is the selection-deck engine in `apps/electron/resources/skills/ppt-design/SKILL.md` (#631). This file is not an operating instruction.

Tracking: #626. Branch: `feat/ppt-design-skill`, target `test`.

## Scope and decisions

`apps/electron/resources/skills/ppt-design` is auto-discovered as an app-bundled skill. New presentations and whole-deck redesigns use its story/layout plan and locked style. Targeted edits/conversion retain the original design and use OfficeCLI. Versioned OfficeCLI guides remain unchanged: an app-owned, mandatory post-`load_skill` override replaces conflicting Gates, missing Morph `build.sh` references, jq/Python/shell-helper dependencies and unlimited QA. One G1–G5 sequence; at most three visual passes total.

The skill adapts design/workflow ideas from MIT `hugohe3/ppt-master` commit `622bf0148bca4f697b0184322c7e2aa2a04520a2`. The copied license matches upstream byte-for-byte. No Python dependencies, media libraries, icon assets or upstream rendering scripts were imported. No existing icons were changed.

## Runtime smoke

Linux x64; Bun 1.4.2; pinned OfficeCLI **1.0.157**, always with `OFFICECLI_SKIP_UPDATE=1`; Chrome 156 HTML screenshot renderer. Noto Sans/Serif and Noto Sans/Serif CJK SC availability checked with `fc-match`.

Artifacts are deliberately outside the repository at `/workspace/ppt-omp-artifacts/`:

| Style | Final deck | Every-slide screenshots |
|---|---|---|
| business | `business/deck.pptx` | `business/screenshots/slide-01.png` … `slide-09.png` |
| dark-tech | `dark-tech/deck.pptx` | `dark-tech/screenshots/slide-01.png` … `slide-09.png` |
| fresh-editorial | `fresh-editorial/deck.pptx` | `fresh-editorial/screenshots/slide-01.png` … `slide-09.png` |

Each deck has nine Chinese slides about a fictional urban heat-island pilot, with all demonstration values/targets explicitly labeled. Common sequence: cover, agenda, comparison, big-number, process, native chart, quote, timeline, closing. This controls content while comparing style differences. Story plan, strict spec, design lock, outline/text/validation diagnostics, contact sheet and per-slide review record are beside each deck.

Observed: all three generated successfully; schema validation passed; nine slides and nine speaker notes per deck, all visible supplied text/source strings and chart values read back exactly. All three final candidates report **0 issues**. All 27 final screenshots were opened individually in batches of two, checking Chinese glyphs/wrapping, fit, overlap, contrast, chart labels, sources and footer. No visible clipping, missing glyphs or overlaps found. White/navy filled panels, dark/cyan outlines, and paper/green/terracotta editorial treatment are visibly distinct. Adjacent layouts differ, with impact pages at slides 4 and 7.

Initial diagnostics found short eyebrow, agenda-number and big-number text boxes; increased fixed slot heights without shrinking or dropping text. Final samples use `scratch/deck-repair-1.pptx`. Conservatively recorded visual count is 2/3; interrupted initial work is not claimed as a completed pass. Reviewed bytes are copied to final paths and reopened/read/validated/closed for G5.

Supplemental smoke: all 14 layouts generated in `layout-sweep/deck-repair-2.pptx`; validation passed, 0 issues. Matrix text heights were corrected from diagnostic feedback. Literal `$35M` remained intact in saved text. The matrix screenshot is `layout-sweep/matrix.png`; this is coverage evidence, not a fourth required sample deck.

## Tests

`bun install --frozen-lockfile` completed. The native Word smoke also needs the standard dev staging of Bun at `apps/electron/vendor/bun/bun`, as implemented by `scripts/electron-dev.ts`; this local runtime is not committed.

The following targeted run completed with **103 pass, 0 fail, 579 assertions**:

```sh
bun test apps/electron/resources/skills/ppt-design/scripts/recipe.test.ts \
  packages/shared/src/skills/__tests__/ppt-design.test.ts \
  packages/shared/src/skills/__tests__/catalog.test.ts \
  packages/shared/src/agent/core/__tests__/skill-catalog-read.test.ts \
  packages/shared/src/utils/__tests__/officecli.test.ts \
  packages/shared/src/utils/__tests__/officecli-bundled.integration.test.ts \
  scripts/sync-officecli.test.ts \
  packages/shared/src/prompts/__tests__/system.test.ts
bun run typecheck
bun x tsc --noEmit --strict --skipLibCheck --target ESNext --module ESNext \
  --moduleResolution bundler --allowImportingTsExtensions --resolveJsonModule \
  --esModuleInterop --types bun,node \
  apps/electron/resources/skills/ppt-design/scripts/compose.ts \
  apps/electron/resources/skills/ppt-design/scripts/recipe.ts \
  apps/electron/resources/skills/ppt-design/scripts/recipe.test.ts
```

Shared typecheck and standalone strict script typecheck passed. After the final matrix-only geometry correction, the 10 recipe behavior tests and standalone strict typecheck passed again. Removed two existing prose/source-text snapshot tests rather than re-pinning changed wording; discovery/override behavior and actual native runtime smoke remain covered.

## SVG evidence and limits

Pinned v1.0.157 accepts `add --type picture --prop src=<input.svg>`. Saved XML is `p:pic` with `a:blip` / `asvg:svgBlip` and a 1×1 transparent PNG fallback, **not** separate native editable shapes. Evidence: `/workspace/ppt-omp-artifacts/svg-probe/pinned.pptx`; source [SvgImageHelper.cs at the reviewed commit](https://github.com/iOfficeAI/OfficeCLI/blob/b65272a18aef891941451705ff93e8a287f3eb72/src/officecli/Core/SvgImageHelper.cs). The inspected picture/import command schemas expose no direct SVG-to-native-shape conversion. Such conversion is a future direction, not implemented or claimed here.

Actual PowerPoint/Keynote playback on Windows/macOS and Morph animation were not exercised. Fonts are not embedded; receiving machines need compatible CJK fonts. True optical Chinese punctuation compression has no verified CLI control; the skill uses correct punctuation, line width and phrase wrapping instead. Fit preflight is a conservative estimate, not font measurement; rendered review remains mandatory. The recipe image slot accepts PNG/JPEG, not arbitrary SVG. Screenshots are local workspace artifacts, not public GitHub attachments.
