# dsh-ppt 与 Selection 对照

对照基线是 dsh-desktop `588412b`。实现留在 deck.json、OfficeCLI 和 TypeScript。不移植演示引擎，不打包 LibreOffice Kit，不内置 Python。视觉检查用模型自己看 `office_render` 的图，不用 OCR。

## 技能

| dsh-ppt | Selection | 处理 |
| --- | --- | --- |
| 先定受众、结论、材料和页数 | `workflow.md` 第 1 步 | 已有 |
| 每次最多读 12 页参考，参考页不是背景 | `SKILL.md`、`template-picking.md` | 补进技能 |
| YAML `\|-` 与 `literalEscapes` | deck.json 用真实换行；字面量 `\n` 是 `literal_newline` | 格式不同，检查同义 |
| `needs_revision` 按文件、页码、元素 ID | `formatNeedsRevision` 与 `deck-check.json` | 已补 |
| 不重复检查未改页 | `workflow.md` | 已补 |
| `exported` 才算交付 | 有 error 时不把 PPTX 标成就绪 | 已补 |
| 不声称未做的 PowerPoint / WPS 验证 | `SKILL.md` 交付段 | 已有 |
| 语言和字体按平台回退 | 主题字体 `$cjk` / `$latin` | 已有 |
| 页面质量：单位、来源、原生图表 | `composition.md` | 已有，并改回连续版式提醒 |
| 个人模板 `ppt_template_create_project` | 同名工具，产出 deck.json | 已补 |
| 模板配图六项风格和三类槽 | `image_generate` 与 `dsh.template-images/v1` | 已补 |
| 咨询 / 国企汇报克制 | `template-picking.md` | 已补 |

## 预检

dsh 的 `layout-repetition` 在打包检查里：连续构图签名少于 3 页不提醒（`end - start < 3`）。封面、标题、开场、章节、收束页断开这一段。Selection 用页面的 `layout` 名字，阈值同样是 3。`free` 和封面类版式不计入。已出版的 `profile: example` 不跑这类提醒，和原来跳过对比度、孤字的理由一样。提醒不阻止导出。

| dsh code | 级别 | Selection | 取舍 |
| --- | --- | --- | --- |
| layout-repetition | warning | `layout_repetition` | 阈值 3，见上 |
| cover-focus | warning | `cover_focus` | 25% 主视觉，或最大字号至少是中位字号的 3 倍 |
| chart-data | error | `chart_data` | 类别和序列等长，且为有限数字 |
| chart-series-color | error | `chart_series_color` | 只接受 `#RRGGBB`、`#RRGGBBAA` 或 `$token`。Selection 的 `colors` 是序列或类别色，不按「一条序列一个颜色数组」再禁一次 |
| chart-layout / chart-type | error | 解析器 `schema` | 绘图区和图表类型在读入时拒绝 |
| image-fit | error | `image_fit` | 槽位比例和画面框相差超过 8%，或 fit 不是 fill / contain / cover |
| image-crop | error | `image_crop` | 四边比例无效，或裁完剩下不到一半 |
| remote-image | error | `remote_image` | 不接受 http(s) 图片 |
| missing-asset | error | `missing_asset` | 槽位没有素材，或给出的路径不存在。`selection-placeholder-*.png` 只警告 |
| text-drift / text-occlusion | warning | 同名下划线 | 文字和后绘制的图表、表格、图片重叠。色块不按遮挡计，避免把底色当成错误 |
| text-overflow / text-escaped-newline | error | `over_capacity` / `literal_newline` | 已有 |
| out-of-bounds / overlap | error 或 warning | `out_of_bounds` 为 error，重叠为 error | Selection 的重叠比 dsh 更严，保留 |
| contrast / orphan | — | 保留 | dsh 这组检查里没有同名项，Selection 独有 |
| waterfall 不轧平 | — | `unreconciled` | Selection 独有 |
| yaml-syntax、duplicate-id、page-size 等工程语法 | error | `schema` | deck.json 由解析器一次报完，不另造一套 YAML 码 |
| custom-shape、line-path、icon-name、table-data | error | `schema` 或路线 B 的 `retained` | 写不进的对象保留不可编辑，不引入演示引擎的形状表 |

导出：error 返回 `needs_revision`，不把文件标成就绪。warning 仍导出，并写在结果里。
