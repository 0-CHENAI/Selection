# Selection 3.2 Office 阶段 08 验收记录（#711）

## 范围

- 会话工具 `office_template`、`office_template_write`、`xlsx_recalculate`（`packages/session-tools-core/src/handlers/office-template.ts`，宿主实现在 `packages/server-core/src/services/office-template/service.ts`）。
- Word 版式守卫：7 项检查与 dsh `docx-layout.py` 对拍（`docx-layout.ts`）。写出时跑一次；显式 `submit_answer` 前再跑一次，未通过时把 `needs_revision` 诊断返回模型返工。
- Excel：`xlsx_recalculate` 注册为会话工具，OfficeCLI `computedValue` 写回 → 装了 Excel 的 Windows / macOS 再 `CalculateFull`（失败退回）→ TypeScript 补未求值格子 → checks 或双读 → `visual_review`。改过的含公式工作簿必须在最后一次修改后重算通过才能交付。
- 缺字体提示：`font_warnings` 列出文档用到、本机没有的字体及替代字体。
- 年度经营案例页面设置：A3、宽度一页、打印区域取已用区域，只作用于工作副本。生化实验与港口货运的打印区域保持原样（LinNai 决定）。
- 会议纪要 G6：技能回填 Title 无边框、snapToGrid 关闭、tblGrid 与 tcW 同步、表格精确 14pt 行距、逐页复核项；测试确认新增行动行后这些属性不变。

## 安全

- OOXML 读取：≤5000 个条目，解压后 ≤64MB（声明值与实际值都查），拒绝重名条目和越界路径；XML 拒绝 DOCTYPE / ENTITY，深度 ≤512。
- 案例原件只读：复制时逐文件校验 sha256，复制后再核对选择；Word 输出必须是工作区内的新文件（`wx`）。
- 子进程只带 PATH / HOME / LANG 等白名单环境变量。

## 测试

```bash
bun test packages/server-core/src/services/office-template packages/server-core/src/services/excel-delivery
```

负向用例：删除页脚、改页边距、换字体、删除受保护段落、未重算交付、重算后又改、checks 失败、未读图、空白页。

## 未做 / 待定

- 流式（natural-v1）交付路径不经过守卫，只有显式 `submit_answer` 受守卫约束。
- `validate-minutes` 仍未打进安装包：阶段 03 / 07 的 `installerBundle: false` 约定与 `no-python.test.ts` 禁止安装包引用 `office-business-runtime`，需要 LinNai 决定是否改成会话工具。
- 逐页 PDF 复核依赖 #709 的 `office_render`。
- 原生 `CalculateFull` 与 macOS `system_profiler` 字体列表未在真机验证。
