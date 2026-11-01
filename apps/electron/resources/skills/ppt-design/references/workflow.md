# 从故事到文稿

1. 从用户材料写出受众、目的、一个核心结论、每页主张、事实和假设、来源、页数。不编造数字、日期、讲者或标志。
2. 只锁定一个风格。读它的 `design.md`，再按 `styles/catalog.json` 的 `deck` 字段读参考页。需要结论、证据树、矩阵、瀑布、趋势、计分、路线、架构、对照、漏斗、流程、时间线、收束或取舍时，用 `deck-cli.mjs layouts` 里的论证版式，保留槽位几何。DSH 另有英文 `deck.en.json`。选择器默认六套，更多模板在 `styles/picker.json` 的 `moreOrder`。归档成稿的路径在 `styles/_archive/`，安装包里没有这些文件；找不到时说明已归档，不要改用另一套的正文去填。仍展示的 ppt-master 参考页在 `styles/examples/`，画布以该文件的 `canvas` 为准。带第三方标识的成稿只对照版式，换成用户自己的内容。按参考页的坐标改文字和数据；需要挪动时改 `bounds`，不要另起一套网格。图示标签沿用参考页的字号。主题可以整套替换颜色和字体，见 [风格索引](styles.md)。理性简报的配色变体按该变体自己的参考页，不改理性简报原文。用户给出主色和辅色时，生成对比度安全的品牌主题，不要手写一组未检查的色值。新稿不要写 `profile: example`。
3. 把完整 deck 写到会话 `dataFolderPath` 的新文件，例如 `deck.json`。参考页的虚构店名和数字不要留在正式稿里。图表默认是原生可编辑图表。只有用户在这条需求里明确点名某个已安装的图表技能时，才调用该技能：套用模板主题色，优先 SVG，否则长边至少 1600 px 的 PNG，按槽位 `bounds` 放成带 `chartImage` 的图片，并把原始数据表写入该页备注。技能失败、超时或没有安装时改回原生图表，并写入 `data/chart-fallback.json`。用户没点名时不要调用，也不要询问。
4. 运行 `deck-cli.mjs check`。`needs_revision` 是正常反馈：按文件、页码和元素 ID 一次改完再查，不要重复检查没改过的页。提醒（含连续同版式）不阻止导出；有 error 时文件不能标成就绪。不要为了通过而把字号降到风格下限以下。
5. 不要把 PPTX 写进 `dataFolderPath`。应用会按已保存的 `deck.json` 导出唯一可见的 PPTX：没有工作目录时写在会话文件夹，有工作目录时写在该目录。文件名来自 deck 标题，路径在 `data/ppt-output.json` 的 `path`。需要截图时对这个文件运行 `deck-cli.mjs screenshot --out <dataFolderPath>/slides --pages <页数>`。
6. 用 OfficeCLI `validate` 这个 path，并用 `view text` 或 `view outline` 读回标题、数字、单位、备注和页序。
7. 新稿用 `office_render` 看全部页；局部修订只看受影响页。整项任务最多 3 轮。先看 `<session_state>` 的 `imageInput`。`enabled` 时看 `office_render` 附上的图片，或用 Read / `call_llm` attachments。`unavailable` 或返回 `image_capability_mismatch` 时，写明 G4 未通过，不要改用 OCR 或名为 `OCR New Pages` 的步骤。预检通过不等于画面成立。

Do not OCR or run a Swift/Vision/tesseract script in place of image input. For slide visual QA, report image_capability_mismatch and leave G4 blocked.
8. 已有稿按 SKILL 的三分标签路由：文字/数据/保母版定点改为 `office_edit`，停止本流程并用 OfficeCLI；版式/叙事/重排为 `deck_revision`，复用现有工程和主题；明确整套换风格才是 `restyle`。

故事、选定的风格、字体平台、预检结果、视觉检查次数和最终路径记在 `dataFolderPath` 的 `design-plan.md`。那是会话材料，不是交付物。只有用户明确要求先看方案时才停在方案；否则规划完成后继续生成。恢复会话时读取磁盘上的计划和 deck，不重新选风格，也不把视觉检查次数清零。

交付物是这一份 `.pptx` 和一段事实说明。计划、deck JSON 和截图留在 `dataFolderPath`，除非用户要这些文件。不要再复制第二份 PPTX。
