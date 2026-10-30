# 风格

先读本页，再只打开选定风格的 `design.md`。中文参考页是 `deck.json`。DSH 的十六套还有英文 `deck.en.json`。不要一次读入两套参考页。

索引：[styles/catalog.json](../styles/catalog.json)。DSH 十六套是 12 页、960×540 pt。ppt-master 的参考页是官方成稿，页数和画布写在目录里。许可见 [ATTRIBUTION](../ATTRIBUTION.md)。图片出处见 [styles/examples/CREDITS.md](../styles/examples/CREDITS.md)。

主题在 [styles/themes/catalog.json](../styles/themes/catalog.json)。主题只换颜色和字体，不换页面几何。`ink` 是字色，`paper` 是纸色：浅色主题的纸是浅的，深色主题的纸是深的，所以 `$ink` 写在 `$paper` 上始终可读。封面若要用反色，背景写 `$ink`、字写 `$paper`。任意主题都可以套到任意风格或版式上。预检会检查正文、辅助色、强调色上的反色，以及面板上的正文。

用户品牌不是一份现成 JSON。给出主色、辅色，以及可选的标志路径，生成一套 token：纸色、文字、强调、辅助色和反色都会调到对比度门槛以上。标志只记在 `theme.logo`。页面要显示它时，用一个 `src` 相同的图片元素。不要把用户公司的标志或品牌手册写进仓库。示例成稿里随来源保留的第三方标识只作参考模板，新稿不要照搬那些标志。

| id | 材料 | 封面气质 | 许可 |
|---|---|---|---|
| `dsh-cartesian` | 理性简报、取舍、可检验的判断 | 暖石色纸面，衬线标题，细圆和发丝线 | MIT |
| `dsh-course-workshop` | 培训、课程、工作坊 | 学习目标边栏，概念图，练习和自测 | Apache-2.0 |
| `dsh-editorial-notebook` | 研究、观点、业务叙事 | 双栏论述，边注，证据条，决策矩阵 | MIT |
| `dsh-engineering-blueprint` | 架构评审、技术方案、执行计划 | 纸张底色，工程网格，流程盒，反馈路径 | Apache-2.0 |
| `dsh-soft-editorial` | 观察手记、需要细读的判断 | 奶油纸，圆角色卡，衬线大标题 | MIT |

新增十一套 DSH（均为 MIT）：`dsh-monochrome`、`dsh-blue-professional`、`dsh-neo-grid-bold`、`swiss-signal-grid`、`dsh-signal`、`dsh-broadside`、`dsh-playful`、`dsh-sakura-chroma`、`modular-logistics-system`、`nordic-operating-report`、`dsh-editorial-forest`。保留原导入工程；可选中文/英文参考页按 catalog 读取 `styles/examples/imported/` 中的独立适配样例。

下面十四套的方法来自 ppt-master 的风格说明。每一套的参考页都是 ppt-master-examples 里的官方成稿，路径在目录的 `deck` 字段，画布可能是 16:9、4:3、A4、方形、竖版或横幅。`incident-postmortem` 指向事故复盘成稿，`operating-review` 指向经营复盘成稿，`product-launch` 指向产品发布成稿。这些成稿里的第三方标识只作参考。`mbb-consulting` 只表示文档密度的决策写法，不代表任何咨询公司。

| id | 材料 | 默认气质 |
|---|---|---|
| `academic-research` | 问题、方法、限度 | 分栏封面，衬线 |
| `consulting-decision` | 结论先行的决定 | 暖纸，编号 |
| `creative-pitch` | 一个洞察 | 近黑纸，金色 |
| `duty-manual` | 机制先于规则 | 深色网格 |
| `incident-postmortem` | 时间线与因素 | 白纸，红色标记 |
| `investor-pitch` | 这一步买到什么 | 暖纸，一个大数字 |
| `mbb-consulting` | 编号证据 | 白纸，蓝色 |
| `narrative-keynote` | 一个节拍 | 暖纸，大字，无页脚 |
| `operating-review` | 结果与偏离 | 白纸，状态色 |
| `product-launch` | 先演示再命名 | 深色，一句 |
| `science-explainer` | 现象先于名字 | 暖纸，衬线 |
| `solution-proposal` | 可以被否决的做法 | 圆角卡片 |
| `technical-deepdive` | 先画边界 | 深色网格 |
| `workshop-teaching` | 目标、示范、练习 | 暖纸，圆角 |

十二套自有主题可以套到任意风格或版式上。名字不使用公司或产品的品牌。

| id | 名字 | 启发 |
|---|---|---|
| `jiangshan` | 千里青绿 | 青绿山水的纸色与青蓝 |
| `sugar-rush` | 糖彩 | 高饱和撞色 |
| `glass-saas` | 玻璃界面 | 冷色雾面 |
| `paper-cut` | 剪纸月色 | 夜蓝与暖纸 |
| `pixel-breakfast` | 像素早餐 | 深靛、蛋黄与番茄 |
| `swiss-grid` | 瑞士网格 | 网格与一块红 |
| `tea-tasting` | 点茶 | 茶褐与朱印 |
| `brutal-stone` | 粗石 | 石色、近黑与一块红 |
| `zine-shelf` | 独立书摊 | 奶油纸、蓝与粉 |
| `keynote-stage` | 暗场讲台 | 自拟近黑场，不是任何发布会配色 |
| `academic-ink` | 论文墨色 | 墨色与一处蓝 |
| `night-circuit` | 夜航电路 | 深色界面与一处冷光 |

默认用该风格 deck 里的主题。要换色时换成上面的一套，或生成用户品牌主题，然后重新预检。字体、边距和字号区间以锁定风格的 `design.md` 为准。参考页里的句子和数字是虚构示例，必须换成用户材料；换完后几何可以调整，但要重新预检。

没有合适的参考页时，仍使用该风格的 token、边距和字号区间，新开一个 `layout` id，不要混入另一套的色值。

两处中文源页面会报 `orphan`：`dsh-course-workshop` 第 3 页 `03:t7`「从引导练习走向独立完成」，`dsh-engineering-blueprint` 第 3 页 `03:t101`「明确每一层边界」。沿用这些页时重排句子。不要缩小字号，也不要把框加宽到撞上邻列。首批其余参考页没有这个问题。新增十一套的源页诊断与适配记录见 `styles/dsh-import-diagnostics.json`；可选参考页使用目录指向的独立样例扩展，不覆盖源页。
