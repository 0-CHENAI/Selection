---
name: 工作汇报
description: "按当前记录整理日报、周报、月报和阶段总结，核对交付、数字、风险和下期计划。"
---

# work-report-writer

本文件是阶段 05 注册的工作汇报入口。完整方法在阶段 07 写入本目录；分册只在需要时读取。

按材料里的周期组织已经完成的交付、关键数字、风险和下一步。数字和结论只来自用户材料。材料没有给出的完成率、排名和承诺标为待确认。

## 文件交付

当前用户材料提供事实，所选案例提供结构和版式。制作 Word 时配合 OfficeCLI 的 officecli-docx（命令 `officecli load_skill word`），制作 Excel 时配合 officecli-xlsx（命令 `officecli load_skill excel`）。不要调用 Python，不要使用 python-docx、openpyxl 或 pandas。

计算与校验调用会话工具 `office_business`（安装包内可用，不依赖仓库路径，也不调用 Python）。command 用 validate-minutes、metrics、quick-ratio、unit-economics、data-quality 或 infographic。本仓库里的 `packages/office-business-runtime` CLI 只用于开发对拍。不要使用 `load_workspace_dependencies`。

预览、PDF 和公式重算按阶段 02 已定的原生优先顺序选择步骤，宿主未接上时说明边界，不要假装已经导出：
- PDF：已安装的 OfficeCLI exporter；否则在装了 Word 的 Windows 或 macOS 上用 Word 导出；再不行用 OfficeCLI HTML 加 Electron printToPDF。测试才用 TypeScript 分页替身。
- 预览：Windows 且装了 Word 或 PowerPoint 时用 OfficeCLI `view screenshot --render native`；否则用 Electron capturePage。
- 公式：OfficeCLI 把 computedValue 写回 cachedValue。探测到 Excel 时再跑 CalculateFull 复核。只有没求出的格子才用 TypeScript 补算。

Excel 在 xlsx_recalculate 完成核对前，不要把缓存值当成已重算结果。交付文件写在工作区副本上，不覆盖案例原件和原始模板。不要用 OCR。
