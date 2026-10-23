---
name: ppt-design
description: "制作新的 PPT、PowerPoint、presentation、幻灯片或整套演示文稿重设计。用 selection-deck 声明页、预检和 PptxGenJS 导出可编辑 PPTX，再逐页看截图。不用于现有 PPT 的局部文字、数据、图片或格式修改。"
---

# PPT Design

## 入口与边界

- 仅在**新建演示文稿 / 用户明确要求整套重设计**时使用本技能。
- 局部编辑、转换已有文件：转交 [OfficeCLI](../officecli/SKILL.md)。保留原设计和未要求修改的内容，不要把原文件重写成一套新的 deck。
- 新文稿的页面作者是 selection-deck。导出使用本技能附带的 `engine/deck-cli.mjs`（PptxGenJS）。不要另写 python-pptx，也不要用 OfficeCLI 形状命令从零搭一整套页。
- 导出之后，OfficeCLI 负责 `validate`、读回、截图，以及用户随后提出的定点修改。
- 不安装 Python、第三方 PPT 库或渲染运行时，不下载或自更新 OfficeCLI。本机如果已经有 LibreOffice，截图步骤可以借用；没有也不要安装。

## 先读，再执行

1. 规划时读 [工作流](references/workflow.md)。选定风格前只读 [风格索引](references/styles.md)，然后只读那一套的 `design.md`。中文参考页是 `deck.json`，英文参考页是 `deck.en.json`。
2. 写页面时读 [版式](references/layouts.md)、[排版](references/typography.md) 和 [格式](references/schema.md)。
3. 看截图前读 [逐页视觉检查](references/visual-review.md)。
4. 先读 [OfficeCLI 路由](../officecli/SKILL.md)。导出后的检查执行 `officecli load_skill pptx`；仅当用户要求募资叙事或跨页动画时，再追加 pitch-deck / morph-ppt / morph-ppt-3d。
5. **所有指南加载后**读 [Selection 覆盖规则](../officecli/ppt-selection-override.md)，再做文档操作。后来又加载指南时，重新应用覆盖规则。

`officecli help` 决定 OfficeCLI 的命令语法。所有 OfficeCLI 调用设置 `OFFICECLI_SKIP_UPDATE=1`，使用应用随附版本。

## 从故事线到页面

- 从用户材料提取受众、目的、核心结论、事实和假设、来源、页数。不捏造数据、日期、讲者或标志。
- 一页一个主张。先写有顺序的故事，再为每页选择一个 `layout`。相邻页不重复同一 `layout`。
- 只锁定目录里的一套。DSH 五套是 `dsh-cartesian`、`dsh-course-workshop`、`dsh-editorial-notebook`、`dsh-engineering-blueprint`、`dsh-soft-editorial`。ppt-master 转入的十四套是 `academic-research`、`consulting-decision`、`creative-pitch`、`duty-manual`、`incident-postmortem`、`investor-pitch`、`mbb-consulting`、`narrative-keynote`、`operating-review`、`product-launch`、`science-explainer`、`solution-proposal`、`technical-deepdive`、`workshop-teaching`。几何和版式节奏来自锁定的那一套，不能混用另一套的坐标。
- 颜色和字体可以整套换成 `styles/themes` 里的主题，或换成用户品牌主题。主题只提供 token，不改页面结构。用户给出主色、辅色和可选标志路径时，生成对比度安全的 token，把路径记在 `theme.logo`；要出现标志时再放一个 `src` 相同的图片。不要写入第三方公司的品牌色或标志。
- 参考页路径写在 `styles/catalog.json` 的 `deck` 字段。DSH 五套在 `styles/<id>/deck.json`，另有 `deck.en.json`。十四套 ppt-master 风格都指向 `styles/examples/` 里的官方成稿，其中事故复盘、经营复盘和产品发布三套的主参考页含有第三方标识。那些标识只供对照版式，新稿换成用户自己的文字、数据和标志。沿用参考页的坐标和页眉页脚，替换成用户的文字和数据。几何改动之后必须重新预检。图示标签可以小于 16 pt，以该套 `design.md` 为准，不要统一放大。结构版式在 `layouts/`。新稿不要写 `profile: example`，那只用于已经出版的示例页。
- 两处中文源页面会在末行落下一个字：`dsh-course-workshop` 的 `03:t7`「从引导练习走向独立完成」，`dsh-engineering-blueprint` 的 `03:t101`「明确每一层边界」。沿用这些页时重排用户句子，让末行不是一个字。不要为了通过而缩小字号，也不要把文本框加宽到撞上邻列。其余参考页预检是干净的。
- 在会话 `dataFolderPath` 保存 `design-plan.md` 和 `deck.json`。它们是会话材料，不默认交付。
- 默认规划完成后继续生成。只有用户明确要求先审方案时才停。恢复会话时读取磁盘上的计划和 deck，**不得自动重新选风格或把视觉检查次数清零**。

