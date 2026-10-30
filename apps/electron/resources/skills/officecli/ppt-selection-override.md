# Selection PowerPoint compatibility override

**Required for every PowerPoint task. Read after all `officecli load_skill` output and before document commands.** If another PowerPoint guide is loaded later, reapply this override before proceeding. These are Selection's operative replacements for conflicting instructions in `officecli-pptx`, `officecli-pitch-deck`, `morph-ppt`, `morph-ppt-3d`, and their style references. Do not execute the old conflicting workflow first. The private, versioned guides remain unmodified syntax references; `officecli help` is authoritative for the installed command schema.

## 三分修订路由（O1）

任何已有稿修改前，在会话 `design-plan.md` 记录路由标签与用户指定范围；按用户语义判断，不根据附件或模板里的孤立关键词改路由。

| 标签 | 用户意图 | 执行与保留边界 |
| --- | --- | --- |
| `office_edit` | 改标题/文字/表格数据/图片、保母版的局部格式修改 | OfficeCLI 检查并定点修改实际 PPTX，不用 deck 重生成，不重新锁风格。 |
| `deck_revision` | 改两页版式、叙事或重排 | 有匹配的 deck 工程时读取现有计划与 deck，只改请求范围，再 check → export；保留主题 token 和其他页。 |
| `restyle` | 明确要求整套换风格，或显式换风格 UI 操作 | 才允许重锁 style 并整套重排；事实与来源保留。 |

换色只改主题 token，保留布局/文字/图表/页数，不自动升级为换皮。继承的模板选择、跟进消息或检查失败都不是整套重做授权；问答不触发修改，明确要新稿时才启动新建。

没有匹配 deck 的外来 PPTX 先用 OfficeCLI 检查并定点改；不能伪造保真导入，也不能为局部修改重建整套。无法原位完成的版式修改须说明限制，整套重建仍需明确意图。OfficeCLI 改过后以保存的 PPTX 为准；后续 deck 修订前核对并同步这些改动，不能用旧工程导出覆盖新文字。新附件继续读取，但不重置既有风格。

## Ownership and targeted-edit boundary

- **New deck / whole-deck redesign:** load [`../ppt-design/SKILL.md`](../ppt-design/SKILL.md) and its required references before document commands. It owns the story, one locked `design.md`, and selection-deck pages on a **960×540 pt** canvas (13.333×7.5 in, the same **33.867×19.05 cm** slide). The bundled DSH style IDs are `dsh-cartesian`, `dsh-course-workshop`, `dsh-editorial-notebook`, `dsh-engineering-blueprint`, and `dsh-soft-editorial`. Fourteen ppt-master styles and seven layout families are also bundled; themes live in `styles/themes`. The argument-layout library (`deck-cli.mjs layouts`: conclusion, evidence tree, matrix, waterfall, annotated trend, scorecard, gantt, architecture, case comparison, funnel, process, timeline, closing, decision) is separate from those seven structural families. Chinese reference pages are `deck.json`; the five DSH sets also have English `deck.en.json`. The 16:9 canvas remains **960×540 pt**. Layout families may use 4:3, 1:1, 9:16, or 3:4. Export with `engine/deck-cli.mjs`. Do not calculate a second manual grid, do not rebuild the deck with OfficeCLI drawing commands, and do not use python-pptx. A clean `deck_check` is required before export and does not replace G4.
- **Existing deck layout/narrative/reordering (`deck_revision`):** read ppt-design and the saved plan/project; modify requested pages only, retain theme tokens and unaffected elements, check before export. Do not relock style. A local edit is not a whole-deck redesign.
- **Targeted existing-file text/data/image/local-format edit / conversion (`office_edit`):** inspect with OfficeCLI first and retain the existing design, theme, masters, fonts, colors, geometry, and unaffected content. Do not introduce a style lock from a different deck, regenerate the deck from a recipe, add unsolicited slides/notes/visuals, or redesign unrelated slides. Here G1 and G2 mean preserving the existing order and design except for explicitly requested changes. An explicitly requested whole-deck redesign belongs in the first branch.
- `officecli-pptx` supplies command syntax and technical object handling. Pitch is an optional fundraising-content delta; Morph/3D Morph is an optional requested motion delta. They are not competing designers. Apply their relevant evidence and object-integrity checks within the canonical Gates below.
- Legacy rules cannot override the locked `ppt-design` recipes or preserved existing design: no inherited 12-column/manual-grid calculation, 1.27 cm/0.76 cm spacing floor, title/body ratio, conflicting minimum type size, Georgia/Calibri pairing, extra palette, mandatory cover gradient/band/fill, cover-richness checklist, or compulsory decorative/non-text visual quota. Do not invent a presenter, client, date, metric, source, or image to satisfy those floors. Keep genuine contrast, fit, legibility, and evidence checks. Resolve a conflict through the owning design, not by blending incompatible rules.
- For a new/redesigned deck, use the typography reference's installed-font fallback and explicit East Asian font settings. On Linux, installed `Noto Sans CJK SC` / `Noto Serif CJK SC` are CJK fallbacks; do not silently let unavailable legacy fonts decide layout. A targeted edit preserves existing fonts unless a font change is requested or needed for that edit and disclosed.

