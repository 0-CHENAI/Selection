---
name: 公文写作
description: "按单位、文种和当前材料起草通知、报告、请示等可编辑 Word。能力对齐公文写作，不照搬外部技能原文。"
---

# gov-doc-writing

本文件是阶段 05 注册的公文写作入口。能力参照外部公文技能，未复用其正文、模板或示例。完整方法在阶段 07 由 Selection 自写后放进本目录；分册只在需要时读取，不要把尚未出现的文件当成已经注入的内容。

起草前先确认文种、主送、事项和材料里已经写明的事实。版式要素对照 GB/T 9704 的常见构件：版头、标题、主送、正文、落款和页脚。没有材料支持的文号、签发人和印章位置标为待确认，不编造。交付前核对结构是否完整、用语是否越出材料、格式是否破坏了案例版式。

## 文件交付

当前用户材料提供事实，所选案例提供结构和版式。制作 Word 时配合 OfficeCLI 的 officecli-docx（命令 `officecli load_skill word`），制作 Excel 时配合 officecli-xlsx（命令 `officecli load_skill excel`）。不要调用 Python，不要使用 python-docx、openpyxl 或 pandas。

计算与校验使用阶段 03 的 TypeScript / Bun 实现。Quick Ratio 的入口是 `packages/office-business-runtime` 的 quick-ratio CLI；其余脚本在阶段 07 和 09 接入。不要使用 `load_workspace_dependencies`。

预览、PDF 和公式重算按阶段 02 已定的原生优先顺序选择步骤，宿主未接上时说明边界，不要假装已经导出：
- PDF：已安装的 OfficeCLI exporter；否则在装了 Word 的 Windows 或 macOS 上用 Word 导出；再不行用 OfficeCLI HTML 加 Electron printToPDF。测试才用 TypeScript 分页替身。
- 预览：Windows 且装了 Word 或 PowerPoint 时用 OfficeCLI `view screenshot --render native`；否则用 Electron capturePage。
- 公式：OfficeCLI 把 computedValue 写回 cachedValue。探测到 Excel 时再跑 CalculateFull 复核。只有没求出的格子才用 TypeScript 补算。

Excel 在 officeRender.recalc 完成核对前，不要把缓存值当成已重算结果。交付文件写在工作区副本上，不覆盖案例原件和原始模板。不要用 OCR。
