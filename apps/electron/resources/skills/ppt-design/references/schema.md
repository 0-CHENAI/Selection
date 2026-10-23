# selection-deck

格式名 `selection-deck`，`version` 为 `1`。JSON 或 YAML。对象以外的字段会被拒绝，一次报出全部问题。

画布单位是 pt。默认演示页是 `{ "width": 960, "height": 540 }`（16:9）。版式家族还可以用 768×576（4:3）、810×810（1:1）、810×1440（9:16）和 931.5×1245（3:4）。别的尺寸会被拒绝，错误信息里仍会提到 960×540。

## theme

`id`、`name`、`margin`（0–96）、`source`，以及：

- `colors`：至少 `ink`、`paper`、`muted`、`accent`、`line`、`surface`、`inverse`，值为 `#RRGGBB`。可以追加 token，例如 `signal`、`good`、`watch`、`bad`。主题色本身不写透明度。
- 可选 `logo`：用户标志的路径。引擎只保存这个字符串。要画出来时，页面上放一个 `image`，`src` 与 `logo` 相同，并写 `alt`。
- `fonts.cjk` 和 `fonts.latin`：各有 `mac`、`win`、`linux`。
- `type`：`display`、`title`、`body`、`caption`，每项 `{ "min", "max" }`。

元素上的颜色可以是 `$token`、`#RRGGBB` 或 `#RRGGBBAA`。完全透明的填色不画出形状。

## page

`id`、`layout`、`background`、`elements`。可选 `name`、`notes`。`notes` 写入 PPTX 讲稿备注。参考页的 `layout` 按页编号，例如 `01-cover`、`02-content`，相邻页不能相同。

## element

`id` 在页内唯一。`bounds` 是 `{x,y,w,h}`，单位 pt。可选 `rotate`，顺时针角度，范围 -360 到 360，绕 `bounds` 中心转。可选 `role`：`panel`、`rule`、`decoration`、`content`。

| type | 还需要 |
|---|---|
| `text` | `text`、`textCapacity`、`font.family`（`$cjk` 或 `$latin`）、`font.size`（6–160）。可选 `font.face`、`leading`、`tracking`、`align`、`valign`、`weight`、`color` |
| `shape` | `shape`：`rect`、`roundRect`、`ellipse`、`line`。除了 `line`，都要 `fill`。`roundRect` 的 `radius` 是 pt |
| `image` | `src`、`alt`。按比例放进 `bounds` 并居中 |
| `chart` | `chart.kind`：`bar`、`column`、`line`、`pie`、`doughnut`、`waterfall`。`categories` 与每条 `series.values` 等长 |
| `table` | `table.columns`（宽度比例）、`rows`、`fontSize`、`fontFamily`、`color`、`fill`、`border`。可选 `rowHeights`、`face`、`header` |

不写 `role` 时：线宽不超过 0.75 pt 的线是 `decoration`；其他线条，或宽/高不超过 2 pt 的形状，是 `rule`；其余形状是 `panel`；文字、图片、图表和表格是 `content`。`decoration` 不参与重叠检查。

### 线

`line.color`、`line.width`。可选 `line.style`：`solid`、`dash`、`dot`。可选 `line.points`：`{x1,y1,x2,y2}`，相对该元素的 `bounds`。竖线常写成 `"0,0 0,h"`，笔画在框的左缘，不在框的中心；横线 `"0,0 w,0"` 在框的顶边。省略 `points` 时，更高的框画竖线，更宽的框画横线，都画在中心。`arrow` 可以是 `start`、`end` 或 `both`，导出为三角箭头。短于 20 pt 的线段不拿来和文字做重叠判断。

### 图表

可选 `valMin`、`valMax`、`holeSize`（圆环孔径，直径的百分比，0–90）、`lineWidth`、`markerSize`、`markerColor`、`grid`（`solid`、`dash`、`dot`、`none`）、`catLabelSize`、`valLabelSize`、`catLabelColor`、`valLabelColor`。

瀑布图只有一条序列，至少三个类别。第一项是起点总量，最后一项是终点总量，中间是变化量。起点加变化必须等于终点，容差 0.05。导出为堆积柱形图，隐形基座与页面背景同色。

### 表格

`columns` 是相对表宽的比例，和每行的单元格数相同。`rowHeights` 省略时均分表高。单元格可以单独写 `text`、`bold`、`fill`、`color`、`align`。表头用第一行配 `header`。

### 参考页实际用到的

五套 DSH 参考页只有文字、线和形状。斜向短线是课程页上的小折角，端点写在 `line.points` 里。`dsh-soft-editorial` 封面有一个圆角矩形；源 YAML 没有半径，转入时按该套设计说明的 24–36px 写成 28 pt。导出时半径是绝对磅值。

ppt-master 的风格参考页还有图表和表格。版式页里的图片位是虚线框，渐变被铺成一块带透明度的矩形。格式不接受渐变对象，也不放入第三方标志。

## 预检与导出

路径里的 `<skill>` 是本技能目录，`<deck.json>` 和 `<pptx>` 使用会话 `dataFolderPath` 下的绝对路径。Bun 用环境变量 `CRAFT_BUN` 的绝对路径。设置 `OFFICECLI_SKIP_UPDATE=1`。

```text
"$CRAFT_BUN" "<skill>/engine/deck-cli.mjs" check "<deck.json>"
"$CRAFT_BUN" "<skill>/engine/deck-cli.mjs" render "<deck.json>" --out "<pptx>" --screenshot "<dir>" --platform mac|win|linux
```

标准输出是一行 JSON。`check` 和失败的 `render` 退出码为 2，且 `status` 为 `needs_revision`，此时不写 PPTX。用法错误或文件无法解析时退出码为 1。通过时退出码为 0。

`render` 在预检通过后写出可编辑的 PPTX：文本、形状、图片、表格，以及 PowerPoint 原生图表。`--platform` 决定字体名，不决定画布大小。带 `font.face` 的文本会在写出后把西文和中文写成不同的字体槽。

`--screenshot` 会先试 OfficeCLI 的 `view screenshot`，再试本机已有的 LibreOffice 和 `pdftoppm`。两者都没有时，PPTX 仍然成功，`screenshots.available` 为 `false`。不要为此安装 Python 或打包新的渲染运行时。没有截图就不能把 G4 标成通过。

重叠检查看的是字形所占的框，不是整个文本框。文字压在面板上时，两个方向的相交都要超过 12 pt，并且字形没有落在面板内，才会报。线和文字按线段是否穿过字形来判断，不用线的外接矩形。
