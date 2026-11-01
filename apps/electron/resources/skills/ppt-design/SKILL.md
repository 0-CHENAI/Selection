---
name: ppt-design
description: "制作新的 PPT、PowerPoint、presentation、幻灯片或整套演示文稿重设计。用 selection-deck 声明页、预检和 PptxGenJS 导出可编辑 PPTX，再逐页看截图。也用于已有 deck 的版式、叙事与重排修订；现有 PPT 的文字、数据、图片或局部格式修改走 OfficeCLI。"
---

# PPT Design

## 入口与边界

- 用于**新建演示文稿 / 已有 deck 的版式、叙事、重排 / 用户明确要求整套换风格**。已有稿先按下方三分路由判断。
- 局部文字/数据/图片/格式编辑、转换已有文件：转交 [OfficeCLI](../officecli/SKILL.md)。保留原设计和未要求修改的内容，不要把原文件重写成一套新的 deck。
- 新文稿的页面作者是 selection-deck。导出使用本技能附带的 `engine/deck-cli.mjs`（PptxGenJS）。不要另写 python-pptx，也不要用 OfficeCLI 形状命令从零搭一整套页。
- 导出之后，OfficeCLI 负责 `validate`、读回、截图，以及用户随后提出的定点修改。
- 不安装 Python、第三方 PPT 库或渲染运行时，不下载或自更新 OfficeCLI。本机如果已经有 LibreOffice，截图步骤可以借用；没有也不要安装。

## 三分修订路由（O1）

任何已有稿修改前，在会话 `design-plan.md` 记录路由标签与用户指定范围；按用户语义判断，不根据附件或模板里的孤立关键词改路由。

| 标签 | 用户意图 | 执行与保留边界 |
| --- | --- | --- |
| `office_edit` | 改标题/文字/表格数据/图片、保母版的局部格式修改 | OfficeCLI 检查并定点修改实际 PPTX，不用 deck 重生成，不重新锁风格。 |
| `deck_revision` | 改两页版式、叙事或重排 | 有匹配的 deck 工程时读取现有计划与 deck，只改请求范围，再 check → export；保留主题 token 和其他页。 |
| `restyle` | 明确要求整套换风格，或显式换风格 UI 操作 | 才允许重锁 style 并整套重排；事实与来源保留。 |

换色只改主题 token，保留布局/文字/图表/页数，不自动升级为换皮。继承的模板选择、跟进消息或检查失败都不是整套重做授权；问答不触发修改，明确要新稿时才启动新建。

没有匹配 deck 的外来 PPTX，先读 brief，再按意图分流。`office_edit`（改几个字、改数据、局部格式）仍复制后用 OfficeCLI 定点改，不导入工程。`deck_revision` / `restyle`（改版式或整套换风格）用 `ppt_import` 把文件导入成新的 deck.json 工程，再修订。原件只读，不覆盖原始模板和个人模板库。映射不了的对象标成保留不可编辑，导出时按原位置贴回，改版式时它们不跟着动。不承诺逐对象还原。OfficeCLI 改过后以保存的 PPTX 为准；后续 deck 修订前核对并同步这些改动，不能用旧工程导出覆盖新文字。新附件继续读取，但不重置既有风格。PPT 模式中途上传的 PPTX 是外来稿，不是个人模板，不要登记进模板库。

## 先读，再执行

1. 规划时读 [工作流](references/workflow.md)。选定风格前读 [怎么选模板](references/template-picking.md)，再只读 [风格索引](references/styles.md) 里那一套的 `design.md`。中文参考页是 `deck.json`，英文参考页是 `deck.en.json`。每次最多读 12 页参考，参考页不能当输出背景。
2. 写页面时读 [叙事组合](references/composition.md)、[版式](references/layouts.md)、[排版](references/typography.md) 和 [格式](references/schema.md)。个人模板和配图槽按下面两节，细则在 [对齐对照](references/dsh-ppt-parity.md)。
3. 看页面前读 [逐页视觉检查](references/visual-review.md)。用 `office_render` 把导出的 PPTX 交给模型自己看，整项任务最多 3 轮，禁止 OCR。
4. 先读 [OfficeCLI 路由](../officecli/SKILL.md)。导出后的检查执行 `officecli load_skill pptx`；仅当用户要求募资叙事或跨页动画时，再追加 pitch-deck / morph-ppt / morph-ppt-3d。
5. **所有指南加载后**读 [Selection 覆盖规则](../officecli/ppt-selection-override.md)，再做文档操作。后来又加载指南时，重新应用覆盖规则。

