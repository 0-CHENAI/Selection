# 阶段 10：外来 PPTX → deck.json

对应 [#713](https://github.com/0-CHENAI/Selection/issues/713)。路线按已拍板的 [ADR](../adr/ppt-pptd-features-on-deck.md)：deck.json 是唯一工程真相；写不进 schema 的对象用路线 B 按原位置保留；路线 C 只做定点修改。

## 入口

| 用途 | 位置 |
| --- | --- |
| 转换 | `apps/electron/resources/skills/ppt-design/engine/import/pptx-to-deck.ts` 的 `importPptx` |
| 工程目录 | 同目录 `project.ts` 的 `importPptxFile`。写出 `deck.json`、`diagnostics.json`、`retained.json` 和 `assets/` |
| 命令 | `deck-cli.mjs import <file.pptx> --out <新目录> [--max-slides N]` |
| 导出贴回 | `deck-cli.mjs render` 在 `deck.json` 旁边有 `retained.json` 时，把保留片段贴回 |
| 预览 | `import/preview-port.ts`。未传入实现时返回「阶段 02 尚未选定渲染路径」 |

工具名是 `ppt_import`。不使用 `pptd_` 前缀，不移植演示引擎，不调用 Python 或 LibreOffice Kit。

## 验收命令

```bash
bun test apps/electron/resources/skills/ppt-design/engine/import/pptx-import.test.ts apps/electron/resources/skills/ppt-design/engine/pptx-import-poc.test.ts
```

固定案例在测试里用生成的 OOXML 包跑通：20 页母版装饰、组合、合并单元格、规则表；第 5 页改成左右两栏后只有该页内容坐标变化；整套换成 `dsh-blue-professional` 主题后导出通过 check；SmartArt 与视频使用 ADR 附录 B 的句子；覆盖类别含 dsh 的六类页面对象。五套已发布模板各导出首页再导入。原件 sha256 与 `styles/dsh-cartesian/deck.json` 不变。

## 已知限制

- 仓库没有客户 PPTX。企业 / 咨询 / 国企稿用结构样例代替，真稿对照留到 #717。
- EMF / WMF 不解码，按路线 B 原样贴回。
- 合并单元格没有 `rowSpan` 字段，整表保留不可编辑。
- 预览和 PDF 不在本阶段生成。
- 导入页不是论证版式槽，左右对比只重排 `bounds`，`layout` 保持 `free`，避免 check 按目录几何判失败。
