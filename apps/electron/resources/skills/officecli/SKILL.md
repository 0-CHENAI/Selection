---
name: officecli
description: "Inspect, edit, validate, and deliver Word, Excel, and PowerPoint files with Selection's bundled OfficeCLI. Creates Word and Excel; for new PowerPoint, existing deck layout/narrative revisions, or explicit whole-deck restyling, ppt-design owns the deck project. Targeted edits and conversion preserve the existing deck design. Read before officecli load_skill."
---

# OfficeCLI

Selection already ships the correct OfficeCLI binary and its official skills. Use the `officecli` command on PATH. Never install, download, self-update, or fall back to a user-installed OfficeCLI.

## 三分修订路由（O1）

任何已有稿修改前，在会话 `design-plan.md` 记录路由标签与用户指定范围；按用户语义判断，不根据附件或模板里的孤立关键词改路由。

| 标签 | 用户意图 | 执行与保留边界 |
| --- | --- | --- |
| `office_edit` | 改标题/文字/表格数据/图片、保母版的局部格式修改 | OfficeCLI 检查并定点修改实际 PPTX，不用 deck 重生成，不重新锁风格。 |
| `deck_revision` | 改两页版式、叙事或重排 | 有匹配的 deck 工程时读取现有计划与 deck，只改请求范围，再 check → export；保留主题 token 和其他页。 |
| `restyle` | 明确要求整套换风格，或显式换风格 UI 操作 | 才允许重锁 style 并整套重排；事实与来源保留。 |

换色只改主题 token，保留布局/文字/图表/页数，不自动升级为换皮。继承的模板选择、跟进消息或检查失败都不是整套重做授权；问答不触发修改，明确要新稿时才启动新建。

没有匹配 deck 的外来 PPTX 必须先按 [外来稿 brief](references/external-ppt-brief.md) 用 `scripts/ppt-brief.ts`（OfficeCLI query）生成有损结构摘要，编辑前完整读取并校验源文件哈希，再选三分路由；变化后重新生成。`office_edit` 仍用 OfficeCLI 定点改副本。改版式或整套换风格走 `ppt_import`（`deck-cli.mjs import`），得到 deck.json 后再修订；原件和模板都不覆盖。映射不了的对象保留在原位并标成不可编辑。OfficeCLI 改过后以保存的 PPTX 为准；后续 deck 修订前核对并同步这些改动，不能用旧工程导出覆盖新文字。新附件继续读取，但不重置既有风格。中途上传的 PPTX 是外来稿，不是个人模板。

## Load only what the task needs

Before creating or editing a file, load the instructions in this order. Load each official guide at most once per task. For **every PowerPoint task**, also complete the mandatory Selection steps immediately below the table before running document commands.

| Task | Commands, in order |
|---|---|
| Word | `officecli load_skill word` |
| Academic paper | `officecli load_skill word`, then `officecli load_skill academic-paper` |
| Fillable Word form | `officecli load_skill word-form` |
| Excel or XLSM | `officecli load_skill excel` |
| Financial model | `officecli load_skill excel`, then `officecli load_skill financial-model` |
| Data dashboard | `officecli load_skill excel`, then `officecli load_skill data-dashboard` |
| Financial dashboard | `officecli load_skill excel`, `officecli load_skill financial-model`, then `officecli load_skill data-dashboard` |
| PowerPoint | `officecli load_skill pptx` |
| Pitch deck (fundraising requested) | `officecli load_skill pptx`, then `officecli load_skill pitch-deck` |
| Morph deck (cross-slide motion requested) | `officecli load_skill pptx`, then `officecli load_skill morph-ppt` |
| 3D Morph deck (3D motion requested) | `officecli load_skill pptx`, `officecli load_skill morph-ppt`, then `officecli load_skill morph-ppt-3d` |

### Mandatory PowerPoint routing and precedence

