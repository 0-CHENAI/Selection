# 从故事线到可交付 PPTX

此流程只适用于新建或整套重设计。既有文件局部编辑保留原设计，遵循 [Selection 覆盖规则](../../officecli/ppt-selection-override.md)。所有会话材料使用 `<session_state>` 的绝对 `dataFolderPath`；下文路径是需要替换的参数，不是固定目录。

## 1. 形成一个完整故事

先读用户给定材料，不用模板示例填补事实。记录受众、演讲/阅读场景、目标、核心结论、篇幅、语言、已有品牌和交付位置。区分事实、估算、假设、建议；事实有出处，假设显式标注。缺失的关键数据不能用漂亮数字代替。

在 scratch 的 `design-plan.md` 写一份计划：

- 简报：这套演示要让谁理解什么、作何决定。
- 故事线：结论/问题 → 支持证据 → 方案/权衡 → 下一步；可按叙事调整，不强塞固定页序。
- 逐页表：稳定计划页 ID（如 P01）、顺序、唯一主张、完整可见内容、证据/来源、备注、语义关系、layout、节奏角色。
- 节奏角色：`anchor`（冲击/核心结论）、`dense`（证据/分析）、`breathing`（章节/收束）。相邻页不同 layout；每 3–4 页安排一次有真实消息的冲击或留白页，不靠复制封面凑配额。

计划页 ID 留在计划/锁内，**不加入严格 JSON**。选择 [布局](layouts.md) 的理由是关系：比较、时间、顺序、组成、引用等，不是“这个模板好看”。没有图片时可选择 `image-text` 的语义面板；不得凭空宣称图片存在。

## 2. 方案细化与锁定

默认独立完成计划后继续执行。若用户明确说“先给我方案确认”，先展示同一个完整计划，按反馈增量修改；此时不把未批准方案当作生效锁，不提前生成。批准后才投影执行锁，不再重复询问已确定方向。

在 `spec-lock.md` 记录可核对的实际值：

| 锁定域 | 内容 |
|---|---|
| 沟通与来源 | 受众、目的、核心结论、语言、来源路径/URL、尚未满足的前提 |
| 设计 | 三选一 style；33.867 × 19.05 cm；该 style 的色彩角色；真实安装的标题/正文/CJK 字族 |
| 排版 | 实际角色字号与 floor；标题 36、正文 18、来源 12 pt 为配方底线，无自动缩字 |
| 结构 | 每个稳定页 ID → 顺序、layout、节奏角色、内容/来源；与计划逐页对应 |
| 执行 | spec 与 scratch PPTX 绝对路径、用户最终绝对路径、OfficeCLI 版本/路径、字体依赖 |
| 状态 | 当前候选、已通过门的证据、G4 已消耗次数、每次发现/修复、尚存阻塞 |

据计划写 [严格 spec.json](spec-schema.md)，逐字核对主张、数字、否定词、条件和来源。锁不是第二套可随意变化的设计；JSON 不接受任意视觉字段，默认配方不能因换页而漂移。

**反馈/修复顺序：**先读磁盘原件 → 改受影响计划及锁 → 同步 JSON → 生成新的候选名 → 重做受影响门。全局字体或风格变更要更新所有受影响页；只改一页不能重新生成整份故事或抹掉已确认决定。溢出需要拆页时先更新页序、节奏和稳定 ID 映射；用户限页数与无损内容冲突时明确报告。

**中断恢复：**读取已有计划、锁、spec、候选和审查记录，核对哪一个是最新可信状态。完整计划可重建丢失的派生锁，孤立锁不能替代缺失事实；不自动把设计改回默认，不自动重跑所有步骤，不重置视觉次数。无法证明历史次数时不能凭空声称尚有三次。

## 3. 配方生成：只是未审查候选

加载官方语法指南后重新读应用覆盖规则。OfficeCLI 调用始终设置进程环境 `OFFICECLI_SKIP_UPDATE=1`；不要通过一次更新改变已锁版本。