`officecli help` 决定 OfficeCLI 的命令语法。所有 OfficeCLI 调用设置 `OFFICECLI_SKIP_UPDATE=1`，使用应用随附版本。

## 从故事线到页面

- 从用户材料提取受众、目的、核心结论、事实和假设、来源、页数。不捏造数据、日期、讲者或标志。
- 一页一个主张。先写有顺序的故事，再为每页选择一个 `layout`。相邻两页可以同一 `layout`；连续三页及以上会得到 `layout_repetition` 提醒，不拦截导出。确需连续对比时写进 design-plan。
- 只锁定目录里的一套。选择器默认只展示六套：`dsh-cartesian`（理性简报）、`ppt169_china_economy_2025_briefing`（数据简报）、`mbb-consulting`（战略备忘）、`operating-review`（经营复盘）、`dsh-engineering-blueprint`（工程蓝图）、`dsh-course-workshop`（课程培训）。`styles/picker.json` 的 `tier` 为 `default` 或 `more` 才会出现在选择器里；`more` 收在「更多模板」。理性简报上的配色变体是 `dsh-signal`、`dsh-monochrome`、`dsh-editorial-forest`、`dsh-soft-editorial`、`dsh-editorial-notebook`，选中后按该变体的参考页来，不另开卡片。`dsh-blue-professional` 版式和示例与理性简报差得较多，留在更多模板。`workshop-teaching` 并入课程培训，不单列。`tier: archive` 和与可见模板重复的别名不进选择器。完整目录仍在 `styles/catalog.json`，说明见 `references/styles.md`。保留锁定主题 token，允许借用论证版式槽并适配当前画布；不直接拼贴另一套主题和绝对坐标。
- 颜色和字体可以整套换成 `styles/themes` 里的主题，或换成用户品牌主题。主题只提供 token，不改页面结构。用户给出主色、辅色和可选标志路径时，生成对比度安全的 token，把路径记在 `theme.logo`；要出现标志时再放一个 `src` 相同的图片。不要写入第三方公司的品牌色或标志。
- 论证版式库有 14 个 960×540 页面（结论、证据树、矩阵、瀑布、趋势、计分、甘特、架构、对照、漏斗、流程、时间线、收束、取舍）。`deck-cli.mjs layouts` 打印每个槽位的 `bounds` 和 `textCapacity`。`deck_check` 会认出这些 `layout` id。它们可在锁定主题 token 下提供结构槽位，适配后必须预检。
- 参考页路径写在 `styles/catalog.json` 的 `deck` 字段。DSH 首批里 `dsh-cartesian`、`dsh-editorial-notebook`、`dsh-soft-editorial` 在 `styles/<id>/deck.json`，另有 `deck.en.json`。`dsh-course-workshop`、`dsh-engineering-blueprint` 和仍随安装包提供的新增各套，参考页位于独立 `styles/examples/imported/<id>/`，原导入页保留。已归档成稿的 deck、PDF 和逐页预览在 `styles/_archive/`，安装包不含这个目录；catalog 里的路径指向归档位置，原文没有改写。请按 catalog 的 `deck` / `deckEn` 路径读取。仍展示的 ppt-master 风格指向 `styles/examples/` 里的官方成稿。事故复盘留在更多模板，经营复盘是默认套，产品发布已归档；这些成稿里的第三方标识只供对照版式，新稿换成用户自己的文字、数据和标志。沿用参考页的坐标和页眉页脚，替换成用户的文字和数据。几何改动之后必须重新预检。图示标签可以小于 16 pt，以该套 `design.md` 为准，不要统一放大。结构版式在 `layouts/`。新稿不要写 `profile: example`，那只用于已经出版的示例页。不要把一份样例的正文写进另一套模板来“合并”。
- catalog 指向的十六套 DSH 参考页中英文都能直接通过预检。换成用户句子后若末行只剩一个字，重排句子，不要为了通过而缩小字号，也不要把文本框加宽到撞上邻列。
- 在会话 `dataFolderPath` 保存 `design-plan.md` 和 `deck.json`。它们是会话材料，不默认交付。
- 默认规划完成后继续生成。只有用户明确要求先审方案时才停。恢复会话时读取磁盘上的计划和 deck，**不得自动重新选风格或把视觉检查次数清零**。

