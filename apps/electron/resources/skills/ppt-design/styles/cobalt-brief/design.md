# Cobalt Brief

流程和项目简报。封面是顶上钴蓝细条、右侧数字板、底部三列事实，不是墨色满版带。内容页底色是奶油色，强调色只留给当前要动的那一项。

## 来源

配色取自 Zara Zhang [beautiful-html-templates](https://github.com/zarazhangrui/beautiful-html-templates) 的 `blue-professional`（MIT，提交 `e5e204fb1f3b06290846e7dcd7aceddabeceec8c`）：奶油 `#FDFAE7`、钴蓝 `#1E2BFA`、墨 `#111111`。该模板的参考字体是 Space Grotesk 与 Inter；运行时改用下表的系统字体，不嵌入字体文件。页面几何是原创的。见 [ATTRIBUTION](../../ATTRIBUTION.md)。

## 画布与边距

- 画布 **960×540 pt**（13.333×7.5 in，33.867×19.05 cm）。
- 内容边距 **48 pt**。
- 内容页页眉：眉题 y=26，图示编号 y=26，顶线 y=52，标题 y=62、高 46、32 pt。
- 正文区 y=122–476。页脚线 y=488。来源与页码 y=500、12 pt。
- 封面用顶部 8 pt 色条和底部事实行。收束页用 `$night`，行动放在右侧 `$accent` 面板。

## 颜色

| Token | 色值 | 用途 |
|---|---|---|
| `$ink` | `#111111` | 标题、主数字 |
| `$paper` | `#FDFAE7` | 页面底 |
| `$muted` | `#5A5A5A` | 说明、来源 |
| `$accent` | `#1E2BFA` | 当前要动的那一项。白字可以放在上面 |
| `$line` | `#E2DECF` | 分隔线 |
| `$surface` | `#EEEEFB` | 次级面板 |
| `$inverse` | `#FFFFFF` | 深色或强调色上的字 |
| `$night` | `#161616` | 收束页底 |
| `$mist` | `#D7D9FF` | `$night` 上的说明字 |

`$accent` 不能当作 `$night` 上的小字，对比度不够。深底上的说明用 `$mist` 或 `$inverse`。

## 字体

只写 `$cjk` 或 `$latin`。不嵌入字体文件。

| 角色 | mac | win | linux |
|---|---|---|---|
| `$cjk` | PingFang SC | Microsoft YaHei | Noto Sans CJK SC |
| `$latin` | Arial | Arial | Noto Sans |

含中文必须用 `$cjk`。纯数字和页码可以用 `$latin`。

## 字号

| 角色 | 范围 | 参考页用法 |
|---|---|---|
| display | 44–80 | 封面标题 44，封面数字 72 |
| title | 28–36 | 内容页标题 32，收束问题 36 |
| body | 16–22 | 结论、说明、行动 |
| caption | 11–14 | 眉题 13，来源 12 |

放不下时换行、改几何、换版式或拆页。不要把字号降到该角色的下限以下。

## 版式

几何以同目录 [deck.json](deck.json) 为准。不要把 Swiss Signal 的黑带封面换成本套颜色后复用。

| 页 | layout | 何时使用 |
|---|---|---|
| `01-cover` | `cover` | 顶条、右侧数字板、底部三个事实。没有底部墨色带 |
| `02-conclusion` | `conclusion` | 一句结论，下面三列数字 |
| `03-trend` | `trend` | 左侧说明面板，右侧全年折线 |
| `04-evidence-tree` | `evidence-tree` | 顶部结论条，下面三列证据，底部收成一句行动 |
| `05-matrix` | `matrix` | 满版 2×2。只有一格用 `$accent` |
| `06-waterfall` | `waterfall` | 图在上，变化数字在下，必须轧平 |
| `07-scorecard` | `scorecard` | 四张卡。要复核的卡用强调色条 |
| `08-gantt` | `gantt` | 周次网格加一条闸门。采购在闸门右侧 |
| `09-case` | `case` | 同一指标的两列对照，不是两张卡 |
| `10-architecture` | `architecture` | 三段横条，每段写主人 |
| `11-funnel` | `funnel` | 左对齐、逐段变短的横条 |
| `12-closing` | `closing` | `$night` 上一个问题，右侧一块行动 |

## 这套示例在说什么

澄湾检验 2025，虚构。封面 4.6 小时是年末中位周转。93.1% 是审核后的准时发布（9870/10600），全流程是 82.3%（9870/12000）。周转桥 6.1 − 0.8 − 0.4 + 0.3 − 0.6 = 4.6，净变化 −1.5。第二台设备省 0.3 小时，早高峰接收大约能省 0.7 小时。周一 7:30–9:00 占标本 38%。换成用户材料时，数字和来源一起换，并重新跑预检。
