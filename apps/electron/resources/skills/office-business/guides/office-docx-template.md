# Word 案例填模板

本指南只用于**已选 Word 案例且该案例有原生 `sampleFile`** 的会话。版式来自案例 DOCX，编辑工具是宿主的 `office_template` / `office_template_write`，交付门是宿主 7 项版式守卫。

不要加载完整 `officecli-docx`。不要使用 python-docx、openpyxl、pandas、LibreOffice Kit 或 `present`。不要把 `officecli-pptx` 或 `ppt-design` 当作本次成稿技能。

## 默认顺序

1. 调用 `office_template(template_id=当前案例 id)`。宿主把案例复制到会话私有参考目录（校验 sha256，不改捆绑原件），并**一次**返回全部 `editable_paragraphs`（段落 / run ID、字体、字号、可否删除）。
2. 只用当前用户材料规划编辑：`replacements` 替换示例事实，`additions` 用 `style_from` 继承已有段落样式，`row_additions` 克隆表格行，`removals` 只删 `can_remove=true` 的段落。
3. **一次**调用 `office_template_write` 写出新的工作区 DOCX。宿主在同一次写出里跑 7 项版式校验；计划不合格则不写文件，按返回诊断改计划后再写。
4. 业务自检按案例调用（如纪要的 `office_business` / `validate-minutes`）。这是内容结构检查，不是视觉环。
5. `submit_answer` 交付。宿主再跑一次 Word 版式守卫；失败则返回 `needs_revision`，按诊断修一轮后再交。

目标工具轨迹：`office_template` → 一次 `office_template_write` → 交付。中间不要再叠 OfficeCLI 增量改写。

## 版式从模板来

- 字体、样式、主题、页面几何、边框、绘图框、页眉页脚都来自案例原件。填写内容，不要重建版式。
- 案例原件只读。成品必须是工作区里的新文件。
- 模板中的示例姓名、机关、数字、日期全部换成当前材料；没有的事实写「待确认」或「待补充」，不编造。
- 用户中途上传的文件是材料，不是新的案例模板。

## 视觉核验按需（S1a）

`office_template_write` 已成功且宿主守卫未报错时：

- **不要**再跑 OfficeCLI `set` / `batch` / `add` 抛光。
- **不要**默认 `office_render`、`officecli view screenshot` 或 contact-sheet。
- **不要**把截图或视觉环当成交付前置。预览看产品内置 Office 预览。

仅在下面情况才做视觉或改走 OfficeCLI：

- 用户明确要求检查排版、截图或重做结构；或
- 宿主返回 `needs_revision`（版式未过）之后的修复轮。

不要 `officecli load_skill word`，除非守卫失败且必须改结构，或用户要求从零重做。

## 交付

成品由 Selection 文件卡片交出。未知项保留待确认 / 待补充。不要用 OCR。不要覆盖案例目录。