## 预检和导出

DSH 参考页和多数 16:9 成稿的画布是 **960×540 pt**，也就是 13.333×7.5 in、33.867×19.05 cm。Morph 的幻影对象在 16:9 页上仍然要留在 33.867 cm 的右缘之外。版式家族还可以是 768×576、810×810、810×1440 或 931.5×1245。示例成稿还可以是 A4（930×1315.5）以及横幅等自定义尺寸，两边都要落在 200–2000 pt。用哪一套，画布就用哪一套的尺寸。

```text
"$CRAFT_BUN" "<skill>/engine/deck-cli.mjs" check "<dataFolderPath>/deck.json"
"$CRAFT_BUN" "<skill>/engine/deck-cli.mjs" render "<dataFolderPath>/deck.json" --out "<dataFolderPath>/deck.pptx" --screenshot "<dataFolderPath>/slides" --platform mac|win|linux
```

从 `CRAFT_BUN` 取得应用附带 Bun 的绝对路径，用参数数组调用。`<skill>` 是本技能的绝对路径。`--platform` 按用户机器选择 `mac`、`win` 或 `linux`。

标准输出是一行 JSON。退出码 0 是通过，2 是 `needs_revision`，1 是文件或用法错误。`needs_revision` 时不写 PPTX。一次看完 `issues` 里的全部问题，按 `pageId` 和 `elementId` 修改后再查。溢出时整理换行或几何、换版式、拆页；不删除限定条件，不把整页栅格化。

截图失败但 PPTX 已写出时，`screenshots.available` 为 `false`。这时 G4 不能通过。

## 质量门：G1 → G5

| 门 | 必须通过的内容 |
|---|---|
| G1 故事/页序 | 用户材料、逐页主张、实际页数和顺序一致。 |
| G2 设计/排版 | 只锁定一个风格；`deck_check` 没有问题；字号不低于该风格的下限。预检不是视觉检查。 |
| G3 保存/读回 | OfficeCLI `validate` 没有未解决的错误或警告。文字、图表数据、单位、备注、来源和页序读回正确。 |
| G4 逐页视觉 | 每一页的截图都打开看过。接触表不能代替逐页。 |
| G5 关闭/重开 | 最终绝对路径上的文件重新读过，页数和内容正确。 |

G4 **整项任务最多 3 次：首次 + 至多 2 次修复复查**。更换渲染器、审查者、会话或 pitch/Morph 都不重置次数。任何检查之后的修改，都必须还有剩余的一次视觉检查盖住。第三次仍有缺陷，或没有可用截图：写明页码、问题和阻塞，不能声称可交付。

## 交付

- 用户要求 Morph 或 3D 时，只增加对象配对和运动检查，不另做一套静态设计。静态截图不能证明播放效果。
- 中间文件放在 `dataFolderPath`。G1–G4 通过后，把已检查的 PPTX 复制到用户指定的路径；未指定则用有效工作目录。不默默覆盖已有文件。
- 只交付 `.pptx` 和一段事实说明。许可与适配来源见 [ATTRIBUTION](ATTRIBUTION.md)。
