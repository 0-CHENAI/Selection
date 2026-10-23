# PPT 设计第二轮：ppt-master 视觉研究

分支 `feat/ppt-design-skill`。研究对象是仓库外浅克隆 `https://github.com/hugohe3/ppt-master` 的 `523e5bd972f94c3cac8742fec0d54d43824a17bb`。SVG 用 `rsvg-convert` 渲染成 1280×720 PNG 后逐张查看，没有把这些 PNG 或 SVG 贴进成品。

## 看过的页面

`templates/layouts/report_core/templates/`：`01_cover`、`02_section_divider`、`03_agenda`、`05_two_content`、`07_kpi_row`、`08_chart_insight`、`10_process_timeline`、`13_closing`。

`templates/layouts/editorial_bleed/templates/`：`01_hero_full`、`03_split_bleed`、`05_chapter_full`、`06_quote_over_image`、`09_full_statement`、`10_closing_full`。

同时读了 `styles/mbb-consulting`、`styles/consulting-decision`、`styles/technical-deepdive` 的 design spec，以及 `references/visual-styles/dark-tech.md`、`editorial.md`。`technical-deepdive` 和 `dark-tech` 没有页级 SVG，只有配色和构图说明。`docs/assets/screenshots/archive/` 里的 swiss / tech / magazine 预览用来对照“成品观感”，那些预览依赖照片，不能当成本技能的素材。

## 好看的具体手法

画布都是 1280×720。换算到本技能是 33.8667×19.05 cm，1 px ≈ 0.02646 cm。

- **两套底平面。** report_core 的封面、章节、结尾用反色满版，内容页才是白底加页眉页脚线。分隔页如果只是白底上的小字，就和内容页没有节奏差。
- **内容区占满中段。** 内容页标题大约在 y=88、高 56 px（约 28 px 字），正文从 y=176 到 y=640。不是把文字堆在左上角后留出下半页。
- **色块面积。** 封面强调条虽然短，但底是整页深色。editorial_bleed 的图片槽贴边：整页、半页或三等分，文字压在色块上，而不是缩在安全框里。
- **字号台阶。** 封面标题约 52 px，内容标题 28 px，分栏正文 18–21 px，页脚 12 px。KPI 数字居中并且单独成行，下面还有一块证据区，避免一个数字漂在空白里。
- **图表。** `column_chart.svg` 和 mbb spec 都要求柱顶直接标数字、去掉可有可无的网格。report 的 chart 页是左图右解释，两块都拉到页脚线。
- **流程。** 四个步骤挂在一条横轴上，下面还有一条结论带。步骤不是四张漂在上半页的小卡片。
- **深色科技。** 规范写的是同心环、括号、节点和低透明度大号，而不是把商务页涂黑。留白要由几何占住，不能变成下半页空场。
- **杂志。** 超大序号、竖线、出血分割、拉引文居中。衬线标题对无衬线正文。没有照片时，规范自己也说退回文字主导的 editorial，而不是画一个虚线图片框。

第一轮失败，是因为只保留了“细线 + 左上角文字 + 换色”，没有把满版、内容区高度和图表标注做出来。

## 落到 Selection 的决定

不写通用 SVG 转换器。OfficeCLI 1.0.157 把 SVG 存成图片，不是可编辑形状。三套构图直接生成矩形、椭圆、圆角矩形、文字和原生图表。

| 页 | business（report_core + mbb） | dark-tech | fresh-editorial（editorial_bleed） |
|---|---|---|---|
| 封面 | 左侧 15.2 cm 海军蓝满版，右侧三块信息 | 同心环、角括号、底部信息条 | 右侧陶土出血，左侧衬线标题 |
| 章节 | 整页海军蓝，右侧大号，底部强调条 | 左侧强调轨 + 圆角面板 | 森林满版，大号贴左缘 |
| 要点/目录 | 目录是编号色块行；要点是色条卡片 | 目录是节点脊线；四点为二乘二 | 目录是超大序号；要点是首条通栏 |
| 对比 | 等分色头卡片 | 左 58% / 右描边，不对称 | 左右各半出血，无间隙 |
| 数字 | 左侧满版数字 | 同心环 + 底部说明带 | 大号、粗线、左脊 |
| 流程/时间 | 流程是圆点轨道；时间是顶部横轴 | 流程是管线；时间脊线在右 | 流程竖排；时间为巨大阶段字 |
| 图表 | 右侧海军蓝读数 | 底部通栏读数 | 右侧拉引栏 |
| 引言/结尾 | 左色块引号；结尾白底接触条 | 描边画框；青色接触条 | 居中拉引；陶土满版加纸色条 |

图表统一 `gridlines=none`、`dataLabels=outsideEnd`、`valaxisvisible=false`，系列色用该风格的 accent。读回见商务示例：系列「模拟温差」值为 0.4, 0.9, 1.6, 2.1，颜色 `#1D6FB8`。

没有复制 icons/ 或 sounds/。装饰是原生几何。中文字体规则仍按平台 catalog：Linux 正文 Noto Sans CJK SC，杂志标题 Noto Serif CJK SC。

## 示例自查

同一主题「城市热岛降温」11 页，三套各生成一次。OfficeCLI 1.0.157 `validate` 成功。截图来自 `officecli view html`。预览页默认 `height: 100vh; overflow: hidden`，按视口高度截图时第 2 页起是纯色底，不能当验收。修正是给 `html` 加上 `headless`，取消侧栏和备注，把 11 页按 960pt×540pt 竖排，再用 Chrome 以 1280×7920 截整条，然后切成 1280×720。修正后的 33 页都有内容：满版色块、内容区接到页脚、图表无网格且柱顶有数字。没有发现缺字、重叠或半页空白，因此没有做第二轮几何返工。和 ppt-master 成品截图的剩余差距是照片与插画；本技能不生成这些图片。版式 SVG 对照是线框，并排图放在 `/opt/cursor/artifacts/ppt-v2/<style>-compare.png`。
