# selection-deck

格式名 `selection-deck`，`version` 为 `1`。JSON 或 YAML。对象以外的字段会被拒绝，一次报出全部问题。

画布单位是 pt。默认演示页是 `{ "width": 960, "height": 540 }`（16:9）。版式家族还可以用 768×576（4:3）、810×810（1:1）、810×1440（9:16）和 931.5×1245（3:4）。A4 成稿是 930×1315.5。除此之外，宽和高都在 200–2000 pt 的画布也可以，例如 1440×810、1440×450、675×287.25。超出这个范围会被拒绝，错误信息里仍会提到 960×540。

可选 `profile`：`authored` 是新稿的默认检查；`example` 只用于已经出版的示例成稿，放宽对比度、孤字和正文之间的重叠，仍然检查完全落在画布外的元素。新稿不要写 `example`。

## theme

`id`、`name`、`margin`（0–96）、`source`，以及：

- `colors`：至少 `ink`、`paper`、`muted`、`accent`、`line`、`surface`、`inverse`，值为 `#RRGGBB`。可以追加 token，例如 `signal`、`good`、`watch`、`bad`。主题色本身不写透明度。
- 可选 `logo`：用户标志的路径。引擎只保存这个字符串。要画出来时，页面上放一个 `image`，`src` 与 `logo` 相同，并写 `alt`。
- `fonts.cjk` 和 `fonts.latin`：各有 `mac`、`win`、`linux`。
- `type`：`display`、`title`、`body`、`caption`，每项 `{ "min", "max" }`。

元素上的颜色可以是 `$token`、`#RRGGBB` 或 `#RRGGBBAA`。完全透明的填色不画出形状。

## page

`id`、`layout`、`background`、`elements`。可选 `name`、`notes`。`notes` 写入 PPTX 讲稿备注。参考页的 `layout` 按页编号，例如 `01-cover`、`02-content`，相邻页允许相同，按内容关系选择布局。

## element

`id` 在页内唯一。`bounds` 是 `{x,y,w,h}`，单位 pt。可选 `rotate`，顺时针角度，范围 -360 到 360，绕 `bounds` 中心转。可选 `role`：`panel`、`rule`、`decoration`、`content`。

| type | 还需要 |
|---|---|
| `text` | `text`、`textCapacity`、`font.family`（`$cjk` 或 `$latin`）、`font.size`（6–240）。可选 `font.face`、`leading`、`tracking`（-20–80）、`align`、`valign`、`weight`、`italic`、`color` |
| `shape` | `shape`：`rect`、`roundRect`、`ellipse`、`line`、`path`。除了 `line` 和只有描边的 `path`，都要 `fill`、`gradient` 或 `pattern`。`roundRect` 的 `radius` 是 pt。`path` 还要 `path`（SVG 路径，坐标是形状框内的 pt） |
| `image` | `src`、`alt`。默认 `fit: contain`，按比例放进 `bounds` 并居中。`fit: fill` 铺满 `bounds`，用于已经裁好的图 |
| `chart` | `chart.kind`：`bar`（横向条形）、`column`、`line`、`pie`、`doughnut`、`waterfall`、`area`、`scatter`、`bubble`、`radar`、`combo`、`stacked`、`stackedPercent`。`categories` 与每条 `series.values` 等长 |
| `table` | `table.columns`（宽度比例）、`rows`、`fontSize`、`fontFamily`、`color`、`fill`、`border`。可选 `rowHeights`、`face`、`header` |

不写 `role` 时：线宽不超过 0.75 pt 的线是 `decoration`；其他线条，或宽/高不超过 2 pt 的形状，是 `rule`；其余形状是 `panel`；文字、图片、图表和表格是 `content`。`decoration` 不参与重叠检查。

### 线

