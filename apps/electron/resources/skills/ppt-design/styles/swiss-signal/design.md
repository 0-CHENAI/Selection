# Swiss Signal

经营复盘用的硬边信号系统。封面是左侧细轨、右侧红色数字板、底部墨色行动带。内容页用同一套页眉、页脚和页码，正文靠大数字和一条红色信号，不靠卡片堆叠。

## 来源

原创构图。字号节奏参考 Zara Zhang [beautiful-html-templates](https://github.com/zarazhangrui/beautiful-html-templates) 的 `raw-grid`（MIT，提交 `e5e204fb1f3b06290846e7dcd7aceddabeceec8c`）：硬边、系统无衬线、放大的数字。没有嵌入该仓库的 HTML、字体文件或任何第三方标志。见 [ATTRIBUTION](../../ATTRIBUTION.md)。

## 画布与边距

- 画布 **960×540 pt**（13.333×7.5 in，33.867×19.05 cm）。
- 内容边距 **48 pt**。
- 内容页页眉：眉题 y=26，右侧图示编号 y=26，顶线 y=52，标题 y=62、高 46、32 pt。
- 正文区 y=122–476。页脚线 y=488。来源与页码 y=500、12 pt。
- 封面和收束页不套用内容页页眉，但保留来源和页码。

## 颜色

| Token | 色值 | 用途 |
|---|---|---|
| `$ink` | `#111111` | 标题、主数字、墨色块 |
| `$paper` | `#F5F3EE` | 页面底 |
| `$muted` | `#5C5A55` | 说明、来源。在 `$paper` 上可作小字 |
| `$accent` | `#C41628` | 唯一信号色。白字放在它上面 |
| `$line` | `#CBC8C0` | 分隔线 |
| `$surface` | `#E8E5DE` | 次级面板 |
| `$inverse` | `#FFFFFF` | 深底上的字 |

不要把 `$accent` 改成更亮的红。更亮的红配白字会掉到正文对比度以下。

## 字体

只写 `$cjk` 或 `$latin`。引擎按平台替换，不嵌入字体文件。

| 角色 | mac | win | linux |
|---|---|---|---|
| `$cjk` | PingFang SC | Microsoft YaHei | Noto Sans CJK SC |
| `$latin` | Helvetica Neue | Arial | Noto Sans |

含中文的文本必须用 `$cjk`。纯数字、页码、周次可以用 `$latin`。

## 字号

| 角色 | 范围 | 参考页用法 |
|---|---|---|
| display | 44–84 | 封面标题 46，封面数字 64，收束标题 48 |
| title | 28–36 | 内容页标题 32 |
| body | 16–22 | 主张、说明、结论 |
| caption | 11–14 | 眉题 13，来源 12 |

放不下时换行、改几何、换版式或拆页。不要把字号降到该角色的下限以下。

## 版式

几何以同目录 [deck.json](deck.json) 为准。相邻页不要重复同一个 `layout`。

| 页 | layout | 何时使用 |
|---|---|---|
| `01-cover` | `cover` | 一个主张加一个主数字。红色数字板在右，行动句在底部墨色带 |
| `02-conclusion` | `conclusion` | 先写结论，右侧三行证据数字 |
| `03-trend` | `trend` | 一条折线加右侧读数。峰值用大数字标出来 |
| `04-evidence-tree` | `evidence-tree` | 一个根因连到三条证据 |
| `05-matrix` | `matrix` | 影响 × 可控。只有一格用 `$accent` |
| `06-waterfall` | `waterfall` | 起点、若干变化、终点必须轧平 |
| `07-scorecard` | `scorecard` | 指标、实际、目标、行动。只有要复核的行加色条 |
| `08-gantt` | `gantt` | 闸门之前的工作，和闸门之后的决定 |
| `09-case` | `case` | 两个对象并排，每边一个行动句 |
| `10-architecture` | `architecture` | 交接在横向上，依赖在纵向上 |
| `11-funnel` | `funnel` | 同一队列的各段数量。封面数字必须能在这里对上 |
| `12-closing` | `closing` | 一个问题，最多两项行动。满版 `$ink` |

## 这套示例在说什么

邻里方药房 2026 Q1，虚构。封面 96.4% 是出库到送达（1369/1420），全流程是 57.0%（1369/2400）。毛利桥 22.0 − 3.2 − 2.4 − 1.6 − 0.8 = 14.0。延误里分拣占 63%，末端占 16%。换成用户材料时，数字、店名和来源一起换，并重新跑预检。