### G4 检查范围（O2）

新稿、整套换皮或没有有效既往视觉证据时检查全部页。局部文字/单页/指定页版式修订，仅重新截图并原生读图受影响页；记录页码、修改内容和沿用的未改页证据。主题/字体等全局修改检查全部页；页序重排检查受影响的叙事顺序与页面。无法证明未改页未受影响时扩大到全量。

已知总页数 N，局部截图使用 `deck-cli.mjs screenshot <pptx> --out <dataFolderPath>/slides --pages N --only-pages 2,4`，列表为从 1 开始的实际页码，保持原文件名，不重编号、不覆盖无关截图。直接 CLI 定点修改也可逐页调用 OfficeCLI screenshot。截图不是视觉验收，仍需 Read 或 call_llm attachments 原生读图。

后文的每轮检查均指本节确定的范围。首次与至多两次修复复查共用原三次上限，不因范围缩小、换会话或换 renderer 而重置；检查后修改使对应页证据失效，不允许复用过期截图宣称通过。

## One canonical QA sequence: G1–G5

The following **replaces**, rather than supplements, legacy Gate numbering and sequencing. In particular, a pitch guide's “Gate 6” is not an extra delivery Gate, and “Gate 5a/5b” does not name another review loop. Record concrete evidence, not predetermined success messages. A token count or `validate` success never proves visual quality or business truth.

| Gate | Required evidence and pass condition |
|---|---|
| **G1 — Story and slide order** | New/redesign: approved task-derived brief and ordered slide plan, one intended message per slide, planned content and sources. Check actual `view outline` against the plan, including count and order. Targeted edit: existing count/order and unaffected narrative remain intact unless requested. Fundraising stage/vertical, required argument, and evidence completeness belong here. |
| **G2 — Locked design, typography and content fit** | New/redesign: one locked `ppt-design` style, that style's installed font pair, and a deck whose `deck_check` reports no issues. Keep text inside `textCapacity` and at or above the style's type floor; split the page instead of shrinking. Targeted edit: preserve the inspected design and fit the requested change. Use `view annotated` and `view issues` as diagnostics; resolve clipping, unreadable contrast, accidental off-slide content, inconsistent geometry, and unwanted placeholders. Never shrink body copy below the owning design's limits just to fit. A clean `deck_check` is not a visual pass. |
| **G3 — Saved OOXML/schema and content readback** | Save to the intended absolute file path, then run `officecli validate "<absolute-file.pptx>"`. Read saved content with `view text`, `view outline`, `get` or `query` as relevant. Verify requested text/data, units/currency, charts, relationships, notes, slide count/order, and exact changed objects against the brief/source. No schema errors, unexplained warnings, `UNSUPPORTED`, partial mutations, readback mismatches, or fabricated data. Do not copy old warning whitelists (including chart `spPr` exceptions). |
| **G4 — Rendered affected-scope visual inspection** | Render and visually inspect **every slide in the affected scope defined above**, not just a contact sheet or a sample. Record slide-numbered findings or a genuine pass. Check text fit/wrapping, overlaps, alignment, spacing, contrast, missing glyphs, imagery, chart labels/axes, connectors, citations/footers, narrative order, and design consistency. Include requested pitch/Morph visual checks in this same review, not a separate loop. HTML source/DOM or structural readback alone is not visual evidence. |
| **G5 — Delivery close/reopen and artifact existence** | After G1–G4 pass on the final saved state, close the document, reopen or re-read the saved artifact through OfficeCLI, and confirm the exact final path exists and is the deliverable. Reconfirm expected slide count/content; release any reopened resident session before handoff. Deliver the `.pptx`, not a Markdown draft, HTML preview, or scratch report. Respect the isolated-candidate runtime's automatic save/close boundary. |

