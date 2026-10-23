---
name: ppt-design
description: "制作新的 PPT、PowerPoint、presentation、幻灯片或整套演示文稿重设计：声明式 960×540 页面、论证版式、deck_check 全量预检与 PptxGenJS 原生导出。不用于现有 PPT 的局部文字、数据、图片或格式修改。"
---

# PPT Design

## 入口与边界

- 仅在**新建演示文稿 / 用户明确要求整套重设计**时使用本技能。
- 局部编辑、转换已有文件：转交 [OfficeCLI](../officecli/SKILL.md)，先检查，保留原设计及未请求修改的内容；不要用参考页重建。
- 本技能拥有故事线、风格锁、声明式页面和 `deck_check` → `deck_render` 闭环。导出引擎是捆绑 Bun 上的 **PptxGenJS**（原生可编辑 PPTX）。OfficeCLI 继续负责已有 PPTX 的编辑、校验、读回和截图。
- 不安装 Python、不引入新的重型运行时、不下载或自更新 OfficeCLI。不复制第三方品牌标志。

## 先读，再执行

1. 规划故事线时读 [工作流](references/workflow.md)；选择风格时读 [风格概览](references/styles.md) 和所选 `styles/<id>/design.md`，不要一次加载全部参考页。
2. 选定风格后读取该套 **最多 12 页**参考页的完整几何（`styles/<id>/pages/*.json` 或 `deck.json`）：元素 id、bounds、textCapacity。按用户材料改写文案，必要时微调坐标；不要从空白画布重发明网格。
3. 锁定字体与正文时再读 [中文排版](references/typography.md)。生成前读 [规格契约](references/spec-schema.md)。
4. 已有 PPTX 的编辑：先读 [OfficeCLI 路由](../officecli/SKILL.md)，执行 `officecli load_skill pptx`；仅按请求追加 pitch-deck / morph-ppt / morph-ppt-3d。
5. **所有指南加载后**读 [Selection 覆盖规则](../officecli/ppt-selection-override.md)，再做文档操作；后来加载指南时重新应用覆盖规则。

`officecli help` 决定 OfficeCLI 语法。官方指南不再拥有另一套设计、手工网格或 QA 流程。
所有 OfficeCLI 调用均设置 `OFFICECLI_SKIP_UPDATE=1`。

## 从故事线到设计锁

- 从用户材料提取受众、目的、核心结论、事实/假设、来源、页数和交付位置；不捏造数据、日期、讲者或资产。
- 一页一个主张。版式按**论证关系**选择（结论、证据树、矩阵、瀑布、趋势加标注、计分表、甘特、架构、案例对比、漏斗），不要把所有信息塞进等大卡片。
- 相邻页不重复同一 layout。每 3–4 页安排一次有内容依据的冲击或收束页。
- 锁定 `swiss-signal` 或 `navy-brief` 中一套；字体、色彩和几何沿用该套 `design.md` 与参考页，不能混搭。
- 在会话 `dataFolderPath` 内保存 `design-plan.md`、`spec-lock.md` 和 `deck.json`。
- 默认完成规划后继续生成；只有用户明确要求先审方案时才停。反馈先改计划与锁，再改 deck 并重新 check。
- 恢复会话读取磁盘状态，**不得自动重新选风格、重置锁或视觉次数**。

## 声明式页面与闭环

画布 **960 × 540 pt**（16:9，合 13.333 × 7.5 in / 33.867 × 19.05 cm）。每个元素带 `bounds: [x,y,w,h]` 与文本的 `textCapacity`。主题色与字体走 token，不写死另一套网格。

```text
"<absolute-CRAFT_BUN>" "<skill>/scripts/deck.js" check --deck "<dataFolderPath>/deck.json"
"<absolute-CRAFT_BUN>" "<skill>/scripts/deck.js" render --deck "<dataFolderPath>/deck.json" --out "<dataFolderPath>/deck.pptx" --folder "<dataFolderPath>" --preview-dir "<dataFolderPath>/preview"
```

从环境 `CRAFT_BUN` 取得应用附带 Bun 的绝对路径，以参数数组调用。不假设 PATH 有 `bun`。打包入口是自包含的 `scripts/deck.js`（内联 PptxGenJS）。仓库开发可跑 `scripts/deck.ts`；改引擎后需重新 `bun build` 出 `deck.js`。

- `check` 一次报出全部问题：越界、内容重叠、超容量（含 CJK 宽度）、对比度、孤字、字面 `\n`，定位到 pageId/elementId。
- `render` 在 check 失败时返回 `needs_revision`，不写 PPTX。通过后写出原生可编辑文本、形状、图片和图表。
- 预览 PNG/SVG 供自查。OfficeCLI `view screenshot` 仍可用于已有或导出后的 PPTX。
- 溢出先改换行或几何，再换版式或拆页；不缩字、不删限定条件、不把整页栅格化。

## 唯一质量门：G1 → G5

| 门 | 必须通过的内容 |
|---|---|
| G1 故事/页序 | 材料→逐页计划→deck 页序、主张、证据一致。 |
| G2 设计/排版/适配 | 一套风格；`deck_check` 无问题；字号不低于该套 design.md。 |
| G3 保存/结构/读回 | PPTX 存在；文字、图表数据、备注、来源读回正确。可用 OfficeCLI `validate` / `view` 辅助。 |
| G4 真实逐页视觉 | 打开每一页预览或 OfficeCLI 截图；不能用 JSON 或联络表代替。 |
| G5 关闭/重开/路径 | 最终路径存在、页数正确。 |

G4 **整项任务最多 3 次：首次 + 至多 2 次修复复查**。第三次仍有缺陷或无法渲染：报告阻塞，不能声称可交付。

## 交付

- 只交付实际 `.pptx` 与简短说明。中间 deck/预览留在 `dataFolderPath`。
- 许可与来源见 [ATTRIBUTION](ATTRIBUTION.md) 和 [LICENSE](LICENSE)。
