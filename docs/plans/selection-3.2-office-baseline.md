# Selection 3.2 Office/PPT 基线冻结

对应 [Epic #682](https://github.com/0-CHENAI/Selection/issues/682) 与 [O0 #683](https://github.com/0-CHENAI/Selection/issues/683)，里程碑 [Selection 3.2 #9](https://github.com/0-CHENAI/Selection/milestone/9)。本文是 O1 的入口与缺口基线，不改变运行时行为，也不表示后续阶段已实现。

## 冻结范围与证据口径

- 日期：2026-10-30（Asia/Shanghai）。Selection 基于刷新后的 `origin/test`：`3718d32687e7944d1862046e0616c080f4f258ed`。
- DSH 对照：本机 `0-CHENAI/dsh-desktop` 的已提交快照 `8dec631777c34fbbcc7d45af787bdd2c468d2cfb`。所查 `packages/ppt-runtime` 无本地修改；其他未提交改动不纳入对照。这不是远端最新版声明，也不是 DSH 的运行验收。
- 入口、分支、配置和约束来自源码静态核对；本文未启动模型生成、OfficeCLI 截图或 PowerPoint/WPS 播放。已有测试文件是后续验收入口，不代表本轮跑过或全仓通过。
- OfficeCLI 随附版本为 **1.0.157**，依据 [officecli-manifest.json](../../apps/electron/resources/officecli/officecli-manifest.json)，不是对用户机器已安装版本的探测。
- 写法沿用 [3.0 执行约定](selection-3.0-execution.md) 的“实际入口—公共约定—后续接入”，验证口径参照 [3.0 规范计划](../qa/selection-3.0-canonical-plan.md)。

## 不变的产品与引擎边界

Selection 是通用助手中的 Office 能力。新稿继续使用 selection-deck / `deck.json` 和 PptxGenJS 导出；OfficeCLI 保留为定点 OOXML 编辑、校验、读回、截图底座。后续把 deck 提升为版式和叙事修订主面，不搬 PPTD、Cordis/Harness、Python office-runtime 或 LibreOffice Kit，不引入 OnlyOffice/Collabora。

“check → export”是业务顺序；本基线实际 CLI 导出命令名是 **`render`**，不存在需要照抄的 `export` 子命令。已安装 LibreOffice 的截图回退与引入 LibreOffice Kit 是不同能力，后者不在本轮范围。

## 现状入口图

```text
普通会话 + Office 附件 ─→ system.ts Office 路由 ─→ officecli/SKILL.md
                                                    ├─ 新建 / 整套重设计 → ppt-design
                                                    └─ 定点改稿 → OfficeCLI 保留原设计
PPT 模式 / 模板选择 ─→ PptPickerButton / TemplateGallery
                    └─ PptRequest → pptSendOptions / buildPptPrompt
结果换风格 / 换色 ─→ PptResultCard → PptRevisionPanel
                    └─ PptRevision → buildPptRevisionPrompt
按页/元素修订协议 ─→ PptRevision.targets（page / elementId）
                    └─ 同一 SessionManager 拼接当前轮模型上下文
                                      ↓
                       data/deck.json（工程）
                         ├─ CLI check → render（默认检查）
                         └─ watchPptDeck → exportIncrementalPptx（预览跳过 check）
                                      ↓
                      ppt-output.json 指向唯一可见 PPTX
                                      ↓
                   OfficeCLI validate / 读回 / screenshot
                                      ↓
                 G1–G5；G4 原生读图，禁止 OCR 替代
```

图中的 `PptRevision.targets` 是现有协议与提示词能力，不代表结果卡已有完整的“逐条诊断 → 元素修复”交互。

## 实际入口与权责

| 层 | 真实路径 / 符号 | 当前行为与边界 |
| --- | --- | --- |
| 系统提示 | [packages/shared/src/prompts/system.ts](../../packages/shared/src/prompts/system.ts)，Office 工具路由与内置技能目录 | Office 文件优先随附 OfficeCLI；专门格式指南私有加载；不能据此推断已经有完整三分意图分类器。 |
| 新稿设计 | [ppt-design/SKILL.md](../../apps/electron/resources/skills/ppt-design/SKILL.md)、[references/workflow.md](../../apps/electron/resources/skills/ppt-design/references/workflow.md) | 入口限定新建/显式整套重设计，局部已有文件转 CLI；正文又允许点名页改 deck。恢复时读既有计划，禁止自动重选风格、重置视觉次数。 |
| Office 路由 | [officecli/SKILL.md](../../apps/electron/resources/skills/officecli/SKILL.md) | Word/Excel/PPT 按需 `load_skill`，禁止安装/自更新；所有 PPT 加载指南后应用 override。Word/Excel 不受 PPT 三次视觉上限影响。 |
| 冲突覆盖 | [officecli/ppt-selection-override.md](../../apps/electron/resources/skills/officecli/ppt-selection-override.md) | 替换 legacy pptx/pitch/Morph 的设计规则与 Gate 编号；新稿设计由 ppt-design 拥有；定点改稿保持主题、母版和未改内容。后来再加载指南要重新应用。 |
| deck 源码与分发 | [engine/cli.ts](../../apps/electron/resources/skills/ppt-design/engine/cli.ts)、[schema.ts](../../apps/electron/resources/skills/ppt-design/engine/schema.ts)、[check.ts](../../apps/electron/resources/skills/ppt-design/engine/check.ts)、[export-pptx.ts](../../apps/electron/resources/skills/ppt-design/engine/export-pptx.ts)、[deck-cli.mjs](../../apps/electron/resources/skills/ppt-design/engine/deck-cli.mjs) | `check` 一次返回 issues；退出码 0/2/1 分别为通过/needs_revision/错误。默认 `exportDeck` 有问题不写 PPTX。分发 mjs 不能代替可维护 TS 源码。 |
| 模板选择 | [PptPickerButton.tsx](../../apps/electron/src/renderer/components/ppt/PptPickerButton.tsx)、[TemplateGallery.tsx](../../apps/electron/src/renderer/components/ppt/TemplateGallery.tsx)、[TemplateOptions.tsx](../../apps/electron/src/renderer/components/ppt/TemplateOptions.tsx)、[atoms/ppt.ts](../../apps/electron/src/renderer/atoms/ppt.ts) | 实际入口名是 PptPickerButton；已有模板、主题/品牌/画布配置，自定义分类及上传/改名/导出/删除，不能按空白 UI 重做。 |
| 生成上下文 | [services/ppt-catalog.ts](../../packages/server-core/src/services/ppt-catalog.ts)，`pptSendOptions` / `buildPptPrompt` | 注入 ppt-design、模板 design/参考页、主题和 deck 路径；文字要求模板是参考而非僵硬表格，已有附件继续读取。 |
| 修订上下文 | [services/ppt-live.ts](../../packages/server-core/src/services/ppt-live.ts)，`validatePptRevision` / `buildPptRevisionPrompt`；[protocol/ppt.ts](../../packages/shared/src/protocol/ppt.ts) | `revise` 必须带页/可选元素 targets，保留其他页；`restyle` 整套重排；`recolor` 保留布局文字页数图表。三者均要求写同一个 deck。它们是 UI 操作标签，不等同于 O1 的三分路由。 |
| 结果与修订 UI | [PptResultCard.tsx](../../apps/electron/src/renderer/components/ppt/PptResultCard.tsx)、[PptRevisionPanel.tsx](../../apps/electron/src/renderer/components/ppt/PptRevisionPanel.tsx)、[ppt-result-model.ts](../../apps/electron/src/renderer/components/ppt/ppt-result-model.ts)、[ppt-revision.tsx](../../apps/electron/src/renderer/components/ppt/ppt-revision.tsx) | 卡片已有问题页提示；RevisionPanel 只有 style/color 两个 tab。协议有 elementId 不等于 UI 已列出全部诊断并能逐条修复。 |
| 会话与实时导出 | [sessions/SessionManager.ts](../../packages/server-core/src/sessions/SessionManager.ts)，`pptContext` / `pptRevisionContext`；[ppt-live.ts](../../packages/server-core/src/services/ppt-live.ts)，`watchPptDeck` / `exportIncrementalPptx` | 生成/修订上下文按选项加入当前轮；保存 deck 会触发同一可见文件更新。实时导出显式传 `{ enforceCheck: false }`，可见文件不是已通过质量门的凭据。 |
| 外来模板 | [services/ppt-library.ts](../../packages/server-core/src/services/ppt-library.ts)，`parsePptx` / `importPptTemplate` / `customTemplateReference` | 已保存 source.pptx、theme.json、slots.json 和预览；PNG 失败可退几何 SVG。此处是模板提取/参考，不是保真 PPTX→deck round-trip。 |
| 定点编辑保护 | [reliability/office-preview.ts](../../packages/server-core/src/reliability/office-preview.ts) | 校验文件 hash、选中对象 digest、预览会话与选择快照；O1/O4 不能绕过这些对象身份和并发保护。 |
| 截图与视觉政策 | [engine/screenshot.ts](../../apps/electron/resources/skills/ppt-design/engine/screenshot.ts)、[references/visual-review.md](../../apps/electron/resources/skills/ppt-design/references/visual-review.md)、[ppt-visual-qa-policy.ts](../../packages/shared/src/agent/ppt-visual-qa-policy.ts)、[ppt-visual-qa-note.ts](../../packages/shared/src/agent/ppt-visual-qa-note.ts) | captureSlides 当前循环 1…pageCount；先 OfficeCLI，后已有 LibreOffice+pdftoppm。工具调用经 assertPptVisualQaTool 拦截 PPT OCR 替代；该启发式防护不是完整逐页视觉验收状态机。 |

## 规则如何互相压制：问题 → 原因 → 后续修改方式

这些是源码合同冲突或缺口，未通过本轮真实模型重现“必然整套重做”。

| 问题 | 原因与证据 | 后续修改方式 |
| --- | --- | --- |
| 两页版式修订没有明确的中间路由 | ppt-design 的入口和 officecli override 的 ownership 仍以“新稿/整套”对“定点”二分；buildPptRevisionPrompt 却要求定点 targets 写 deck。 | O1 #684 统一技能、override 和会话上下文：文字/数据/保母版走 CLI，版式/叙事/重排走已有 deck，显式换皮才重锁 style。 |
| 不能只改一个技能就宣称解决 | SessionManager 分别拼接生成与修订上下文；生成模板参考的柔性表述，仍会遇到技能的单风格坐标锁与后读 override。 | O1 检查三个入口及跟进会话，固定意图标签与路径；避免既有 PPT 请求把普通修改重新包装成新建。保持已有“不自动重选”条款。 |
| 小改仍被全量 G4 拉回重工作流 | override 和 visual-review 要求每次看全部页；buildPptRevisionPrompt 虽写 changed page，截图命令仍给全页数；captureSlides 无受影响页集合参数。 | O2 #685 同步定义修改范围、截图范围和检查失效规则；全稿新建/换皮与文字/单页修改分别验收。不能只改 G4 文案。 |
| “必须先 check”存在预览例外 | CLI 默认检查，但 exportIncrementalPptx 用 enforceCheck:false 更新用户可见文件。 | O2 明确预览与可交付状态，建立最终导出/交付检查约束，保留必要的增量预览体验；不要把进度或文件存在当通过。 |
| 相邻同 layout 不是单纯文案限制 | SKILL 与 visual-review 禁止，checkDeck 也产生 adjacent_layout issue；默认导出被所有 issues 阻断。 | O2 同步技能与检查器，允许内容合理的连续同布局；仍保持字体、主题 token、溢出与证据约束。 |
| 论证槽可用但跨样式复用边界不清 | 已有 14 个 argument layouts；技能又禁止混用另一套坐标，要求只锁一套设计。 | O2 说明锁 token 下借用论证槽的适配规则、何时解锁；引入 composition，而非再增加网格地板。 |
| 结果菜单仍偏整套操作 | PptArtifactMenuItems 提供 restyle/recolor；已有页面状态和 targets 协议。 | O3 #686 复用现有数据，补齐按页/按诊断问题的修订入口；不能声称当前完全没有局部修订基础。 |
| 模板导入容易被当成外来稿理解完成 | ppt-library 提取主题/slots/预览，不构成逐页主张摘要或原稿对象保真回写合同。 | O4 #687 先 OfficeCLI query → lossy brief，编辑前读取；近似 deck 明示丢失项，保持原件。 |

### G1–G5 的当前权威解释

以 [ppt-selection-override.md](../../apps/electron/resources/skills/officecli/ppt-selection-override.md) 为冲突时的覆盖规则：G1 故事/页序；G2 锁定设计、排版、内容容量及 deck 检查；G3 最终保存后的 validate/内容读回；G4 每页真实渲染并原生读图；G5 关闭、重开/读回、确认最终文件存在。定点编辑的 G1/G2 是保留原顺序与设计，不应强行加新 style。

当前 G4 整项任务最多三次（首次 + 两次修复复查），换 renderer/reviewer 不重置；修改后的状态需要剩余检查覆盖。图像不可用或 `image_capability_mismatch` 必须报告未验证，不能用 OCR、Swift/Vision、tesseract、`Swift: OCR` / `OCR New Pages` 替代。O2 可以收窄受影响范围，但不能删除原生读图合同，也不能把结构预检、HTML/DOM、接触表或静态截图当动画播放验证。

`pptVisualQaMissingNativeVision` 在本快照的引用只有定义与测试，不能把这个辅助函数当成已接入交付链的逐页强制门；实际工具防护 `assertPptVisualQaTool` 已在 SessionManager 中接入。后续验收要分别证明防 OCR、图片确实进入模型、最终修改范围被覆盖。

## 对照 DSH 的缺口表

状态用于标记后续工作的性质：**已有半成品**指 Selection 有可复用实现但未闭环；**可搬文案**指适配指导思想/文本并保留适用来源；**需新做**指本次检查范围内没有目标合同。DSH 的声明或类型不代表本轮已完成运行验证。

| 能力 | DSH 冻结快照证据 | Selection 现状 | 状态与落点 |
| --- | --- | --- | --- |
| PPTD 修订环 | [dsh-ppt/SKILL.md][dsh-skill]：write/read → check，完整问题定位 → render 再校验，needs_revision 正常 | checkDeck、issues、pageId/elementId、默认 exportDeck 检查均已存在；实时预览例外未闭环 | **已有半成品 + 可搬文案**；O1/O2 使用 deck，不搬 PPTD 引擎 |
| 模板读取与目录 | [template-reference.d.ts][dsh-reference] 有 semantic profile/单页视觉参考；skill 要求目录与参考页读取，每次最多 12 页 | ppt-catalog、TemplateGallery、PptTemplatePreview、catalog/picker 与 DSH 导入脚本已存在 | **已有半成品**；O3 补目录、预览、引用一致性与包覆盖 |
| 个人模板 | [protocol.d.ts][dsh-protocol] 有 custom 分类，[adapter/client.js][dsh-client] 处理 extracted；所查 PptService 类型未提供完整个人模板 CRUD 证据，不能只据分类宣称成熟 | ppt-library 与 TemplateGallery 已有个人模板导入/去重/改名/删除/导出；真实截图失败会退几何预览 | **已有半成品**；O3 验证完整用户链路与降级标识，复用现有实现；DSH 端完整能力待补证 |
| 外来 PPTX | skill 有 pptd_import；[pptd-convert.d.ts][dsh-convert] 明确 bounded conversion，diagnostics 含 normalized/unsupported | 模板提取与 CLI 定点编辑已存在，尚不能等同外来稿的语义 brief 或高保真往返 | **需新做**；O4 做 lossy 结构摘要/强制读 brief，可选近似 deck，逐项披露不可 round-trip 对象 |
| composition 指引 | [composition.md][dsh-composition] 规定开场/证据/收尾、结论—主图—辅助证据—解读，强调内容关系和字体/留白 | 已有故事线、版式/排版 references 和 argument-layouts，缺专门组合指南；规则仍强制相邻不同 layout | **可搬文案 + 已有半成品**；O2 适配为通用助手语境，保留出处 |
| 模式与 Composer | [ppt-service.d.ts][dsh-service] 有 selectPresentationMode/selectTemplate；[ppt-tools.d.ts][dsh-tools] 有 composer context | PPT 模式、picker、主题和个人模板已有；问题级修订 UI 不完整 | **已有半成品**；O3 延续 Selection 组件，不加载 Harness composer 包 |
| Word/Excel 案例 | 本次 DSH 的 ppt-runtime 范围未定位可直接接入的 Word/Excel 业务技能目录，不能以 PPT 包推定其存在 | officecli 路由已覆盖 Word、表单、学术稿、Excel、财务/仪表盘 | **需新做**业务案例编排；O5 #688 先核对实际案例来源及适用许可，再以模板副本+定点改实现；不迁 Python runtime |

### 模板包差额与来源边界

Selection 的 [ATTRIBUTION.md](../../apps/electron/resources/skills/ppt-design/ATTRIBUTION.md) 记录导入源为 DSH `1439949f46ddfe0b94446558511f979f0c4215ba`，与本次对照快照不同；不能把旧导入来源改写成新来源。现有 DSH 五套是 cartesian、course-workshop、editorial-notebook、engineering-blueprint、soft-editorial（均带 `dsh-` 前缀），每套有中文/英文 deck。另有十四套 ppt-master 风格和七个结构版式家族，不能算作 DSH 覆盖数。

对照快照的 [templates 目录][dsh-templates] 有 16 个 metadata.json，按目录 slug 差集，尚未作为同名 DSH 套件接入的 11 套为：

- `dsh-monochrome`、`dsh-blue-professional`、`dsh-neo-grid-bold`、`dsh-signal`。
- `dsh-broadside`、`dsh-playful`、`dsh-sakura-chroma`、`dsh-editorial-forest`。
- `curated-swiss-signal-grid`、`curated-modular-logistics-system`、`curated-nordic-operating-report`。

这是目录覆盖差额，不是“运行导入 11 套一定成功”。O3 使用 [scripts/import-dsh-templates.ts](../../scripts/import-dsh-templates.ts) 的 listPacks/convertPack 与按 slug 导入能力，逐套检查格式支持、中文重排、预览和来源。保留 ATTRIBUTION、适用 MIT/Apache-2.0 许可与 NOTICE；不能把 DSH 根 MIT 误当全部模板都是 MIT。新样例另放“样例扩展”，不覆盖原封面/内容/尾页模板。

## 交给 O1 的最小合同与后续顺序

O1 [#684](https://github.com/0-CHENAI/Selection/issues/684) 以本页入口表为修改清单，先覆盖以下三案；以下是待实施验收，非 O0 通过记录。

| 固定意图 | 目标路径 | 必须观察的反证 |
| --- | --- | --- |
| 已有稿改标题/数据，保留母版 | OfficeCLI 精确对象修改、保存读回 | 未新建整套 deck，未重锁 style，未改其他对象 |
| 已有 deck 改两页版式/叙事 | 修改对应 deck pages → check → export | 其余页 ID/几何/内容保持，未误走整套 restyle；没有 deck 的外来稿不能假定可直接编辑工程 |
| 用户明确要求整套换风格 | 显式 restyle / 重锁 style | 有显式意图依据，事实/来源保留；recolor 仍保留布局，不默认升级为 restyle |

既有 `revise/restyle/recolor`、page/elementId 可复用，但没有把它们认定为稳定三分意图标签。O1 需明确 CLI 定点与 deck 修订的路由身份，并使技能、override、生成/修订上下文保持一致。已有“恢复不重新选风格”应作为回归约束。

| 阶段 | 依赖与下一交付 | 可复用验证入口（本轮未运行） |
| --- | --- | --- |
| O0 #683 | 当前纯文档，draft PR → test；等待主人批准合入 | 路径/链接存在性、模板差集、文档范围与 git diff --check |
| O1 #684 | O0 获批合入后从最新 origin/test 开新分支，统一三分路由 | ppt-catalog.test.ts、ppt-live.test.ts；新增三案定向验证，不能仅匹配提示词就声称真实路由通过 |
| O2 #685 | 依赖 O1：check/交付闭环、局部 G4、布局柔化、composition | engine/deck.test.ts、engine/deck-officecli-roundtrip.test.ts、ppt-visual-qa-policy.test.ts；补真实修改范围证据 |
| O3 #686 | 按阶段任务正文依赖 O2：补模板与按诊断修订 UX，可与 O5 并行 | ppt-library.test.ts、PptResultCard.test.tsx、ppt-composer.test.ts；补实际 UI 与真实预览验收 |
| O4 #687 | 依赖 O2：外来稿 lossy brief 与读取约束 | office-preview.test.ts 加固定外来稿样本；披露对象损失、原件保护 |
| O5 #688 | 依赖 O1：业务案例与模板副本定点改，可与 O3 并行 | Word/Excel 实际产物、保存读回、截图；不引入 Python 主路径 |
| Ship #689 | 依赖各阶段交付：定向脚本、unit + validate、beta 说明 | 参考 scripts/selection-3.0-f*.ts 的证据口径；获批合入 test 后观察 Validate + Package，禁止用定向通过冒充全仓绿 |

阶段说明中的 O3 依赖采用其详细任务条款的 O2；不把开头“可并行”解读成可以跳过 O2。每阶段独立草稿 PR，Closes 对应 issue，挂 Selection 3.2；禁止擅自 merge。Epic #682 已包含 #683–#689 链接，不重建资产。本轮不触碰 #681 effort/WebGL/Fast 线。

## O0 验收记录

- [x] 已记录冻结 SHA、真实入口、覆盖关系与运行预览例外。
- [x] 缺口表覆盖修订环、模板读取、个人模板、外来导入、composition；区分已有实现与待补证。
- [x] 已检查正文中的 Selection 相对文件链接和固定 DSH 快照路径存在，核对模板差集；`git diff --check` 通过。
- 本轮只新增本文；未运行产品测试、模型端到端、视觉 QA 或发布流水线，未产生 PPT。
- Draft PR 的 URL、里程碑与 CI 状态以 GitHub PR 和 Epic 进展评论为准；文档落库不等于已合入，也不等于 O1 可以越过门禁启动。

## 2026-10-30 起基线改为 588412b

本节追加于 O0 记录之后，不改写上文。第 8 行的 DSH 对照提交 `8dec631777c34fbbcc7d45af787bdd2c468d2cfb` 仍是 O0（#683）当时的证据。缺口表里「本次 DSH 的 ppt-runtime 范围未定位可直接接入的 Word/Excel 业务技能目录」只对那个快照成立。

自 2026-10-30 起，Selection 3.2 后续 Office 对齐（Epic #703，阶段 #704）改以 dsh-desktop `588412b9002fcb3ac88751fab7915e050c965563` 为唯一对照。该提交包含 `packages/dsh-desktop-office` 的 7 个案例和 7 个业务技能，也包含 `harness-0.2.0-rc.2` 里的 Office 技能包与 LibreOffice Kit 0.1.3。新的清单、许可审计和差距表 v2 见 [selection-3.2-office-dsh-parity-baseline.md](selection-3.2-office-dsh-parity-baseline.md)。#683 的后续说明引用该页即可，不修改 #683 原文。

O0 作出的「不搬 PPTD、Python office-runtime、LibreOffice Kit」是当时 Epic #682 的非目标。#703 把这三项改成决策阶段 #707、#706、#705。那些决策未完成前，本文的引擎边界仍然是 O0 已交付范围的描述，不是 #703 的最终取舍。

[dsh-skill]: https://github.com/0-CHENAI/dsh-desktop/blob/8dec631777c34fbbcc7d45af787bdd2c468d2cfb/packages/ppt-runtime/core/skills/dsh-ppt/SKILL.md
[dsh-composition]: https://github.com/0-CHENAI/dsh-desktop/blob/8dec631777c34fbbcc7d45af787bdd2c468d2cfb/packages/ppt-runtime/core/skills/dsh-ppt/references/composition.md
[dsh-reference]: https://github.com/0-CHENAI/dsh-desktop/blob/8dec631777c34fbbcc7d45af787bdd2c468d2cfb/packages/ppt-runtime/core/lib/types/template-reference.d.ts
[dsh-protocol]: https://github.com/0-CHENAI/dsh-desktop/blob/8dec631777c34fbbcc7d45af787bdd2c468d2cfb/packages/ppt-runtime/core/lib/types/protocol.d.ts
[dsh-client]: https://github.com/0-CHENAI/dsh-desktop/blob/8dec631777c34fbbcc7d45af787bdd2c468d2cfb/packages/ppt-runtime/adapter/lib/client.js
[dsh-convert]: https://github.com/0-CHENAI/dsh-desktop/blob/8dec631777c34fbbcc7d45af787bdd2c468d2cfb/packages/ppt-runtime/core/lib/types/pptd-convert.d.ts
[dsh-service]: https://github.com/0-CHENAI/dsh-desktop/blob/8dec631777c34fbbcc7d45af787bdd2c468d2cfb/packages/ppt-runtime/core/lib/types/ppt-service.d.ts
[dsh-tools]: https://github.com/0-CHENAI/dsh-desktop/blob/8dec631777c34fbbcc7d45af787bdd2c468d2cfb/packages/ppt-runtime/core/lib/types/ppt-tools.d.ts
[dsh-templates]: https://github.com/0-CHENAI/dsh-desktop/tree/8dec631777c34fbbcc7d45af787bdd2c468d2cfb/packages/ppt-runtime/templates
