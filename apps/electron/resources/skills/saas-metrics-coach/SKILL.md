---
name: 经营指标
description: "核对收入、MRR、客户留存、增长假设和计算口径，配合 OfficeCLI xlsx 制作经营分析。"
---

# saas-metrics-coach

本文件是阶段 05 注册的经营指标入口。完整方法、公式分册和计算脚本在阶段 09 写入本目录；分册只在需要时读取。

先核对材料里的口径：收入、MRR、客户数、流失、扩张和毛利各自指哪一段时期。缺字段时列出缺失项，不用相邻单元格的缓存值填空。Quick Ratio 已有 TypeScript / Bun 实现，其余计算器留到阶段 09。

## 文件交付

当前用户材料提供事实，所选案例提供结构和版式。制作 Word 时配合 OfficeCLI 的 officecli-docx（命令 `officecli load_skill word`），制作 Excel 时配合 officecli-xlsx（命令 `officecli load_skill excel`）。不要调用 Python，不要使用 python-docx、openpyxl 或 pandas。

计算与校验使用阶段 03 的 TypeScript / Bun 实现。Quick Ratio 的入口是 `packages/office-business-runtime` 的 quick-ratio CLI；其余脚本在阶段 07 和 09 接入。不要使用 `load_workspace_dependencies`。

预览、PDF 和公式重算按阶段 02 已定的原生优先顺序选择步骤，宿主未接上时说明边界，不要假装已经导出：
- PDF：已安装的 OfficeCLI exporter；否则在装了 Word 的 Windows 或 macOS 上用 Word 导出；再不行用 OfficeCLI HTML 加 Electron printToPDF。测试才用 TypeScript 分页替身。
- 预览：Windows 且装了 Word 或 PowerPoint 时用 OfficeCLI `view screenshot --render native`；否则用 Electron capturePage。
- 公式：OfficeCLI 把 computedValue 写回 cachedValue。探测到 Excel 时再跑 CalculateFull 复核。只有没求出的格子才用 TypeScript 补算。

Excel 在 officeRender.recalc 完成核对前，不要把缓存值当成已重算结果。交付文件写在工作区副本上，不覆盖案例原件和原始模板。不要用 OCR。