`line.color`、`line.width`。可选 `line.style`：`solid`、`dash`、`dot`。可选 `line.points`：`{x1,y1,x2,y2}`，相对该元素的 `bounds`。竖线常写成 `"0,0 0,h"`，笔画在框的左缘，不在框的中心；横线 `"0,0 w,0"` 在框的顶边。省略 `points` 时，更高的框画竖线，更宽的框画横线，都画在中心。`arrow` 可以是 `start`、`end` 或 `both`，导出为三角箭头。短于 20 pt 的线段不拿来和文字做重叠判断。

### 图表

可选 `valMin`、`valMax`、`holeSize`（圆环孔径，直径的百分比，0–90）、`lineWidth`、`markerSize`、`markerColor`、`grid`（`solid`、`dash`、`dot`、`none`）、`catLabelSize`、`valLabelSize`、`catLabelColor`、`valLabelColor`。

瀑布图只有一条序列，至少三个类别。第一项是起点总量，最后一项是终点总量，中间是变化量。起点加变化必须等于终点，容差 0.05。导出为四段堆积柱：隐形基座与页面背景同色且不标数字，合计用 `$ink`，增加用第二种颜色（默认 `$accent`），减少用第三种颜色（默认 `$muted`）。合计、增加和减少的数值写在柱段中部，深色柱上用反色；柱段放不下时改写在柱顶。增加带正号，减少带减号。条形图 `bar` 是横向的，导出时把第一个类别画在上方，类别名和数值标在条的末端。

`area` 是面积图。`stacked` 和 `stackedPercent` 是纵向堆积柱，至少两条序列。`radar` 至少三个类别，导出为填充雷达。`scatter` 和 `bubble` 的每条序列都要带与 `categories` 等长的 `x`，而且各条序列的 `x` 必须相同；`bubble` 还要正数 `sizes`。`combo` 至少一条柱和一条线：在序列上写 `render: column` 或 `render: line`；都不写时，最后一条是线。柱和线分轴。

省略字号时，类别轴 13pt、刻度 12pt、图例 12pt、数据标注 12pt 加粗。刻度色比 `$muted` 再深一档，靠近 `$ink`。页标题写在图表外面，约 22–28pt。数值轴的最大值和步长取 1、2、5 倍数量级，例如 0/20/40/60/80；写了 `valMax` 时保留该最大值，只把步长取整。柱、条、堆积、饼和圆环默认标出数值；折线和面积只标每条序列的最低点和最高点，贴在绘图区左右边缘的点改标到标记内侧；散点标类别名；气泡和雷达不额外标数值。柱线组合的柱和线共用类目轴，折线点落在对应柱的中心，柱上和折线点都标数值，端点标注留在绘图区内；右轴同样取整，例如 0/5/10/15。`showValues: false` 关掉这些标注。饼和圆环的类别与数值标在扇区外侧，并加一条浅灰引出线。笛卡尔图默认不画网格；散点、气泡和雷达保留浅网格。轴线是主题色混出的浅灰，不用 Office 默认蓝。需要网格时写 `grid`。左右数值轴的刻度用同一套 12pt 文字和同一刻度色；预览会把原生纵轴刻度画得更小更浅，所以这些刻度改成页面文字。

颜色、图例和数据标签跟随主题的 `$accent`、`$ink`、`$muted` 和中文字体，不使用 Office 默认蓝和 Arial。省略 `colors` 时按主题循环取色。

用户在这条需求里明确点名了已安装的图表技能时，对应的图可以写成 `image`，并带 `chartImage`：`skill` 是技能 slug，`format` 是 `svg` 或 `png`，`data` 是原始数据表。图片按槽位 `bounds` 放置，`fit` 用 `fill`，并套用模板主题色。`deck_check` 会检查这张图的尺寸和是否越出画布，并要求同一张数据表出现在页面 `notes` 里。备注会导出为 speaker notes。宽或高小于 48 pt 算过小。论证版式里原来的 `chart` 槽可以改放这种图片图表，几何仍要落在目录上。技能失败、超时或没有安装时改回原生 `chart`，不要留一张坏图。没有点名时不要改用图片图表。