```text
"<absolute-CRAFT_BUN>" "<skill>/scripts/compose.ts" --spec "<dataFolderPath>/spec.json" --out "<dataFolderPath>/deck.pptx"
```
从环境 `CRAFT_BUN` 取得应用附带 Bun 的绝对路径，以参数数组调用。POSIX 可用 `"$CRAFT_BUN"`，PowerShell 可用 `& $env:CRAFT_BUN`；不假设 PATH 有 `bun`，不下载运行时。
可选 `--officecli "<absolute-bundled-binary>"` 与 `--font-cjk "<installed-family>"`。默认风格为标题/正文分别选择字体；不要为方便把 fresh-editorial 的衬线标题统一覆盖成无衬线。脚本只使用 OfficeCLI 创建原生文本、形状、图片与数据图表，不运行上游 SVG/Python 导出链。

输出只能在 spec 声明的 `dataFolderPath` 内且不能覆盖已有文件。再次生成选择 `deck-repair-1.pptx` 等新名，保留可追溯候选。`GENERATED_UNREVIEWED` 只表示生成，不代表任何门已通过。编译器拒绝容量/字段等错误时先修正计划和规格，不能通过删事实、截断文本或降低字号逃避。

## 4. 唯一 G1–G5

以下 OfficeCLI 示例每次使用同一个实际候选绝对路径，且均设置上述环境变量。语法变化时读 `officecli help`，不猜属性。

```text
officecli view "<absolute-deck.pptx>" outline
officecli view "<absolute-deck.pptx>" annotated
officecli view "<absolute-deck.pptx>" issues
officecli validate "<absolute-deck.pptx>"
officecli view "<absolute-deck.pptx>" text
officecli get "<absolute-deck.pptx>" "/slide[1]" --depth 1 --json
officecli query "<absolute-deck.pptx>" "chart" --json
```

- **G1**：实际 outline 与计划逐页比对消息、页数、次序，证据足以支持主张。
- **G2**：字体、风格、布局、字号和内容适配符合锁；annotated/issues 为诊断，不是视觉证明。缺字、溢出、意外越界、低对比不能放行。
- **G3**：保存产物通过 validate；文字、图表系列/数值/轴、备注、来源、关系与源数据读回一致。无未解决警告、UNSUPPORTED、部分变更或读回差异。失败变更先读回检查，不盲重放。
- **G4**：执行 [真实逐页审查](visual-review.md)。首次 + 最多两次修复检查，整项任务共享计数。
- **G5**：G1–G4 对最终保存状态通过后关闭、重开/读取并确认最终路径。不要另起一套 pitch/Morph 的“第六门”。

`get/query --json` 的结果通常在 `data.results`；以实际记录为准，不照搬旧示例的字段路径。读取原始 JSON 或使用应用附带 Bun，不依赖 jq、Python、shell 循环或用户安装软件。对象名称/字段不存在不是成功空结果。

## 5. 最终路径与交付

在 scratch 完成 G1–G4 后，用宿主文件复制能力或 Bun `Bun.write(finalPath, Bun.file(reviewedPath))` 将**同一份已审查字节**复制到用户要求的最终绝对路径；未指定则有效工作目录。预先检查目标，不能默默覆盖用户已有文件。若用户明确要求替换现有交付物，遵循该授权并保留本次审查证据。

对最终路径执行 G5：`officecli close "<absolute-final.pptx>"` 释放已有会话，再用 `officecli view "<absolute-final.pptx>" outline` / `text` 重新读取保存件，确认路径存在、页数/内容正确，最后 `officecli close "<absolute-final.pptx>"`。孤立候选模式自动保存/关闭时尊重运行时边界，不依赖跨调用驻留状态。

任何会改变文档内容的最后操作必须发生在剩余的 G4 之前；复制未改变字节不另算视觉修复。交付实际 PPTX，简述真实完成情况与已知字体/播放限制。G4 阻塞或第三次仍有缺陷，只能披露阻塞和未就绪状态，不把中间文件包装为完成品。