### Hard limit: three visual passes total

For **PowerPoint only**, this replaces the router's otherwise unbounded QA rule and every inherited “fix until clean”, “max 3 cycles”, independent fresh-eyes, or additional scene review loop:

1. Initial scoped G4 review is **pass 1**.
2. If needed, repair from its recorded findings, save, repeat affected G1–G3 checks, and render/inspect every affected slide for **pass 2**.
3. If needed, perform one further repair and full review for **pass 3**.

At most **initial + two repair reviews**, shared across the whole task and all loaded guides/reviewers. Do not reset the count for pitch, Morph, a different renderer/reviewer, or a new candidate. Reviewing through an independent agent is optional and uses the same pass, not a new allowance. Do not require a repair when the first review genuinely passes, and do not invent findings because a guide says the first render must contain problems. Any change after a review invalidates that review for the changed state; it must be covered by a remaining visual pass. After pass 3, unresolved defects block readiness: stop repairs and report each affected slide, attempted fixes, and the actual blocker. Never label an unreviewed repair ready, hide errors, or make a fourth review to force PASS. Word/Excel QA remains unchanged; this is not a general operation/time budget.

Use the installed CLI's screenshot capability, for example `officecli view "<absolute-file.pptx>" screenshot --page 1 -o "<absolute-scratch>/slide-1.png"`, for each affected slide from the known outline. If the bundled preview cannot render, use an available real presentation renderer and inspect its output. Do not probe beyond the known slide count. Then follow `imageInput` in `<session_state>`. When it is `enabled`, Read each PNG or pass it in `call_llm` `attachments`. When it is `unavailable`, or the read returns `image_capability_mismatch`, state **G4 blocked / not visually verified**. Do not replace that result with OCR, a Swift/Vision script (`VNRecognizeTextRequest`), or a step named `Swift: OCR` / `OCR New Pages`. Reading HTML text is diagnostic only and cannot pass G4. Static renders do not verify animations or Morph interpolation; explicitly disclose any unverified target-viewer runtime behavior.

Do not OCR or run a Swift/Vision/tesseract script in place of image input. For slide visual QA, report image_capability_mismatch and leave G4 blocked.

## Readback without jq, Python, or shell-specific helpers

Selection does not require or install `jq`, Python, Bash/zsh/PowerShell helper scripts, or style build scripts for this workflow. Do **not** copy executable QA blocks that depend on `jq`, `grep`, `seq`, process substitution, heredocs, or shell-specific loops. Use individual OfficeCLI calls and read their actual output, or Selection's bundled Bun for JSON processing with explicit argument arrays and checked exit codes. Never depend on a user-installed runtime/package or use another library as the Office document engine. All scratch inputs, dumps, renders, and helper output belong under the absolute `dataFolderPath` from session state.

Supported shell-independent readbacks (replace placeholders with actual absolute paths and indices):

```text
officecli view "<absolute-file.pptx>" outline
officecli view "<absolute-file.pptx>" text
officecli view "<absolute-file.pptx>" annotated
officecli view "<absolute-file.pptx>" issues
officecli query "<absolute-file.pptx>" "slide" --json
officecli get "<absolute-file.pptx>" "/slide[1]" --depth 1 --json
officecli query "<absolute-file.pptx>" "chart" --json
officecli get "<absolute-file.pptx>" "/slide[1]/chart[1]" --json
```

