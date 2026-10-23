# Attribution / 适配来源

## 本目录现在包含什么

页面格式、预检和 PPTX 导出是 Selection 自己的实现，使用 [PptxGenJS](https://github.com/gitbrent/PptxGenJS) 3.12.0（MIT，Copyright (c) 2015-Present Brent Ely）。没有复制 DSH Desktop 的 `packages/ppt-runtime` 或 PPTD 引擎。

参考页由开发脚本 `scripts/import-dsh-templates.ts` 从 DSH Desktop v0.2.21（提交 `1439949f46ddfe0b94446558511f979f0c4215ba`）生成的 `.page` / `.pptd` 转入 selection-deck。脚本按套名导入，这次只转入下面五套，每套中文 `deck.json` 与英文 `deck.en.json` 各 12 页。其余套没有进入本目录。

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

其余参考页预检通过。

## DSH Desktop

- 项目：<https://github.com/0-CHENAI/dsh-desktop>
- 许可：MIT。
- 版权行：Copyright (c) 2026 DataElement。
- 使用的版本：v0.2.21。

DSH 的设计说明随各套 `design.md` 保留，前面加了一段 Selection 的转入说明。

## Zara Zhang / beautiful-html-templates

- 项目：<https://github.com/zarazhangrui/beautiful-html-templates>
- 许可：MIT。
- 版权行：Copyright (c) 2026 Zara Zhang。
- 锁定提交：`e5e204fb1f3b06290846e7dcd7aceddabeceec8c`。
- 用于 `dsh-cartesian` 与 `dsh-soft-editorial`。

DSH v0.2.21 的署名是：十套模板改编自该提交下的 beautiful-html-templates（MIT）。DSH 重建了可编辑版式，把每套扩成 12 页，补了中英文示例，并把网页专用字体换成文档中的 Office 字体对。Selection 再把其中 Cartesian 与 Soft Editorial 两套转入 selection-deck。上游的 Playfair Display、Cormorant Garamond、Inter、Work Sans 不随包分发；运行时写 Georgia、Arial 以及各平台的中文字体名。

## html-anything

- 项目：<https://github.com/nexu-io/html-anything>
- 许可：Apache License 2.0。
- 锁定提交：`c31204544230578ac814026fecc153c6e36587ae`。
- 用于 `dsh-engineering-blueprint`（`deck-blueprint`）与 `dsh-course-workshop`（`deck-course-module`）。
- 该仓库没有单独的 NOTICE 文件。下面这段是从 DSH Desktop v0.2.21 `THIRD_PARTY_NOTICES.md` 保留的署名，并补上 Selection 的后续修改。

> Engineering Blueprint and Course Workshop adapt the design directions in `deck-blueprint` and `deck-course-module` from https://github.com/nexu-io/html-anything at `c31204544230578ac814026fecc153c6e36587ae`, licensed under Apache-2.0. Copyright and attribution to the HTML Anything / Nexu contributors are retained.
>
> Modified 2026-09-06 by DSH Desktop contributors: added native PPTD layouts, original example text, editable vectors, previews and semantic indexes. Editorial Notebook is separately authored by DSH and does not reuse guizang-ppt-skill.
>
> Modified 2026-10-23 by Selection: converted those PPTD pages to selection-deck. The page engine is an independent implementation and does not include html-anything source.

## 没有转入的材料

没有转入 DSH 已撤回的社区模板和木友圈材料，也没有转入 `packages/dsh-desktop-office/sources/legacy` 下的旧办公模板。DSH 另有的原生套（Modular Logistics、Swiss Signal Grid、Nordic Operating Report，提交 `de281a1ceccadb00b92df53adb106a2e87ec0b4b`）以及其余 Zara 改编套，这次都不在目录里。转换器仍可以按套名再导入。

## ppt-master

- 项目：<https://github.com/hugohe3/ppt-master>
- 许可：MIT。
- 版权行：Copyright (c) 2025-2026 Hugo He。
- 转入范围：`templates/layouts` 的 7 套结构页，以及 `templates/styles` 的 14 份 `design_spec.md`。转换脚本是 `scripts/import-ppt-master.ts`。
- 没有转入 `templates/brands` 的 21 套品牌，也没有转入企业整套（中国电信、中汽研）。没有标志、品牌手册或公司配色。

版式是带 `data-pptx-*` 标注的 SVG。坐标按 96 dpi 的 0.75 倍换成磅。占位符换成简短中文。图片位是虚线框。渐变铺成一块约 40% 的黑色，因为本格式没有渐变。路径图形没有转入。

风格参考页是按各份说明的方法新写的 12 页，不是示例站点的逐页描摹。说明里已经写了色板的五套（`duty-manual`、`incident-postmortem`、`mbb-consulting`、`operating-review`、`technical-deepdive`）沿用说明中的通用色。另外九套的说明没有色板，默认颜色取自对应示例封面的实际用色，缺的中性色按对比度补上：

| 风格 | 色板所据示例 |
|---|---|
| `academic-research` | `ppt169_researchstudio_reel_paper` |
| `consulting-decision` | `a4_four_day_week_decision_memo`（封面未取到，纸色和强调色按该示例的深色与暖纸补齐） |
| `creative-pitch` | `ppt169_night_shelf_creative_pitch` |
| `investor-pitch` | `ppt169_heatline_seed_pitch`（橙色加深，以便浅色字达到对比度） |
| `narrative-keynote` | `ppt169_qianli_jiangshan_scroll` |
| `product-launch` | `ppt169_uv_launch`（只用深色界面和冷光，没有名称、标志或路径） |
| `science-explainer` | `ppt43_sleep_science_explainer` |
| `solution-proposal` | `ppt169_every_day_counts_proposal` |
| `workshop-teaching` | `ppt169_how_color_works_workshop` |

`operating-review` 与 `incident-postmortem` 的官方示例里有公司材料。色板只用风格说明里的状态色，没有转入那些稿，也没有使用公司名称。

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