## 预检和导出

DSH 参考页和多数 16:9 成稿的画布是 **960×540 pt**，也就是 13.333×7.5 in、33.867×19.05 cm。Morph 的幻影对象在 16:9 页上仍然要留在 33.867 cm 的右缘之外。版式家族还可以是 768×576、810×810、810×1440 或 931.5×1245。示例成稿还可以是 A4（930×1315.5）以及横幅等自定义尺寸，两边都要落在 200–2000 pt。用哪一套，画布就用哪一套的尺寸。

```text
"$CRAFT_BUN" "<skill>/engine/deck-cli.mjs" layouts
"$CRAFT_BUN" "<skill>/engine/deck-cli.mjs" check "<dataFolderPath>/deck.json"
"$CRAFT_BUN" "<skill>/engine/deck-cli.mjs" screenshot "<ppt-output.json 的 path>" --out "<dataFolderPath>/slides" --pages <页数>
```

从 `CRAFT_BUN` 取得应用附带 Bun 的绝对路径，用参数数组调用。`<skill>` 是本技能的绝对路径。`--platform` 按用户机器选择 `mac`、`win` 或 `linux`。

标准输出是一行 JSON。退出码 0 是通过，2 是 `needs_revision`，1 是文件或用法错误。`needs_revision` 时不写 PPTX。一次看完 `issues` 里的全部问题，按 `pageId` 和 `elementId` 修改后再查。溢出时整理换行或几何、换版式、拆页；不删除限定条件，不把整页栅格化。

每写完一页就保存 `data/deck.json`（可只含已完成页）。应用会按已保存的页增量导出唯一一份用户可见的 PPTX，并用平时的 Office 协同预览打开这份真实文件。没有工作目录时，文件写在会话文件夹，出现在会话文件里；指定了工作目录时，只写在该目录。文件名来自 deck 标题，不叫 `deck.pptx`。绝对路径记在 `data/ppt-output.json` 的 `path`。不要自己再写或复制第二份 PPTX，也不要把 PPTX 放进 `dataFolderPath`。第一页写出之前预览保持加载。元素 `id` 会写成 PPTX 形状名，OfficeCLI 用 `/slide[n]/shape[@name=元素id]` 点到同一元素。截图仍写 `data/slides/slide-01.png` 起（页码从 1 开始，两位数字），用上面的 `screenshot` 命令打到已导出的那一份文件，供逐页视觉检查。用户点名改某页版式或叙事时，只重写点名的页，其余页保持不变，然后再 `deck_check` 和截图；仅改文字或数据仍走 `office_edit`。预览里点选后的修改走 OfficeCLI。

用户上传的自定义模板存在用户数据目录的 `ppt-templates/custom-…/`。PPTX 以 `source.pptx`、`theme.json`、`slots.json`、`previews/` 和 `project/` 为准。`deck.json` 上传以同目录的 `deck.json`、`project/` 和几何预览为准。不要再去找临时上传路径。`previews/` 里优先是逐页真实画面（PNG）；渲染失败或上传的是 deck.json 时才是几何 SVG。选中个人模板后调用 `ppt_template_create_project`，把 `project/` 复制到工作区新目录。源模板和原 PPTX 的 sha256 必须保持不变。在副本上按内容关系选页、用用户材料重写，然后 `deck_check` 和 `office_render`。每次最多读 12 页参考，参考页不能当输出背景。样例页只写返回的 `sampleExtensionDir`。诊断里的「不支持」要告诉用户人工复核。母版连续使用同一版式只提醒，不拦截。

