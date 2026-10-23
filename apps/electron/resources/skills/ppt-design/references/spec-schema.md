# 声明式 Deck 契约

入口：`"<absolute-CRAFT_BUN>" "<skill>/scripts/deck.js" check|render|preview`（源码为 `scripts/deck.ts`）。TypeScript 类型与校验在 [engine/types.ts](../engine/types.ts)、[engine/schema.ts](../engine/schema.ts)。参考实现见两套风格的 `deck.json`。

## 根对象

| 字段 | 约束 |
|---|---|
| `version` | `1` |
| `canvas` | `{ width: 960, height: 540, unit: "pt" }` |
| `theme` | 见下；颜色为 `#RRGGBB` |
| `pages` | 1–200 页，id 唯一 |

## 主题

`theme.id` 为 `swiss-signal` 或 `navy-brief`（用户自定义主题须自带完整 token）。`palette` 必填 `background surface text muted accent secondary rule inverse wash`。`fonts.heading/body` 各含 `darwin|win32|linux` 的 `{latin,cjk}`。`type` 含 `hero title heading body label number footer caption`（pt）。`margin` 为建议边距，通常 48。

## 页与元素

每页：`id`、`layout`（见 [layouts](layouts.md)）、可选 `background`/`notes`/`source`、`elements[]`。

元素共同字段：`id`、`type`、`bounds: [x,y,w,h]`、可选 `z`。

| type | 额外字段 |
|---|---|
| `text` | `text`、`textCapacity: {maxLines,maxCharsPerLine}`、可选 `style` |
| `shape` | `shape: rect\|roundRect\|ellipse\|line`，`fill`/`stroke` 可为 token 或 hex |
| `image` | 绝对 `path`，`alt` |
| `chart` | `kind: bar\|column\|line\|pie\|doughnut\|waterfall`，`categories`，`series[{name,values,color?}]` |

`textCapacity` 按 CJK=1、常见 Latin≈0.58 的单位估算。实际换行仍以渲染为准。禁止字面 `\n` 两个字符；要用真换行。

## 预检

`deck_check` 一次返回全部问题，不在第一处停下。`deck_render` 失败时 `outcome: "needs_revision"`。
