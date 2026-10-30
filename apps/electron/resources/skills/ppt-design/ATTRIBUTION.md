# Attribution / 适配来源

## 本目录现在包含什么

页面格式、预检和 PPTX 导出是 Selection 自己的实现，使用 [PptxGenJS](https://github.com/gitbrent/PptxGenJS) 3.12.0（MIT，Copyright (c) 2015-Present Brent Ely）。没有复制 DSH Desktop 的 `packages/ppt-runtime` 或 PPTD 引擎。

参考页由开发脚本 `scripts/import-dsh-templates.ts` 从 DSH Desktop 生成的 `.page` / `.pptd` 转入 selection-deck。最初五套取自 v0.2.21 快照（提交 `1439949f46ddfe0b94446558511f979f0c4215ba`）；2026-10-30 又从固定提交 `8dec631777c34fbbcc7d45af787bdd2c468d2cfb` 补齐十一套。现在共十六套，每套中文 `deck.json` 与英文 `deck.en.json` 各 12 页。下面先列最初五套，新增十一套及其精确目录见文末。

| 风格 | 来源 | 许可 |
|---|---|---|
| `dsh-cartesian` | Zara Zhang `templates/cartesian`，DSH 于 2026-09-06 改编 | MIT |
| `dsh-soft-editorial` | Zara Zhang `templates/soft-editorial`，DSH 于 2026-09-06 改编 | MIT |
| `dsh-course-workshop` | html-anything `deck-course-module`，DSH 于 2026-09-06 改编 | Apache-2.0 |
| `dsh-engineering-blueprint` | html-anything `deck-blueprint`，DSH 于 2026-09-06 改编 | Apache-2.0 |
| `dsh-editorial-notebook` | DSH 独立编写，不使用 guizang-ppt-skill | MIT |

几何、颜色和示例文案保持源页面。源 YAML 没有圆角半径；`dsh-soft-editorial` 封面的圆角矩形按该套设计说明里的 24–36px 写成 28 pt。源页面没有渐变，本格式也不接受渐变。没有第三方公司标志，没有字体二进制。

两处中文源页面的文本框比句子窄不到一个字，末行会落下一个字。这是源页面的框，没有改宽：

- `dsh-course-workshop` `03:t7`，「从引导练习走向独立完成」
- `dsh-engineering-blueprint` `03:t101`，「明确每一层边界」

上述诊断描述最初五套的转入状态，不代表当前新增样例的验证结果；新增十一套的源诊断与适配记录见 `styles/dsh-import-diagnostics.json`。

## DSH Desktop

- 项目：<https://github.com/0-CHENAI/dsh-desktop>
- 许可：MIT；仓库版权行：Copyright (c) 2026 DataElement。
- 模板所在的 DSH PPT 分发包另保留：Copyright (c) 2026 DeepSeek and WorkBuddy PPT contributors。
- 使用的快照：最初五套为 `1439949f46ddfe0b94446558511f979f0c4215ba`，新增十一套及叙事说明为 `8dec631777c34fbbcc7d45af787bdd2c468d2cfb`。

DSH 的设计说明随各套 `design.md` 保留，前面加了一段 Selection 的转入说明。完整许可文本分别随包保存在 [`licenses/dsh/LICENSE`](licenses/dsh/LICENSE)（DSH 仓库）、[`licenses/dsh-ppt/LICENSE`](licenses/dsh-ppt/LICENSE)（模板分发包）、[`licenses/zara/LICENSE`](licenses/zara/LICENSE) 与 [`licenses/html-anything/LICENSE`](licenses/html-anything/LICENSE)。适用的 DSH 模板署名逐字摘录保留在 [`NOTICE`](NOTICE)，并区分上游分发范围和 Selection 的转换/修改。当前技能根目录 `LICENSE` 中的 Hugo He MIT 文本仍适用于原有 ppt-master 材料，不代替这些模板许可，也不把整个仓库重新许可。第三方模板按各自的 MIT / Apache-2.0 许可提供，不另加非商业限制。

## Zara Zhang / beautiful-html-templates

- 项目：<https://github.com/zarazhangrui/beautiful-html-templates>
- 许可：MIT。
- 版权行：Copyright (c) 2026 Zara Zhang。
- 锁定提交：`e5e204fb1f3b06290846e7dcd7aceddabeceec8c`。
- 用于十套：`dsh-cartesian`、`dsh-soft-editorial`，以及本次补齐的 `dsh-monochrome`、`dsh-blue-professional`、`dsh-neo-grid-bold`、`dsh-signal`、`dsh-broadside`、`dsh-playful`、`dsh-sakura-chroma`、`dsh-editorial-forest`。

DSH 的署名是：十套模板改编自该提交下的 beautiful-html-templates（MIT）。DSH 重建了可编辑版式，把每套扩成 12 页，补了中英文示例，并把网页专用字体换成文档中的 Office 字体对。Selection 现在已转入全部十套。上游和 DSH 文档中提到的字体二进制均不随包分发；运行时只请求已安装的字体名与平台回退。

## html-anything

- 项目：<https://github.com/nexu-io/html-anything>
- 许可：Apache License 2.0。
- 锁定提交：`c31204544230578ac814026fecc153c6e36587ae`。
- 用于 `dsh-engineering-blueprint`（`deck-blueprint`）与 `dsh-course-workshop`（`deck-course-module`）。
- 在该固定提交的完整 Git 树中未发现单独的 NOTICE 文件。完整 Apache-2.0 许可现随包保存在 `licenses/html-anything/LICENSE`；下面这段是从 DSH `THIRD_PARTY_NOTICES.md` 保留的适用署名摘录，并补上 Selection 的后续修改。含上游完整适用段落的副本见本技能 `NOTICE`。

> Engineering Blueprint and Course Workshop adapt the design directions in `deck-blueprint` and `deck-course-module` from https://github.com/nexu-io/html-anything at `c31204544230578ac814026fecc153c6e36587ae`, licensed under Apache-2.0. Copyright and attribution to the HTML Anything / Nexu contributors are retained.
>
> Modified 2026-09-06 by DSH Desktop contributors: added native PPTD layouts, original example text, editable vectors, previews and semantic indexes. Editorial Notebook is separately authored by DSH and does not reuse guizang-ppt-skill.
>
> Modified 2026-10-23 by Selection: converted those PPTD pages to selection-deck. The page engine is an independent implementation and does not include html-anything source.

## 没有转入的材料

没有转入 DSH 已撤回的社区模板和木友圈材料，也没有转入 `packages/dsh-desktop-office/sources/legacy` 下的旧办公模板。DSH 固定快照中维护的十六套现已全部转入：十套 Zara 改编、两套 html-anything 改编、Editorial Notebook 和三套 retained-native。新增十一套仅从下表所列 `packages/ppt-runtime/templates/` 目录取设计说明与双语页面源，不递归导入 DSH 历史库、归档或运行时。它们的原始与适配 JSON 均无图片元素；未携带上游已排除材料清单中的相同哈希文件。

## ppt-master

- 项目：<https://github.com/hugohe3/ppt-master>
- 许可：MIT。
- 版权行：Copyright (c) 2025-2026 Hugo He。
- 转入范围：`templates/layouts` 的 7 套结构页，以及 `templates/styles` 的 14 份 `design_spec.md`。版式脚本是 `scripts/import-ppt-master.ts`。
- 没有转入 `templates/brands` 的 21 套品牌，也没有转入企业整套（中国电信、中汽研）。

版式是带 `data-pptx-*` 标注的 SVG。坐标按 96 dpi 的 0.75 倍换成磅。占位符换成简短中文。图片位是虚线框。这些结构页里的渐变仍铺成一块约 40% 的黑色，路径图形没有转入。

## ppt-master-examples

- 项目：<https://github.com/hugohe3/ppt-master-examples>
- 许可：MIT。
- 版权行：Copyright (c) 2025-2026 Hugo He。
- 转入范围：`examples.json` 列出的 70 套官方成稿全部随应用打包。转换脚本是 `scripts/import-ppt-master-examples.ts`。每套包含 `deck.json`、由 `design_spec.md` 与 `spec_lock.md` 组成的 `design.md`，以及按内容哈希去重的图片。标识按来源保留，不从页面上摘掉。
- 每套 README 里写明的图片出处汇总在 `styles/examples/CREDITS.md`。

下面 9 套含有第三方商标、官方机构标识或商业包装。它们只作为参考模板，随包提供。模板文本来自 ppt-master-examples（MIT，Copyright (c) 2025-2026 Hugo He）；本节不改变仓库本体的许可，也不对这些 MIT 模板另加用途限制。纳入这些页面不授予商标权利，也不表示权利人认可本集成。

| 示例 | 页面上保留的标识 | 目录分类 | 接到的风格 |
|---|---|---|---|
| `ppt169_china_rail_2024_zh` | 中国铁路 / 国铁集团统计口径与现场照片 | 商务 | `operating-review` 的附加参考 |
| `ppt169_china_rail_2024_zh_sonnet` | 同一套中国铁路材料，含复兴号照片 | 商务 | `operating-review` 的附加参考 |
| `ppt169_jilin_geohazard_rules_beautify` | 吉林省自然资源厅公文与机关标志 | 商务 | 仅作示例，不挂风格 |
| `ppt169_telford_feedback_2023_24_quick` | Telford & Wrekin 议会徽标（来源为 EMF，转入时栅格化） | 商务 | 仅作示例，不挂风格 |
| `ppt169_apple_fy2025_review` | Apple FY2025 财报材料中的标识 | 经营复盘 | `operating-review` 的主参考页 |
| `ppt169_uv_launch` | Astral uv 发布物料中的名称与标识 | 产品发布 | `product-launch` 的主参考页 |
| `ppt169_cloudflare_outage_postmortem` | Cloudflare 事故复盘中的标识 | 事故复盘 | `incident-postmortem` 的主参考页 |
| `moments_nine_heritage_goods` | 回力、永久、大白兔等商标与包装 | 社媒 | 仅作示例，不挂风格 |
| `ppt169_china_telecom_2025` | 天翼 / 中国电信品牌标识 | 经营复盘 | `operating-review` 的附加参考 |

十四套 ppt-master 风格的 `deck` 都指向 `styles/examples/` 里的成稿。`incident-postmortem` 的主参考页是 Cloudflare 复盘，`product-launch` 的主参考页是 uv 发布稿，`operating-review` 的主参考页是 Apple FY2025，并附中国电信与两套中国铁路成稿。新稿沿用版式时换成用户自己的文字、数据和标识。

瑞士网格一页在正文里提到若干产品名，作为网格方法的后代，页面上没有那些标志，因此保留。讨论演示文稿概念、以及把通讯社列为资料来源的成稿同样保留。虚构公司的提案（Heatline、Fog & Fern、Every Day Counts）保留。

十二套主题是 Selection 自拟的，可以和任意风格或版式组合。它们受示例的颜色关系启发，不复制画作、标志或品牌名：

| 主题 | 启发 |
|---|---|
| `jiangshan` 千里青绿 | `ppt169_qianli_jiangshan_scroll` 的青绿色与暖纸。不嵌入画作 |
| `sugar-rush` 糖彩 | `ppt169_sugar_rush_memphis` 的高饱和撞色 |
| `glass-saas` 玻璃界面 | `ppt169_glassmorphism_demo` 的冷色雾面 |
| `paper-cut` 剪纸月色 | `ppt169_mid_autumn_papercut` 的夜蓝与暖纸 |
| `pixel-breakfast` 像素早餐 | `ppt169_pixel_breakfast_atlas` 的深靛、蛋黄与番茄色。不嵌入像素画 |
| `swiss-grid` 瑞士网格 | `ppt169_swiss_grid_systems` 的网格和一块红 |
| `tea-tasting` 点茶 | `xiaohongshu_song_diancha` 的茶褐、朱印与暖纸 |
| `brutal-stone` 粗石 | `ppt169_brutalism_field_guide` 的石色、近黑与一块红 |
| `zine-shelf` 独立书摊 | `ppt169_indie_bookstore_zine_guide` 的奶油纸、蓝与粉 |
| `keynote-stage` 暗场讲台 | 自拟。近黑场加一处暖色信号，不是任何公司的发布会配色 |
| `academic-ink` 论文墨色 | `ppt169_researchstudio_reel_paper` 的墨色与蓝色 |
| `night-circuit` 夜航电路 | `ppt169_uv_launch` 的深色界面与冷光。不使用该示例的名称或标志 |

## 早前的审查习惯

G1–G5 和「整项任务最多三次视觉检查」沿用本技能上一版已经写进 Selection 的交付习惯。那一版的配方、换色风格和 OfficeCLI 构图脚本已经移除。早前文档也曾改编自 hugohe3/ppt-master（MIT，Copyright (c) 2025-2026 Hugo He），锁定提交 `622bf0148bca4f697b0184322c7e2aa2a04520a2` 与 `523e5bd972f94c3cac8742fec0d54d43824a17bb`。那些旧配方和品牌材料没有恢复。上面这一节是后来按版式和风格说明重新转入的。

许可保留不表示上游作者认可本集成，也不授予商标权利。

## 叙事组合指引

`references/composition.md` 适配 DSH Desktop `8dec631777c34fbbcc7d45af787bdd2c468d2cfb` 的 `packages/ppt-runtime/core/skills/dsh-ppt/references/composition.md`（DSH 通用说明，MIT），保留原来源与适用许可，新增 Selection 主题 token、局部修订与原生视觉边界。未复制 DSH runtime。

## Selection 3.2 O3 新增包与样例扩展

2026-10-30 从 DSH 已提交快照 `8dec631777c34fbbcc7d45af787bdd2c468d2cfb` 补齐 11 套，每套中英文各 12 页。原始转入工程保留在 `styles/<id>/`；适配后的可选参考页另存于 `styles/examples/imported/<id>/`，不覆盖已有模板或原封面/内容/尾页。未分发字体。同日按选择器裁剪，把不再展示的成稿移到 `styles/样例扩展/archive/`，deck 正文和版式未改。

新增包的 catalog 与双语 `theme.source` 中的 `v0.2.21` 是旧导入器继承的固定标签，不是本次取材快照的版本证明；准确来源以本节的固定提交和目录为准，原始/适配页面内容不因此重写。

- Zara Zhang / beautiful-html-templates（MIT，Copyright (c) 2026 Zara Zhang；上游固定提交 `e5e204fb1f3b06290846e7dcd7aceddabeceec8c`）：下表八套 `dsh-*`。
- DSH retained-native（MIT；同时保留 DataElement 与 DeepSeek and WorkBuddy PPT contributors 的原版权行）：下表三套原生包。`de281a1ceccadb00b92df53adb106a2e87ec0b4b` 是 DSH 元数据和 PR #320 记录的原始来源，实际转入的是 `8dec631...` 中已扩成十二页的双语版本，不是原始十页版本。原生包的 WorkBuddy 来源声明原文保留在各套 `design.md`；这些记录不等于独立确认所有底层版权事实。
- 新增包仅使用上述 MIT 来源；既有两套 Apache-2.0 模板保留，并补齐此前缺失的完整 Apache 许可和适用 NOTICE。各套 `design.md` 保留 DSH 原文，全文许可放在本技能 `licenses/`，不是本文件内嵌的许可正文。
- Selection 样例扩展通过 `scripts/adapt-dsh-office-templates.ts` 重现：只读取这十一套已转入的双语 JSON，不访问远程、归档、社区或 legacy 来源，不覆盖原始模板；不缩小字号、不删改事实，调整显式换行、实际容量、对比度与冲突几何；樱花背景斜带、物流参考网格标为装饰。原始与剩余诊断见 `styles/dsh-import-diagnostics.json`。预览从实际可选扩展工程导出。

适配脚本先在内存中完成全部二十二份工程的检查，再写入扩展工程、目录和诊断；后续某套检查失败不会先覆盖前面已处理的样例。该保证针对检查失败，不声称跨文件写入在磁盘错误或进程中断时具备事务性。

### 固定来源目录

以下目录均相对于 [DSH `8dec631777c34fbbcc7d45af787bdd2c468d2cfb` 的 `packages/ppt-runtime/templates/`](https://github.com/0-CHENAI/dsh-desktop/tree/8dec631777c34fbbcc7d45af787bdd2c468d2cfb/packages/ppt-runtime/templates)。每套原文来自 `design.md`，中文页来自 `source-zh/`，英文页来自 `source/`；`curated-` 是上游目录前缀，不是 `metadata.definition.slug` 的一部分。

| Selection slug | DSH 固定快照目录 | 更早来源 |
|---|---|---|
| `dsh-monochrome` | `academic/dsh-monochrome` | Zara `templates/monochrome` |
| `dsh-blue-professional` | `business/dsh-blue-professional` | Zara `templates/blue-professional` |
| `dsh-neo-grid-bold` | `business/dsh-neo-grid-bold` | Zara `templates/neo-grid-bold` |
| `dsh-signal` | `consulting/dsh-signal` | Zara `templates/signal` |
| `dsh-broadside` | `promotion/dsh-broadside` | Zara `templates/broadside` |
| `dsh-playful` | `promotion/dsh-playful` | Zara `templates/playful` |
| `dsh-sakura-chroma` | `promotion/dsh-sakura-chroma` | Zara `templates/sakura-chroma` |
| `dsh-editorial-forest` | `work/dsh-editorial-forest` | Zara `templates/editorial-forest` |
| `swiss-signal-grid` | `consulting/curated-swiss-signal-grid` | DSH `de281a1...` / PR #320 |
| `modular-logistics-system` | `work/curated-modular-logistics-system` | DSH `de281a1...` / PR #320 |
| `nordic-operating-report` | `work/curated-nordic-operating-report` | DSH `de281a1...` / PR #320 |

### 许可与来源核对证据

- [DSH 仓库 MIT 原文](https://github.com/0-CHENAI/dsh-desktop/blob/8dec631777c34fbbcc7d45af787bdd2c468d2cfb/LICENSE)、[PPT 分发包 MIT 原文](https://github.com/0-CHENAI/dsh-desktop/blob/8dec631777c34fbbcc7d45af787bdd2c468d2cfb/packages/ppt-runtime/core/LICENSE) 与 [模板第三方声明](https://github.com/0-CHENAI/dsh-desktop/blob/8dec631777c34fbbcc7d45af787bdd2c468d2cfb/packages/ppt-runtime/core/THIRD_PARTY_NOTICES.md)。本技能保留的是适用模板段落，不复制 DSH 运行时。
- [Zara 固定版本 MIT 原文](https://github.com/zarazhangrui/beautiful-html-templates/blob/e5e204fb1f3b06290846e7dcd7aceddabeceec8c/LICENSE)；DSH `upstream/zara/LICENSE` 保留相同版权与许可。
- [html-anything 固定版本 Apache-2.0 原文](https://github.com/nexu-io/html-anything/blob/c31204544230578ac814026fecc153c6e36587ae/LICENSE) 与 [完整 Git 树](https://api.github.com/repos/nexu-io/html-anything/git/trees/c31204544230578ac814026fecc153c6e36587ae?recursive=1)；后者未列出 NOTICE。实际适配方向为 `next/src/lib/templates/skills/deck-blueprint/SKILL.md` 和 `deck-course-module/SKILL.md`，其中未带另行版权行；不臆造版权年份或权利人声明。
- [原生模板历史贡献](https://github.com/0-CHENAI/dsh-desktop/commit/de281a1ceccadb00b92df53adb106a2e87ec0b4b) 与当前固定快照的各套 `metadata.json` / `design.md`。十一套 `design.md` 的 Selection 前言之后与固定快照原文一致。原生模板中的行业数据/来源注释仍按原页保留；重新使用时需核实并替换为用户材料，不把示例或上游声明当作法律保证。

