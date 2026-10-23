---
name: ppt-design
description: "制作新的 PPT、PowerPoint、presentation、幻灯片或整套演示文稿重设计：故事线、设计锁、中文排版、14 种原生配方与真实逐页视觉检查。不用于现有 PPT 的局部文字、数据、图片或格式修改。"
---

# PPT Design

## 入口与边界

- 仅在**新建演示文稿 / 用户明确要求整套重设计**时使用本技能。
- 局部编辑、转换已有文件：转交 [OfficeCLI](../officecli/SKILL.md)，先检查，保留原设计及未请求修改的内容；不要用配方重建。
- 本技能负责内容组织、设计、排版、配方和 G1–G5；OfficeCLI 是唯一 Office 文档引擎。
- 不安装 Python、第三方 PPT 库、素材工具或运行上游脚本；不下载或自更新 OfficeCLI。

## 先读，再执行

1. 规划故事线时读 [工作流](references/workflow.md)；选择时读 [风格概览与所选条目](references/styles.md)、[版式语义](references/layouts.md)，不一次加载所有 catalog。
2. 锁定字体与逐页内容时再读 [中文排版](references/typography.md)。
3. 生成前读 [规格契约](references/spec-schema.md)；渲染前读 [逐页视觉审查](references/visual-review.md)。只有涉及 SVG 才读 [SVG 能力边界](references/svg-capabilities.md)。
4. 先读 [OfficeCLI 路由](../officecli/SKILL.md)，执行 `officecli load_skill pptx`；仅按请求追加 pitch-deck / morph-ppt / morph-ppt-3d 指南。
5. **所有指南加载后**读 [Selection 覆盖规则](../officecli/ppt-selection-override.md)，再做文档操作；后来加载指南时重新应用覆盖规则。

引用按阶段读取；允许先检查已有材料或文档，不要求为一次 inspect 预读全部设计细节。相关写入前必须读该阶段说明。
`officecli help` 决定实际命令语法，官方指南不再拥有另一套设计、手工网格或 QA 流程。
所有 OfficeCLI 调用均设置环境变量 `OFFICECLI_SKIP_UPDATE=1`；使用应用随附版本，不调用用户安装版本。

## 从故事线到设计锁

- 从用户材料提取受众、目的、核心结论、事实/假设、来源、页数和交付位置；不捏造数据、日期、讲者或资产。
- 一页一个主张；先写有顺序的故事线，再写每页语义、正文、证据、来源、讲稿备注与布局。
- 布局按关系选择，不把所有信息塞进卡片；相邻页不重复同一布局，每 3–4 页安排一次有内容依据的冲击/留白页。
- 锁定 `business`、`dark-tech`、`fresh-editorial` 中一个风格；字体、色彩和几何沿用配方，不能混搭另一套模板。
- 在会话 `dataFolderPath` 内保存完整 `design-plan.md`、`spec-lock.md` 和 `spec.json`；它们是会话材料，不默认交付。
- 设计锁记录故事、页序映射、风格、实际安装字体、字号 floor、证据路径、最终路径和已消耗视觉次数。
- 默认完成规划后继续生成；只有用户明确要求先审方案时才停在方案审阅，批准后再锁定执行版本。
- 反馈或修复先更新受影响的计划与锁，再更新规格和生成；恢复会话读取磁盘状态，**不得自动重新选风格、重置锁或视觉次数**。

## 风格构图原生生成

画布 **33.867 × 19.05 cm**。内容标题至少 32 pt，封面/数字更大，正文至少 18 pt，来源 12 pt。三套风格各自构图，不能靠换色复用同一版式。配方不自动缩字、不截断内容。
严格 [规格契约](references/spec-schema.md)：只写已支持字段，不能在 JSON 中插入坐标、字体、颜色或自由绘图代码。

```text
"<absolute-CRAFT_BUN>" "<skill>/scripts/compose.ts" --spec "<dataFolderPath>/spec.json" --out "<dataFolderPath>/deck.pptx"
```

可选 `--officecli /ABS/bundled/bin`、`--font-cjk "Noto Sans CJK SC"`，只能使用实际安装的字体。
输出必须在 `dataFolderPath` 内，使用新文件名，不覆盖已有产物。生成状态 **GENERATED_UNREVIEWED** 不是完成。
从环境 `CRAFT_BUN` 取得应用附带 Bun 的绝对路径并以参数数组调用；不假设 PATH 有 `bun`，不安装运行时。POSIX 可用 `"$CRAFT_BUN"`，PowerShell 可用 `& $env:CRAFT_BUN`。`<skill>` 为本技能绝对路径，`dataFolderPath` 为会话绝对目录；执行时设置上述环境变量。
溢出先整理换行/几何，再换合适布局或拆页并更新锁；不删除限定条件、隐藏正文或把整页栅格化来伪装通过。

## 唯一质量门：G1 → G5

| 门 | 必须通过的内容 |
|---|---|
| G1 故事/页序 | 任务材料→逐页计划→实际 outline 的消息、顺序、页数与证据一致。 |
| G2 设计/排版/适配 | 一个风格、实际字体、配方及字号 floor；无溢出、缺字、不可读对比或占位残留。 |
| G3 保存/结构/读回 | `validate` 无未解决错误或警告；实际文字、图表数据、单位、备注、来源与页序读回正确。 |
| G4 真实逐页视觉 | 每一页的实际截图都被打开看过，并记录逐页结果；不能用结构、HTML 源码或缩略总览冒充。 |
| G5 关闭/重开/路径 | 最终状态关闭后重新读取；确认最终绝对路径存在、页数内容正确，释放重新打开的会话。 |

G4 **整项任务最多 3 次：首次 + 至多 2 次修复复查**。更换候选、渲染器、审查者、会话、pitch/Morph 都不重置次数。
每次修复后重复受影响 G1–G3，再渲染检查整套所有页；任何检查后的修改都必须有剩余一次视觉检查覆盖。
第三次仍有缺陷，或真实渲染/视觉路径不可用：明确页码、问题和阻塞，不能声称可交付，也不能做未审查修复。
无需要修复时首次即可通过；不强行制造缺陷，不执行重复“独立终审”。

## 交付与可选动态

- 用户请求 Morph/3D 时只增加对象配对、名称、生命周期和运动意图检查，不另起静态设计或 QA 循环。
- 静态截图只能证明静态画面，不能证明 PowerPoint/Keynote/WPS 中的运行时插值或动画；未验证的播放行为明确披露。
- 所有中间输入、PPTX、导出、截图和记录都放在会话 `dataFolderPath` 内，不污染工作区。
- G1–G4 通过后将已审查产物复制到用户指定最终路径（未指定则有效工作目录），在最终文件完成 G5；不默默覆盖用户已有文件。
- 只交付实际 `.pptx` 与简短事实性说明；支持文件非用户要求不交付，不把计划或 HTML 预览当成成品。
- 许可与适配来源见 [ATTRIBUTION](ATTRIBUTION.md) 和 [LICENSE](LICENSE)。
