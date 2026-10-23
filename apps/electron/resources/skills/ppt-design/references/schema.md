# selection-deck

格式名 `selection-deck`，`version` 为 `1`。JSON 或 YAML。对象以外的字段会被拒绝，一次报出全部问题。

画布只能是 `{ "width": 960, "height": 540 }`，单位是 pt。

## theme

`id`、`name`、`margin`（0–96）、`source`，以及：

- `colors`：至少 `ink`、`paper`、`muted`、`accent`、`line`、`surface`、`inverse`，值为 `#RRGGBB`。可以追加 token，例如 `night`。
- `fonts.cjk` 和 `fonts.latin`：各有 `mac`、`win`、`linux`。
- `type`：`display`、`title`、`body`、`caption`，每项 `{ "min", "max" }`。

颜色引用写成 `$ink` 或 `#RRGGBB`。

## page

`id`、`layout`、`background`、`elements`。可选 `name`、`notes`。`notes` 写入 PPTX 讲稿备注。

## element

`id` 在页内唯一。`bounds` 是 `{x,y,w,h}`，单位 pt。

| type | 还需要 |
|---|---|
| `text` | `text`、`textCapacity`、`font.family`（`$cjk` 或 `$latin`）、`font.size`（8–120） |
| `shape` | `shape`：`rect`、`roundRect`、`ellipse`、`line`。除了 `line`，都要 `fill`。`roundRect` 的 `radius` 是 pt |
| `image` | `src`、`alt`。按比例放进 `bounds` 并居中 |
| `chart` | `chart.kind`：`bar`、`column`、`line`、`pie`、`doughnut`、`waterfall`。`categories` 与每条 `series.values` 等长 |

`role` 可以是 `panel`、`rule`、`decoration`、`content`。不写时：线条或宽/高不超过 2 pt 的形状是 `rule`，其他形状是 `panel`，文字、图片、图表是 `content`。

瀑布图只有一条序列，至少三个类别。第一项是起点总量，最后一项是终点总量，中间是变化量。起点加变化必须等于终点，容差 0.05。

## 预检与导出

路径里的 `<skill>` 是本技能目录，`<deck.json>` 和 `<pptx>` 使用会话 `dataFolderPath` 下的绝对路径。Bun 用环境变量 `CRAFT_BUN` 的绝对路径。设置 `OFFICECLI_SKIP_UPDATE=1`。

```text
"$CRAFT_BUN" "<skill>/engine/deck-cli.mjs" check "<deck.json>"
"$CRAFT_BUN" "<skill>/engine/deck-cli.mjs" render "<deck.json>" --out "<pptx>" --screenshot "<dir>" --platform mac|win|linux
```

标准输出是一行 JSON。`check` 和失败的 `render` 退出码为 2，且 `status` 为 `needs_revision`，此时不写 PPTX。用法错误或文件无法解析时退出码为 1。通过时退出码为 0。

`render` 在预检通过后写出可编辑的 PPTX：文本、形状、图片，以及 PowerPoint 原生图表。瀑布图写成堆积柱形图，隐形基座与页面背景同色。`--platform` 决定字体名，不决定画布大小。

`--screenshot` 会先试 OfficeCLI 的 `view screenshot`，再试本机已有的 LibreOffice 和 `pdftoppm`。两者都没有时，PPTX 仍然成功，`screenshots.available` 为 `false`。不要为此安装 Python 或打包新的渲染运行时。没有截图就不能把 G4 标成通过。