截图失败但 PPTX 已写出时，`screenshots.available` 为 `false`。这时 G4 不能通过。看页优先用 `office_render`，不要改用 OCR。

## 外来稿先理解，再动手

任何外来稿在改版式、换风格或「把逻辑理顺」之前，先把这些写进 `design-plan.md`：每页主张、叙事哪里断了、对象清单、母版或品牌元素（logo、页脚、装饰）、可编辑性诊断。然后把路由写成 `import_rebuild`，用 `ppt_import` 得到新工程。只改几个字仍是 `office_edit`，其他页字节不变。路由写在 design-plan 的 `路由:` 一行。宿主发现定点修改路由下又去整套导入时，会提醒而不是把会话判失败。

## 模板配图

页面备注或 `imageSlots` 里的 `dsh.template-images/v1` 是声明式合同：`style` 必须有 medium、palette、lighting、tone、textTreatment、continuity 六项；每页最多 16 个槽。`contextual-scene` 优先用户图片，没有再调用 `image_generate`（`purpose=presentation`，比例用槽位的 `aspectRatio`，`style_context` 写入六项原文，图片内文字数量为 0）。同一 `reuseGroup` 复用。`provided-portrait` 只用用户的人物照片。`native-graphic` 用已核实数据画原生图表。替换 `src` 时保持边界和遮罩。没有生图提供方时保留占位并说明，占位不是成品。标题、正文和数据保持可编辑。配完用 `office_render` 看主体是否被裁、留白和整稿风格，最多 3 轮。建议稿在 `image-slots.proposed.json`，`confirmed` 仍是 false 时不要写回模板。

十六套随包模板的 `deck.json` 不覆盖。图片槽样例只在 `styles/image-slots.extension.json`。个人模板上的图片位由复制出的工程给出建议合同，等用户确认。

## 外部图表技能

图表默认一律是原生可编辑图表。用户没有在这条需求里点名图表技能时，不要调用任何图表技能，也不要询问要不要换。

只有用户明确点名某个已经安装的图表技能时才调用它，例如「用 lieflat-charts 画图」或「图表用某个技能」。只写「图表」或 “chart” 并不算点名。生成提示里列出的已安装图表技能只说明本机有哪些可以响应点名，列表本身不是使用许可。

点名且该技能已安装时：

- 只调用用户点名的那一个技能来画每一张图。不要把它的代码、模板或素材复制进仓库，也不要改用它的整套演示或报告模式代替这份 deck。
- 套用当前模板的主题色。技能支持 custom 色板时，把纸色、墨色、辅助色、强调色和品牌色交给它自己的色板字段。
- 优先要独立 SVG。技能给不出 SVG 时，再要长边至少 1600 px 的 PNG。
- 按版式槽位的 `bounds` 放成 `image`，`fit` 为 `fill`，并写 `chartImage`：`skill`、`format`（`svg` 或 `png`）、`data`（原始数据表）。同一张表写进该页 `notes`，导出后成为 speaker notes。
- 技能报错或这次生成里没有完成时，这张图改回原生图表，并在会话 `data/chart-fallback.json` 记下 `{"fallbacks":[{"skill":"<slug>","reason":"error"|"timeout","page":页码}]}`。结果卡片会提示已退回原生图表。

点名的技能没有安装时，同样改回原生图表，并在 `chart-fallback.json` 记下 `reason` 为 `missing`。不要改叫另一个图表技能，也不要询问。

### G4 检查范围（O2）

新稿、整套换皮或没有有效既往视觉证据时检查全部页。局部文字/单页/指定页版式修订，仅重新截图并原生读图受影响页；记录页码、修改内容和沿用的未改页证据。主题/字体等全局修改检查全部页；页序重排检查受影响的叙事顺序与页面。无法证明未改页未受影响时扩大到全量。

