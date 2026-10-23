# 14 种布局：先语义，再按风格构图

[layouts/catalog.json](../layouts/catalog.json) 只帮助选择信息关系。可执行几何在 `scripts/compose-business.ts`、`scripts/compose-dark.ts`、`scripts/compose-editorial.ts`，由 [scripts/recipe.ts](../scripts/recipe.ts) 的 `renderRecipe` 调用。严格输入与容量来自 [scripts/spec.schema.json](../scripts/spec.schema.json)。画布宽 33.8667、高 19.05 cm。同一 layout 在三套风格里结构不同，不能假设一套共用槽位。

| layout | 信息关系与内容 | 典型节奏/构图 |
|---|---|---|
| `cover` | 主题、真实讲者与日期，subtitle 解释范围 | anchor；商务左栏满版，深色环形舞台，杂志右侧出血 |
| `agenda` | 3–6 个并列章节/问题，供受众预期路径 | dense；商务编号行、深色节点、杂志大序号，不能拿目录代替叙事 |
| `section` | 章节号、转场主张和简短说明 | breathing；放大章节数字，错位标题/正文 |
| `bullets` | 3–5 个同级论据/要点，没有时序或对比关系 | dense；编号可读行，不是默认万能列表 |
| `image-text` | 一段解释 + 一幅有证据价值的图片；无图时用 headline/body 面板 | dense；文字与图/面板分区，image/panel 恰好一个 |
| `comparison` | 两个可比对象，同口径说明差异 | dense；商务等分卡片、深色不对称、杂志对半出血 |
| `big-number` | 一个关键数值、单位/标签、语境与限定条件 | anchor；大数字与说明，不编造 KPI 凑冲击页 |
| `timeline` | 3–5 个有日期/阶段 label 的历史或路线节点 | dense；有序节点，每项 label/title/body，不能伪造事件日期 |
| `process` | 3–5 个有先后、依赖或因果的步骤 | dense；步骤 title/body，顺序可辨，不当无序卡片用 |
| `chart` | 数据编码 + 可支持的 insight；2–8 类，1–3 系列 | dense；原生图表去掉网格并直接标数，解释区位置随风格变化 |
| `quote` | 有准确出处的一段原话及 attribution | breathing/anchor；拉引文字，不拼接成伪原话，不杜撰名人 |
| `closing` | 明确下一步或结论，真实联系信息 | breathing；简明正文/联系区，不只放无意义“谢谢” |
| `cards` | 3–4 个同级主题，每个标题与说明 | dense；等权模块，不能拿卡片容器掩盖关系不明 |
| `matrix` | 两条明确维度的 2×2 关系，恰好四格 | dense；xLabel/yLabel 和四格标题说明，格序以配方为准 |

## 内容容量不是“字符数够就能放下”

严格 schema 为每个 slot 给出字符串上限、项数与组成；catalog 仅供选型阅读，不另定义一份输入契约。这些上限是输入边界，不是建议塞满的目标。脚本还按实际固定字号、保守字宽、显式空行/末尾换行及 1.24 行距做布局预检，过长即在创建前停止。中文/英文混排、字体替换、长单词、换行都可能改变实际宽度，G4 的真实截图才是最终适配依据。

内容标题至少 32 pt，正文 18 pt，来源 12 pt；封面、章节号和拉引文字用各 style 的 hero/number/quote。配方不自动缩字、不截断、不丢 slot。溢出时按 [排版回退](typography.md) 更新计划与锁：保真换行、改布局或拆页。

图片由用户提供，当前 `image-text` 配方使用 PNG/JPEG 等比 contain 适配，不拉伸、不假设自动裁切，不把 SVG picture 能力等同于配方已接受 SVG。图片比例不合时选择合适资产/布局；不要声称未实现的 crop 行为。

图表 category 含逗号或换行会与 OfficeCLI 分隔格式冲突，当前配方拒绝；先在不改变事实含义的前提下修订可见类别文本并同步计划，无法保真则明确阻塞。series name 由原生 series setter 保留，不凭空改写。类型/数据语义见 [规格契约](spec-schema.md)。

## 整套节奏

相邻页禁止重复同一 layout；脚本拒绝相邻重复。计划层还要检查每 3–4 页有一次真实的冲击页（section、big-number、quote、closing 等按内容选），不把这项要求变成必须添加无证据数字/引用的配额。变化来自叙事、信息关系和该风格自己的构图，不靠每页换色。

上游代表性 layout/deck/chart 用于理解“结构与身份分离、证据与解释相邻、密集与留白交替”，未复制其 SVG、品牌、标志、占位符协议或原生化导出实现。风格只来自本技能 [三套风格](styles.md)。