1. **New deck or whole-deck redesign:** read [`../ppt-design/SKILL.md`](../ppt-design/SKILL.md) and its required references before document commands. `ppt-design` owns the story, one locked style, and the selection-deck pages. Export the editable PPTX with the bundled `engine/deck-cli.mjs`. Do not rebuild that new deck with OfficeCLI shape commands. After export, OfficeCLI validates, reads the file back, screenshots, and does later targeted edits. The official `pptx` guide supplies OfficeCLI syntax, not a second design process. Load pitch/Morph guides only for requested fundraising/motion deltas.
2. **Layout/narrative/reordering in an existing deck project (`deck_revision`):** read ppt-design and the saved plan/deck; change only requested pages, keep theme tokens, check before export. Do not relock style.
3. **Targeted text/data/image/local-format edit to an existing deck (`office_edit`):** use OfficeCLI directly and preserve the existing theme, masters, typography, palette, layout, and unrelated content. Do not route a local text/data/shape edit through a redesign or force a `ppt-design` style onto it. Inspect the existing file before editing.
4. Load the official guide(s) from the table. **After all `load_skill` output, unconditionally read [`ppt-selection-override.md`](ppt-selection-override.md) for every PowerPoint task**, including targeted edits, pitch, Morph, and 3D Morph. If an additional PowerPoint guide is loaded later, reapply this override before the next document command. Do not execute legacy QA blocks or style-build instructions first.
5. Precedence for PowerPoint is: user requirements and the targeted-edit boundary; this router and the Selection override; `ppt-design` for new/deck-revision/restyled-deck design; official guide syntax and requested scene deltas. `officecli help` remains authoritative for the installed command schema. Older loaded guides cannot reinstate conflicting Gates, QA loops, `jq`, Python/shell helpers, manual grid design, palettes/fonts, or cover-fill requirements. Read the override as operative instructions, not optional advice.

Do not read global `~/.agents/skills/officecli`, `docx`, `xlsx`, or `pptx` instructions. Bundled `load_skill` output is the runtime syntax source, subject to the explicit Selection overrides above. Setup sections that mention curl, PowerShell downloads, package managers, or manual installation do not apply inside Selection.

Prose quality is a different skill. This router formats and delivers Office files; it does not rewrite sentences.

- Chinese article, report, email, or speech text: `natural-writing`
- English blog, docs, reply, or pull-request text: `humanizer`
- English paper, thesis, rebuttal, or grant-proposal prose: `academic-humanizer`

`officecli load_skill academic-paper` adds citation styles, equations, cross-references, and journal layout. Use it with `academic-humanizer` only when the user wants both cleaner English academic prose and a `.docx`. Do not load a prose skill for conversion, layout, or an unchanged paste, and do not use this router as a substitute for those prose skills.

## Execution rules

- Use OfficeCLI as the only engine for `.docx`, `.docm`, `.xlsx`, `.xlsm`, and for inspecting, validating, or making targeted text/data/image/local-format edits to an existing `.pptx`. New presentations, existing deck layout/narrative revisions and explicit whole-deck restyling are exported by the bundled ppt-design deck CLI, then checked with OfficeCLI. Do not switch to python-docx, openpyxl, python-pptx, or MarkItDown, and do not call PptxGenJS except through that bundled CLI.
- Keep the resident document session open across related edits. Use `save` when an intermediate checkpoint is useful and `close` only at the final delivery gate.
- Exception for interactive revisions in an isolated candidate: the runtime saves and closes the candidate at the end of every Bash call. Batch related edits in one call; verify saved content in the next. Do not depend on resident state across calls or inspect resident processes/locks. Use the isolated `dataFolderPath` for scratch output and finish with one short change summary for version history, without repeating the document or a troubleshooting report.
- For Word and Excel, do not impose a model-call, CLI-call, operation, QA, elapsed-time, or cost budget. Continue until the official Delivery Gate passes, the user cancels, or a genuine external blocker makes file state unverifiable. For **PowerPoint only**, the Selection override caps visual review at **3 passes total: initial review + at most 2 repair reviews** across all loaded guides; unresolved issues block a ready claim. This is not a general command or runtime budget.
- Treat a non-zero exit code, `WARNING`, `UNSUPPORTED`, missing output, or read-back mismatch as incomplete work. Inspect the relevant `officecli help` output, repair, and verify again.
- A mutating command can leave a partial change even when it exits non-zero, including `WARNING: UNSUPPORTED` with exit code 2. Read back the document before retrying; repair or remove the partial change, or restore a verified checkpoint. Never replay the command blindly.
- For `.xlsm`, preserve existing VBA parts. Verify the macro package remains present and unchanged; do not claim to create or modify VBA code.
- Legacy `.doc`, `.xls`, and `.ppt` files must be converted to OOXML before editing. Do not silently use another library.
- For Morph workflows, ignore official-guide references to `morph-helpers.py` and `morph-helpers.sh`. Selection replaces both with the cross-platform bundled command `officecli-morph-helper` (`clone`, `ghost`, `verify`, `final-check`, and `clean-accumulation`); it runs on Selection's bundled Bun runtime and requires no Python or particular user shell.

