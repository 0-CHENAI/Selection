# Attribution / 适配来源

本技能的故事规划、设计锁、语义布局选择和视觉审查文档参考并改编自：

- 项目：[hugohe3/ppt-master](https://github.com/hugohe3/ppt-master)
- 作者/原版权：Copyright (c) 2025-2026 Hugo He
- 许可：MIT，原文随本目录 [LICENSE](LICENSE) 保留。
- 锁定源提交：[`622bf0148bca4f697b0184322c7e2aa2a04520a2`](https://github.com/hugohe3/ppt-master/tree/622bf0148bca4f697b0184322c7e2aa2a04520a2)（本地浅克隆 `git rev-parse HEAD` 取得）。

## 阅读与适配范围

源路径均相对该提交的 `skills/ppt-master/`：

- `templates/spec_lock_reference.md`：将完整设计计划投影成稳定执行锁、变更时同步受影响规划。
- `workflows/stages/refine-spec.md`：在明确请求审方案时，对同一完整计划增量讨论和修订；批准后才锁定执行版本。
- `workflows/stages/visual-review.md`：逐页真实渲染、记录观察、按发现修复，而不是把静态检查当视觉结论。
- `templates/layouts/README.md` 与 `templates/layouts/presentation_core/templates/design_spec.md`：结构与品牌身份分离，比较/流程/数据解释的语义 slot，密集与留白节奏。
- `templates/styles/mbb-consulting/templates/design_spec.md`：一页一个回答，区分事实/假设/建议，证据、单位、来源和结论相互可追溯。
- `templates/charts/chart-vocabulary.md` 与 `templates/charts/column_chart.svg`：按实际数据关系选择图表，保留类别、单位、期间、尺度与解释。
- `templates/decks/README.md` 与 `templates/decks/中国电信/templates/design_spec.md`：整套叙事场景、页面角色与视觉身份的分工。没有复制中国电信品牌、标志、图片、配色或既有模板。

## Selection 中的改编

这是原生 OfficeCLI 的独立集成，不是上游运行时的移植。Selection 使用三套本地风格、14 种固定坐标原生配方、严格 JSON 输入、应用附带 Bun/OfficeCLI，且统一采用 G1–G5 与整项任务最多三次视觉检查。上游 opt-in 视觉阶段改为新建/重设计交付的必需逐页截图检查；会话恢复不重置锁或次数。

未复制上游 Python 脚本、依赖、渲染服务器、SVG 模板资产、图标、音频、品牌素材或上游结构化 SVG 原生化管线。上游 px 型字号不照搬为 OfficeCLI pt；图片嵌入与原生可编辑对象严格区分。许可保留不表示上游作者认可本集成，也不授予商标或第三方资产权利。
