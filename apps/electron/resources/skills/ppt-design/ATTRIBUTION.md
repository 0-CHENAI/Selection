# Attribution / 适配来源

本技能的故事规划、设计锁、语义布局选择和视觉审查文档参考并改编自：

- 项目：[hugohe3/ppt-master](https://github.com/hugohe3/ppt-master)
- 作者/原版权：Copyright (c) 2025-2026 Hugo He
- 许可：MIT，原文随本目录 [LICENSE](LICENSE) 保留。
- 第一轮锁定源提交：[`622bf0148bca4f697b0184322c7e2aa2a04520a2`](https://github.com/hugohe3/ppt-master/tree/622bf0148bca4f697b0184322c7e2aa2a04520a2)。
- 第二轮视觉研究提交：[`523e5bd972f94c3cac8742fec0d54d43824a17bb`](https://github.com/hugohe3/ppt-master/tree/523e5bd972f94c3cac8742fec0d54d43824a17bb)（仓库外浅克隆 `git rev-parse HEAD`）。

## 阅读与适配范围

源路径均相对该提交的 `skills/ppt-master/`：

- `templates/spec_lock_reference.md`：将完整设计计划投影成稳定执行锁、变更时同步受影响规划。
- `workflows/stages/refine-spec.md`：在明确请求审方案时，对同一完整计划增量讨论和修订；批准后才锁定执行版本。
- `workflows/stages/visual-review.md`：逐页真实渲染、记录观察、按发现修复，而不是把静态检查当视觉结论。
- `templates/layouts/README.md` 与 `templates/layouts/presentation_core/templates/design_spec.md`：结构与品牌身份分离，比较/流程/数据解释的语义 slot，密集与留白节奏。
- `templates/layouts/report_core/templates/*.svg` 与 `design_spec.md`：分隔页满版、内容页色带、KPI 行、图表加解释、流程轴。只借鉴构图比例，不复制占位符协议。
- `templates/layouts/editorial_bleed/templates/*.svg` 与 `design_spec.md`：图片/色块出血到画布边、章节满版、拉引文居中。没有照片时用色块代替图片槽。
- `references/visual-styles/dark-tech.md`、`editorial.md`：环形、角标、衬线/无衬线分工。`dark-tech` 与 `technical-deepdive` 没有页级 SVG。
- `templates/styles/mbb-consulting/templates/design_spec.md` 与 `consulting-decision`：一页一个回答，图表直接标注、去掉网格线。
- `templates/styles/technical-deepdive/templates/design_spec.md`：深色技术场、强调当前对象。
- `templates/charts/chart-vocabulary.md` 与 `templates/charts/column_chart.svg`：按数据关系选图表，保留类别、单位和柱顶数字。
- `templates/decks/README.md`：叙事与视觉身份分工。没有复制中国电信或其他品牌的标志、图片、配色。

## Selection 中的改编

这是原生 OfficeCLI 的独立集成，不是上游运行时的移植。Selection 使用三套本地风格、14 种按风格分别构图的原生配方、严格 JSON 输入、应用附带 Bun/OfficeCLI，且统一采用 G1–G5 与整项任务最多三次视觉检查。上游 opt-in 视觉阶段改为新建/重设计交付的必需逐页截图检查；会话恢复不重置锁或次数。

第二轮把上游 SVG 的构图比例落成 OfficeCLI 原生形状。未复制上游 Python 脚本、依赖、渲染服务器、SVG 模板文件、图标包、音频、品牌素材，也没有通用 SVG 转形状管线。上游 px 字号不照搬为 OfficeCLI pt。许可保留不表示上游作者认可本集成，也不授予商标或第三方资产权利。