Read raw JSON directly when possible. `get`/`query --json` return an envelope with results at `data.results`; a slide's children are at `data.results[0].children`. Shape names may be reported as `name` or `format.name` according to the node; inspect the actual record rather than assuming a missing key means no shape. Chart input `axismin` is commonly read back as `format.axisMin`; inspect actual output, not the incorrect bare `.format.axisMin` example in the pitch guide. A missing/malformed response is an error, never an empty successful result. Counts, shape-name filtering, geometry comparisons, and chart axes can all be checked from these outputs without `jq`; if automated, use ordinary Bun `JSON.parse` and JavaScript filtering on the same verified records.

For text containing currency, braces, backslashes, or `!!` names, prefer an argument-array invocation from bundled Bun or use the current tool's documented quoting rules. Compare saved text character-for-character with the source. In particular, a valid price such as `$9/mo` is **not** a token leak: the legacy Morph regex incorrectly matches valid currency. Detect missing/altered prices against intended text instead. Do not blindly reissue a failed mutation; inspect the partially changed document first.

## Pitch evidence is additive, not “Gate 6”

Keep the requested fundraising checks, without copying the legacy shell/token blocks or applying a new design system:

- **G1:** stage/vertical-appropriate narrative and evidence; market/TAM/SAM/SOM method and source; relevant unit economics (or vertical equivalent); credible team experience; specific ask, use of funds, milestone and runway. Do not invent missing facts, force SaaS metrics onto another vertical, or mistake a keyword for complete evidence. Missing required user/source data is an explicit blocker.
- **G3:** exact values, currency/units, market sources, prior-achievement statements, use-of-funds totals, and chart axes read back correctly. ARR/revenue/growth line charts use the required honest zero baseline; verify every applicable chart rather than accepting one zero-axis chart as proof for all. Inspect `axisMin` on the actual chart records. A substring hit for “TAM”, “CAC” or “Use of Funds” is not by itself a pass.
- **G4:** inspect the real slide composition, sources, axis presentation, team credentials, and requested ask/use-of-funds presentation during the same scoped review. Existing design or `ppt-design` recipes determine geometry, type, palette and cover treatment; legacy pitch patterns do not override them.

## Morph and 3D: intent only from styles, technical deltas only from guides

- **Never open or execute `reference/styles/<style-id>/build.sh`.** Those build scripts are not bundled in Selection. If requested motion needs style inspiration, inspect the actual library inventory, read an existing `style.md`, and optionally inspect an existing `.pptx` in that directory for **intent only**. Do not assume every directory contains a sample deck. Neither a style note nor a sample deck may replace the locked palette, fonts, or `deck.json` geometry, or restart manual grid design. Fixed-coordinate composition for a new deck comes from the locked style and `engine/deck-cli.mjs`; targeted edits preserve the existing composition.
- Replace `morph-helpers.py` and `morph-helpers.sh` with Selection's bundled cross-platform `officecli-morph-helper` (`clone`, `ghost`, `verify`, `final-check`, `clean-accumulation`). It uses bundled Bun, not Python or a particular user shell. Read its usage before invocation; helper output does not replace G3 or G4.
- Keep the requested motion plan and object integrity: exact persistent names and pairing, intended changes between pairs, actor entry/exit, per-slide content lifecycles, and 3D model identity/fresh insertion where required. Check all actual adjacent Morph pairs, not the guide's hard-coded first four pairs. Read raw slide JSON to compare same-name objects and planned geometry changes; no `jq`, unsupported prefix selector, or shell diff is needed. Retain applicable Morph motion/name requirements as technical deltas, not new static layout requirements.
- G2/G3 distinguish intentionally planned off-canvas ghosts from accidental overflow. Verify that ghosts are the intended non-content actors, remain outside the **33.867 cm** right edge on every required slide, do not leak into later scenes, and have no clipped visible content. Do not whitelist all off-slide diagnostics or treat helper success as visual proof.
- G4 checks visible actor leaks, crowding and static scene composition within the same three-pass cap. A static PNG/HTML preview cannot prove runtime motion or 3D animation. Claim only observed behavior; disclose when PowerPoint/Keynote/WPS playback has not been verified. Requested motion that cannot be implemented or verified must be reported honestly, never silently replaced by a claimed Morph pass.
- No audio/video/image search or generation is bundled or required by this workflow. Use available user assets or recipe-based shapes; missing essential assets are a stated prerequisite, not a license to invent evidence, install external media helpers, or run a style demo.