### 渐变、图案、路径和阴影

`gradient` 写在形状上：`kind` 为 `linear` 或 `radial`，`stops` 至少两个 `{offset, color}`，`offset` 从 0 到 1。线性渐变的 `angle` 从向右起、顺时针、y 向下，与 SVG 用户空间一致。`absolute: true` 时角度不跟形状框走。径向渐变用 `cx`、`cy`（0–1，相对形状框）。

`pattern` 是 `{preset, foreground, background}`。`preset` 使用 PowerPoint 的图案名，例如 `pct5`。两种颜色都可以带透明度。半色调网点的空隙保持透明，避免一块不透明底盖住下面的照片。阿拉伯文和希伯来文使用 `font.rtl`，导出时从右向左排。

`pathRule` 可以是 `evenodd`。`shadow` 可以写在形状或文字上：`color`，以及可选的 `opacity`、`blur`、`offset`、`angle`。

### 表格

`columns` 是相对表宽的比例，和每行的单元格数相同。`rowHeights` 省略时均分表高。单元格可以单独写 `text`、`bold`、`fill`、`color`、`align`。表头用第一行配 `header`。

### 参考页实际用到的

五套 DSH 参考页只有文字、线和形状。斜向短线是课程页上的小折角，端点写在 `line.points` 里。`dsh-soft-editorial` 封面有一个圆角矩形；源 YAML 没有半径，转入时按该套设计说明的 24–36px 写成 28 pt。导出时半径是绝对磅值。

ppt-master 的示例成稿还有图表、表格、路径、渐变、图案和图片。图片按内容哈希放在 `styles/examples/_assets/`，长边不超过 1600 px。只被归档成稿引用的图片字节在 `styles/_archive/assets/`，deck 里的 `src` 字符串没有改。版式页仍是结构示意：图片位是虚线框，渐变铺成一块带透明度的矩形。选择器里仍展示的成稿留在安装包内；归档成稿不随包分发。其中保留来源商标与官方标识的成稿只作参考模板。

## 预检与导出

路径里的 `<skill>` 是本技能目录，`<deck.json>` 使用会话 `dataFolderPath` 下的绝对路径。Bun 用环境变量 `CRAFT_BUN` 的绝对路径。设置 `OFFICECLI_SKIP_UPDATE=1`。在本应用里，可见的 PPTX 不写在 `dataFolderPath`：保存 deck 后读取 `data/ppt-output.json` 的 `path`，截图打到 `data/slides`。不要再 `render --out` 出第二份。

```text
"$CRAFT_BUN" "<skill>/engine/deck-cli.mjs" layouts
"$CRAFT_BUN" "<skill>/engine/deck-cli.mjs" check "<deck.json>"
"$CRAFT_BUN" "<skill>/engine/deck-cli.mjs" render "<deck.json>" --out "<pptx>" --screenshot "<dir>" --platform mac|win|linux
```

标准输出是一行 JSON。`check` 和失败的 `render` 退出码为 2，且 `status` 为 `needs_revision`，此时不写 PPTX。用法错误或文件无法解析时退出码为 1。通过时退出码为 0。

`render` 在预检通过后写出可编辑的 PPTX：文本、形状、图片、表格，以及 PowerPoint 原生图表。`--platform` 决定字体名，不决定画布大小。带 `font.face` 的文本会在写出后把西文和中文写成不同的字体槽。

`--screenshot` 会先试 OfficeCLI 的 `view screenshot`，再试本机已有的 LibreOffice 和 `pdftoppm`。两者都没有时，PPTX 仍然成功，`screenshots.available` 为 `false`。不要为此安装 Python 或打包新的渲染运行时。没有截图就不能把 G4 标成通过。

重叠检查看的是字形所占的框，不是整个文本框。文字压在面板上时，两个方向的相交都要超过 12 pt，并且字形没有落在面板内，才会报。线和文字按线段是否穿过字形来判断，不用线的外接矩形。
