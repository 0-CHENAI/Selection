# 配方输入契约（version 1）

入口：`"<absolute-CRAFT_BUN>" "<skill>/scripts/compose.ts" --spec "/ABS/spec.json" --out "/ABS/dataFolder/deck.pptx" [--officecli "/ABS/bin"] [--font-cjk "Noto Sans CJK SC"]`。从环境 `CRAFT_BUN` 解析应用附带 Bun 的绝对路径，以参数数组调用；POSIX 是 `"$CRAFT_BUN"`，PowerShell 是 `& $env:CRAFT_BUN`，不依赖 PATH 的 `bun`、不安装运行时。所有路径占位符须换成真实绝对路径；OfficeCLI 进程设置 `OFFICECLI_SKIP_UPDATE=1`。

完整机器规则及每 slot 字数/项数容量见 [scripts/spec.schema.json](../scripts/spec.schema.json)；[layouts/catalog.json](../layouts/catalog.json) 只说明选型，不提供可执行坐标。实际几何按风格分别写在 `scripts/compose-*.ts`，由 [scripts/recipe.ts](../scripts/recipe.ts) 的 `renderRecipe` 调用。脚本按固定字号做适配预检；未知字段、空的必填内容、超量数组或过长文本不能靠忽略字段通过。

## 根与通用页

根对象**仅**包含：

| 字段 | 类型/约束 |
|---|---|
| `version` | 数字常量 `1` |
| `dataFolderPath` | 会话 scratch 绝对目录；输出必须在其中，不覆盖已有文件 |
| `style` | [风格包索引](../styles/index.json) 中的 id：`business` / `dark-tech` / `fresh-editorial` / `swiss-grid` / `academic-paper` / `workshop` / `data-brief` / `midnight-stage` / `blueprint` / `ink-journal` |
| `slides` | 按交付顺序排列的非空 slide 数组 |

每个 slide **仅**包含必填 `layout`、`title`、`notes`、`slots`，以及可选 `eyebrow`、`subtitle`、`source`。`layout` 是下面 14 个 ID 之一；其余通用字段均为字符串，`slots` 按 layout 严格匹配。`notes` 是实际讲稿/说明，不拿备注隐藏本应可见的证据或溢出正文。来源可选不代表事实免于引用：事实页应提供可追溯 `source`，完整依据可保留于 notes/计划。示例/演示数据明确标识。

不允许额外键；不添加 `id`、`order`、`font`、`size`、`color`、`x/y`、`transition`、任意 `elements` 等。稳定页 ID、字体决策、节奏及动态意图属于计划/锁，不属于此 JSON。

## 每个 layout 的完整 slots

以下 `string` 指字符串，`number` 指有限数值；所有嵌套对象同样不接受未知键。内容还必须满足配方容量和真实渲染适配，数组合法并不保证文字能放下。

| layout | slots（必填字段，除 `?` 标示外） |
|---|---|
| `cover` | `{presenter: string, date: string}` |
| `agenda` | `{items: string[3..6]}` |
| `section` | `{number: string, body: string}` |
| `bullets` | `{items: string[3..5]}` |
| `image-text` | `{body: string, image?: {path: absoluteString, alt: string}, panel?: {headline: string, body: string}}`；**image 与 panel 必须恰好一个** |
| `comparison` | `{left: {heading: string, body: string}, right: {heading: string, body: string}}` |
| `big-number` | `{value: string, label: string, context: string}` |
| `timeline` | `{items: [{label: string, title: string, body: string}]}`，3–5 项 |
| `process` | `{items: [{title: string, body: string}]}`，3–5 项 |
| `chart` | `{type: column|bar|line|pie|doughnut, categories: string[2..8], series: [{name: string, values: number[]}], insight: string}`；series 1–3 组，每组 values 长度与 categories 相等 |
| `quote` | `{quote: string, attribution: string}` |
| `closing` | `{body: string, contact: string}` |
| `cards` | `{items: [{title: string, body: string}]}`，3–4 项 |
| `matrix` | `{xLabel: string, yLabel: string, cells: [{title: string, body: string}]}`，恰好 4 格 |

`image.path` 必须是存在的可读绝对文件路径，不是 URL、base64 或未生成的素材名；alt 描述真实图像。没有图就选择 panel，不放空图片框。讲者/日期/联系信息以用户事实为准，不能按当前日期或示例臆造。

## 图表含义与限制

- `column/bar` 用于类别比较；从诚实零基线读取长度，保留负数含义。`line` 用于有序连续变化，不把无序分类连线伪造趋势。
- `pie/doughnut` 用于一个整体的非负组成；只使用一个有意义的系列，整体须有正总量。不用多组系列伪造可比扇区，不用负数或全零组成。
- `series` 的组数是语法上限，不是图表类型都应使用三组。单位、期间、样本范围、估算标识放在可见的标题/副标题/insight/source；JSON 无独立单位字段。
- `insight` 是数据支持的解释，不能替代数据标签、来源或轴检查。数值与文字必须一致；不拿一个图表通过代替其他图表验证。

## 完整最小示例

下列为明确的演示内容；真实任务替换事实、路径和来源，不直接当作用户数据。

```json
{
  "version": 1,
  "dataFolderPath": "/ABS/session-scratch",
  "style": "business",
  "slides": [
    {
      "layout": "cover",
      "title": "演示方案：先验证再推广",
      "subtitle": "示例材料，不代表真实项目结论",
      "notes": "本文件仅说明规格格式，未使用真实客户数据。",
      "source": "示例内容；非真实业务数据",
      "slots": {"presenter": "演示团队（示例）", "date": "演示日期待项目确定"}
    },
    {
      "layout": "chart",
      "title": "示例试点量逐阶段增加",
      "subtitle": "单位：个；各阶段为演示情景",
      "notes": "数值 10、20、30 均为示例，用于演示图表系列绑定，不构成实际业务证据。",
      "source": "演示数据，非实测结果",
      "slots": {
        "type": "column",
        "categories": ["阶段一", "阶段二", "阶段三"],
        "series": [{"name": "示例试点", "values": [10, 20, 30]}],
        "insight": "此处只展示情景增量，不作真实效果归因。"
      }
    },
    {
      "layout": "closing",
      "title": "先确认试点，再确定推广范围",
      "notes": "结束页行动同样只是示例；实际责任人和时间需以项目材料为准。",
      "source": "示例行动建议",
      "slots": {"body": "明确验证标准与责任后，再进入执行。", "contact": "联系信息以实际项目为准"}
    }
  ]
}
```

生成只得到 **GENERATED_UNREVIEWED**。严格字段/数量检查、容量估算、OfficeCLI validate 与视觉检查分别解决不同问题；任何一个都不能替代其他步骤。输入过长时改计划、换语义合适的布局或拆页，不自动缩字、不静默截断、不丢事实。

成功生成回执为 JSON，包含 `outcome: "GENERATED_UNREVIEWED"`、`path`、`slides`、`style`、`visualReviewRequired: true`、`gates: ["G1", "G2", "G3", "G4", "G5"]`、`visualAttemptsMaximum: 3`；这些字段是待执行审查的声明，不是通过证据。当前配方图片使用 PNG/JPEG；chart category 不接受逗号或换行，避免 OfficeCLI 分隔格式歧义。