## 业务案例

会议纪要、工作通知/公文草稿、Excel 执行台账先读 [Office 业务案例](../office-business/SKILL.md) 与其 catalog，再加载上表相应正式格式指南。已有模板采用副本 + 指定段落/单元格修改，保留原件、样式、页眉页脚和公式。案例不授权重建用户原稿。

## Artifact paths

- Use the user-requested destination for the final Office file. If the user did not provide one, use the effective working directory. Set the final file variable to that absolute path.
- Put every disposable or intermediate artifact—including search results, extracted or normalized data, temporary files, Office dumps, drafts, caches, build inputs, helper scripts, and QA output—in the exact `dataFolderPath` from `<session_state>`.
- Use absolute paths for every scratch artifact. Relative scratch paths shown in an official guide, such as `blueprint.json`, `sheet.json`, `brief.md`, or temporary CSV files, are examples only and must be resolved under `dataFolderPath` inside Selection.
- Companion files required by an official guide for planning, reproducibility, or QA are still session artifacts unless the user explicitly asks to receive them. This Selection rule overrides guide delivery lists for those support files.
- If the user explicitly asks to keep a support file as a deliverable, write it to the requested location. Do not infer that every TXT or JSON file is disposable.
- Do not scan or delete pre-existing files in the working directory as cleanup. Avoid pollution by choosing the correct destination before creating an artifact.

## Delivery gate

For **PowerPoint**, use only canonical **G1 story/slide order → G2 locked design, typography and content fit → G3 saved OOXML/schema and content readback → G4 rendered affected-scope visual inspection (all pages for a new deck/global redesign; changed pages with valid prior evidence for local revisions) → G5 delivery close/reopen and artifact existence**, as defined in [`ppt-selection-override.md`](ppt-selection-override.md). Do not also execute a competing legacy Gate sequence. No HTML-source-only visual PASS, automatic warning whitelist, or unresolved blocker may be presented as ready. G4 follows `imageInput` in `<session_state>`: `enabled` uses `Read` or `call_llm` `attachments`; `unavailable` reports `image_capability_mismatch` and does not switch to OCR or a step named `OCR New Pages`.

Do not OCR or run a Swift/Vision/tesseract script in place of image input. For slide visual QA, report image_capability_mismatch and leave G4 blocked.

For **Word and Excel**, follow every validation and visual check required by the loaded official guide. At minimum:

1. Save the document and run the format's structural validation.
2. Read back representative content, formulas, relationships, notes, or styles.
3. Render or inspect the official preview when the guide requires visual QA.
4. Resolve every error, `WARNING`, and `UNSUPPORTED` result.
5. Close the resident document only after the final successful checks.
6. Reopen or re-read the saved artifact and confirm the delivered path exists.
7. Do not treat a chat Markdown body, `markdown-preview`, or a `call_llm` draft as the delivered file.

Selection adds one compatibility repair after Word document creation: missing Heading 1–3 `outlineLvl` values are seeded without replacing existing custom styles. If that repair reports an error, the document is not ready for delivery.
