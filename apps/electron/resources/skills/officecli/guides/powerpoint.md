# Selection PowerPoint 工作流

## 三分修订路由（O1）

以下三分路由用于 PowerPoint。Word/Excel 直接按新建或定点修改处理，不创建 design-plan.md；局部修改保留未涉及内容。

| 标签 | 用户意图 | 执行与保留边界 |
| --- | --- | --- |
| `office_edit` | 改标题/文字/表格数据/图片、保母版的局部格式修改 | OfficeCLI 检查并定点修改实际 PPTX，不用 deck 重生成，不重新锁风格。 |
| `deck_revision` | 改两页版式、叙事或重排 | 有匹配的 deck 工程时读取现有计划与 deck，只改请求范围，再 check → export；保留主题 token 和其他页。 |
| `restyle` | 明确要求整套换风格，或显式换风格 UI 操作 | 才允许重锁 style 并整套重排；事实与来源保留。 |

换色只改主题 token，保留布局/文字/图表/页数，不自动升级为换皮。继承的模板选择、跟进消息或检查失败都不是整套重做授权；问答不触发修改，明确要新稿时才启动新建。

没有匹配 deck 的外来 PPTX 必须先按 [外来稿 brief](../references/external-ppt-brief.md) 用 `scripts/ppt-brief.ts`（OfficeCLI query）生成有损结构摘要，编辑前完整读取并校验源文件哈希，再选三分路由；变化后重新生成。`office_edit` 仍用 OfficeCLI 定点改副本。改版式或整套换风格走 `ppt_import`（`deck-cli.mjs import`），得到 deck.json 后再修订；原件和模板都不覆盖。映射不了的对象保留在原位并标成不可编辑。OfficeCLI 改过后以保存的 PPTX 为准；后续 deck 修订前核对并同步这些改动，不能用旧工程导出覆盖新文字。新附件继续读取，但不重置既有风格。中途上传的 PPTX 是外来稿，不是个人模板。

| 任务 | 按需加载一次 |
| --- | --- |
| PowerPoint | `officecli load_skill pptx` |
| 募资演示 | `officecli load_skill pptx`，再 `officecli load_skill pitch-deck` |
| Morph 动效 | `officecli load_skill pptx`，再 `officecli load_skill morph-ppt` |
| 3D Morph | `officecli load_skill pptx`、`officecli load_skill morph-ppt`、`officecli load_skill morph-ppt-3d` |

For Morph workflows, ignore official-guide references to `morph-helpers.py` and `morph-helpers.sh`. Use the bundled `officecli-morph-helper` (`clone`, `ghost`, `verify`, `final-check`, `clean-accumulation`); it uses bundled Bun without Python or a particular shell.

### Mandatory PowerPoint routing and precedence

1. **New deck or whole-deck redesign:** read [`../../ppt-design/SKILL.md`](../../ppt-design/SKILL.md) and its required references before document commands. `ppt-design` owns the story, one locked style, and the selection-deck pages. Export the editable PPTX with the bundled `engine/deck-cli.mjs`. Do not rebuild that new deck with OfficeCLI shape commands. After export, OfficeCLI validates, reads the file back, screenshots, and does later targeted edits. The official `pptx` guide supplies OfficeCLI syntax, not a second design process. Load pitch/Morph guides only for requested fundraising/motion deltas.
2. **Layout/narrative/reordering in an existing deck project (`deck_revision`):** read ppt-design and the saved plan/deck; change only requested pages, keep theme tokens, check before export. Do not relock style.
3. **Targeted text/data/image/local-format edit to an existing deck (`office_edit`):** use OfficeCLI directly and preserve the existing theme, masters, typography, palette, layout, and unrelated content. Do not route a local text/data/shape edit through a redesign or force a `ppt-design` style onto it. Inspect the existing file before editing.
4. Load the official guide(s) from the table. **After all `load_skill` output, unconditionally read [`../ppt-selection-override.md`](../ppt-selection-override.md) for every PowerPoint task**, including targeted edits, pitch, Morph, and 3D Morph. If an additional PowerPoint guide is loaded later, reapply this override before the next document command. Do not execute legacy QA blocks or style-build instructions first.
5. Precedence for PowerPoint is: user requirements and the targeted-edit boundary; this router and the Selection override; `ppt-design` for new/deck-revision/restyled-deck design; official guide syntax and requested scene deltas. `officecli help` remains authoritative for the installed command schema. Older loaded guides cannot reinstate conflicting Gates, QA loops, `jq`, Python/shell helpers, manual grid design, palettes/fonts, or cover-fill requirements. Read the override as operative instructions, not optional advice.


## PowerPoint 交付

For **PowerPoint**, use only canonical **G1 story/slide order → G2 locked design, typography and content fit → G3 saved OOXML/schema and content readback → G4 rendered affected-scope visual inspection (all pages for a new deck/global redesign; changed pages with valid prior evidence for local revisions) → G5 delivery close/reopen and artifact existence**, as defined in [`../ppt-selection-override.md`](../ppt-selection-override.md). Do not also execute a competing legacy Gate sequence. No HTML-source-only visual PASS, automatic warning whitelist, or unresolved blocker may be presented as ready. G4 follows `imageInput` in `<session_state>`: `enabled` uses `Read` or `call_llm` `attachments`; `unavailable` reports `image_capability_mismatch` and does not switch to OCR or a step named `OCR New Pages`.

Do not OCR or run a Swift/Vision/tesseract script in place of image input. For slide visual QA, report image_capability_mismatch and leave G4 blocked.