已知总页数 N，局部截图使用 `deck-cli.mjs screenshot <pptx> --out <dataFolderPath>/slides --pages N --only-pages 2,4`，列表为从 1 开始的实际页码，保持原文件名，不重编号、不覆盖无关截图。直接 CLI 定点修改也可逐页调用 OfficeCLI screenshot。截图不是视觉验收，仍需 Read 或 call_llm attachments 原生读图。

后文的每轮检查均指本节确定的范围。首次与至多两次修复复查共用原三次上限，不因范围缩小、换会话或换 renderer 而重置；检查后修改使对应页证据失效，不允许复用过期截图宣称通过。

## 质量门：G1 → G5

| 门 | 必须通过的内容 |
|---|---|
| G1 故事/页序 | 用户材料、逐页主张、实际页数和顺序一致。 |
| G2 设计/排版 | 只锁定一个风格；`deck_check` 没有问题；字号不低于该风格的下限。预检不是视觉检查。 |
| G3 保存/读回 | OfficeCLI `validate` 没有未解决的错误或警告。文字、图表数据、单位、备注、来源和页序读回正确。 |
| G4 逐页视觉 | 跟随 `<session_state>` 的 `imageInput`。`enabled`：检查范围内每一页用 Read 或 `call_llm` 的 `attachments` 看截图。`unavailable`：写明 `image_capability_mismatch`，G4 不算通过。不要改用 OCR。接触表不能代替逐页。 |
| G5 关闭/重开 | 最终绝对路径上的文件重新读过，页数和内容正确。 |

G4 **整项任务最多 3 次：首次 + 至多 2 次修复复查**。更换渲染器、审查者、会话或 pitch/Morph 都不重置次数。任何检查之后的修改，都必须还有剩余的一次视觉检查盖住。第三次仍有缺陷，或没有可用截图：写明页码、问题和阻塞，不能声称可交付。

G4 跟随当前模型的读图能力，而不是固定改走 OCR。`imageInput: enabled` 时用 Read 或 `call_llm` 的 `attachments` 看受影响范围内每一页；`imageInput: unavailable` 或返回 `image_capability_mismatch` 时停下来说明 G4 未通过。两种结果都不要用 Swift/Vision（`VNRecognizeTextRequest`）、tesseract，或名为 `Swift: OCR` / `OCR New Pages` 的步骤代替看图。

Do not OCR or run a Swift/Vision/tesseract script in place of image input. For slide visual QA, report image_capability_mismatch and leave G4 blocked.

## 交付

- 用户要求 Morph 或 3D 时，只增加对象配对和运动检查，不另做一套静态设计。静态截图不能证明播放效果。
- 中间文件放在 `dataFolderPath`（`deck.json`、截图、检查结果）。可见的 PPTX 只有 `ppt-output.json` 里的那一份：没有工作目录时在会话文件夹，有工作目录时在该目录。不要复制第二份，也不要覆盖同目录里无关的已有文件。
- 只交付这一份 `.pptx` 和一段事实说明。许可与适配来源见 [ATTRIBUTION](ATTRIBUTION.md)。

### 外来稿先读 brief，再决定要不要导入

没有匹配 deck 的外来 PPTX 必须先执行 [OfficeCLI 外来稿流程](../officecli/references/external-ppt-brief.md)，生成并完整读取有损结构 brief，校验源文件哈希后再选路由。页主张候选需对照原生截图与用户素材复核。源文件变化后重建 brief。

改版式或整套换风格时，用下面的命令把原件导入到新目录。不要把输出目录放进 `styles/` 或 `ppt-templates/`，也不要覆盖原 PPTX。

```text
"$CRAFT_BUN" "<skill>/engine/deck-cli.mjs" import "<source.pptx>" --out "<dataFolderPath>/import-<name>"
```

标准输出是一行 JSON。`deck` 指向新的 `deck.json`，`diagnostics` 是逐页覆盖（保真 / 近似 / 保留不可编辑 / 不支持）。`preview.status` 为 `unavailable` 时，渲染路径还没选定，不能把缺预览说成导入失败。带 `retained` 的元素不能当 `{page, elementId}` 修订目标。改完可编辑对象后，`deck-cli.mjs render` 会把旁边的 `retained.json` 按原位置贴回导出文件。
