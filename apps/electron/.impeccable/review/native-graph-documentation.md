# 原生自动任务图：普通扩展文档核对

记录日期：2026-10-10。范围：Selection Electron 的 PRO 自动任务观察窗，用户确认弃用 React Flow 后的原生 HTML/SVG 实现。

本轮是已建立 Selection UI 的普通局部扩展。视觉权威为 [自动任务图 direction contract](../surfaces/automatic-task-graph.md) 及实际组件、主题样式；[PRODUCT.md](../../PRODUCT.md) 的持续工作、可信状态、渐进展开和键盘可访问原则提供产品背景。本记录只描述构建事实，不建立新品牌世界或全局 token，不创建、覆盖或修改 PRODUCT.md、DESIGN.md、design.json、surface brief 或代码。

## 五行系统摘要

1. **色彩**：继承 Electron 的亮暗中性前景、popover/card 表面和边界；PRO 使用既有亮主题铜金（`oklch(0.50178870 0.09392988 58.44502375)`）与暗主题香槟金（`oklch(0.76808414 0.08380584 76.89195147)`）；完成与失败沿用成功/错误语义色。
2. **字体层级**：继承 `--font-default` 的系统字体和用户已有字体选择；本表面节点标题（15px / 600 / 20px）、详情正文（13px / 1.75）、摘要（12px / 16px）、类型和状态（11px）、实例数（10px），未新增字体或展示字体系。
3. **形状与深度规则**：节点（288×128px、16px 内边距、14px 圆角）以中性表面与细边界区分；运行与选中分别混入 PRO 色（6% / 4%），选中和键盘焦点使用（2px）轮廓；悬停只变边界，不移动节点或连线锚点。
4. **布局规则**：宽工作台默认 LR、窄工作台默认 TB，显式方向优先；dagre 以实际卡片尺寸排布，原生画布按可用尺寸适配，右侧详情（360px）；工作台不超过（760px）时详情覆盖画布。
5. **状态与交互规则**：状态同时有小图标、本地化文字和语义色；只读观察支持选择、平移、缩放、适配和会话跳转，唯一持续动效是 `done → running` 依赖连线上的（2600ms）信号，隐藏页暂停、回放和减少动态效果时静止。

## 核对来源与继承一致性

采样的系统来源为 [index.css](../../src/renderer/index.css) 的 `:root`、`.dark`、全局字体、PRO 色、Dialog 及 task-workbench/task-graph 样式，并对照既有 [dialog.tsx](../../src/renderer/components/ui/dialog.tsx)、[tabs.tsx](../../src/renderer/components/ui/tabs.tsx)。项目及 Electron 边界内未发现已有 DESIGN.md 或 design.json；本轮 ordinary-extension 适用说明明确要求保留 incumbent 系统，因此不为完成文档步骤补造这些文件。

采样的实现为 [TaskGraphCanvas.tsx](../../src/renderer/components/app-shell/kanban/TaskGraphCanvas.tsx)、[TaskFlowNode.tsx](../../src/renderer/components/app-shell/kanban/TaskFlowNode.tsx)、[TaskFlowEdge.tsx](../../src/renderer/components/app-shell/kanban/TaskFlowEdge.tsx)、[ConductorWorkbench.tsx](../../src/renderer/components/app-shell/kanban/ConductorWorkbench.tsx)、[TaskNodeInspector.tsx](../../src/renderer/components/app-shell/kanban/TaskNodeInspector.tsx)、[AutomaticTaskGraphDialog.tsx](../../src/renderer/components/app-shell/kanban/AutomaticTaskGraphDialog.tsx)、[automatic-task-graph.ts](../../src/renderer/components/app-shell/kanban/automatic-task-graph.ts)、[conductor-graph.ts](../../src/renderer/components/app-shell/kanban/conductor-graph.ts) 和 [task-graph-viewport.ts](../../src/renderer/components/app-shell/kanban/task-graph-viewport.ts)。此核对没有打开浏览器、运行 detector、重复测试或扩大缺陷搜索。

方向契约的 THESIS、OWN-WORLD、STORY、FIRST VIEWPORT 与 FORM 均落实于同一 canvas + inspector 结构：先读依赖与状态，选中后默认读职责，再检查成果与运行记录，关闭回到聊天。点阵（28px 网格）和细连接线是此观察面的局部表达，未提升为全应用布局规则。中性表面、PRO 色、Radix Dialog/Tabs、既有字体和渐进展开方式保持继承关系。

## 当前原生实现

节点为原生 HTML button，连接和箭头为 SVG；节点与连线共用原生 stage 的 translate/scale。Electron 依赖和当前任务图源码已无 React Flow，保留 `@dagrejs/dagre`（3.1.1）作依赖排布。本轮没有接入 X6、Reaflow、G6 或 Cytoscape；它们仅属于选型调查中的备选。

原生画布支持空白区拖拽平移、滚轮/触控板平移、Ctrl/Meta 滚轮缩放、方向键平移、`+`/`-` 缩放及 `0` 适配。底部工具集中显示缩放比例与适配操作；十节点验收案例支持全图适配和概览。自动适配缩放范围（0.1–1.15），手动缩放范围（0.1–2）；fit/zoom 过渡（220ms），减少动态效果时无过渡。状态刷新保留当前平移缩放，拓扑或画布尺寸变化才重新适配；键盘聚焦屏外节点时将其带回可见区域。

详情仍为「职责 / 成果 / 运行记录」三页签，默认职责；任务要求摘录、友好名称依赖和预期交付处于第一层，完整指令和运行指标逐步展开。成果按当前运行、修订、实例和尝试读取真实输出，回放不冒充当前成果。详情组件按所选节点 ID 保持实例，普通状态刷新保留所选页签。此替换没有增加编辑、保存或执行操作；验收 transport 写调用数为（0）。

## 动效、焦点与窗口边界

运行节点状态图标保持静态。只在已完成源节点到运行目标的实际连接路径上生成光点，半径（3px）、曲线 `cubic-bezier(.45,0,.2,1)`、周期（2600ms）；目标停止后移除。页面隐藏时暂停，历史回放和减少动态效果时隐藏信号。详情进入的一次性（180ms / 8px）反馈及节点颜色/边界（180ms）过渡尊重减少动态效果设置。

finish 修复后，节点可访问名称包含标题、本地化类型和本地化状态，`aria-pressed` 表达选中。窄窗口打开详情后焦点进入关闭按钮，覆盖画布同时设置 `inert` 与 `aria-hidden`；关闭详情后恢复对应节点焦点，宽窗口画布继续可操作。主观察窗沿用 Dialog 的窗外点击、Esc 与标题关闭；关闭后返回聊天入口。

观察窗常规宽度为 `min(1680px, 100vw - 40px)`，高度扣除（40px）及条件安全区；视口不超过（600px）时采用水平总留白（16px）与垂直总留白（32px），工具允许换行。Windows Electron 条件仍为 `isWindows && !isWebUI`，安全区取既有 `--topbar-height` 与原生 `titlebar-area` 的较大值；顶栏既有（48px），不超过（768px）时（56px）。标题关闭点击目标（36×36px）。这些条件与模拟几何有证据，未完成 Windows 原生实机验收。

## 验收证据与交付状态

已核对四张截图与 [native-graph-acceptance.json](native-graph-acceptance.json)。它们使用生产组件配合明确标注的 synthetic 3/4/10 节点 preview transports，不构成真实后端运行的端到端证明；静态截图只支持布局与主题判断，行为记录与源码支持交互结论。

| 证据 | 来源与范围 |
| --- | --- |
| [native-graph-user.png](native-graph-user.png) | 三节点暗主题；1728×1117 视口由用户的 2x macOS 截图推定，用于对齐反馈中的窗口布局 |
| [native-graph-dark.png](native-graph-dark.png) | 1440×900、暗主题四节点并行到汇合运行场景 |
| [native-graph-light.png](native-graph-light.png) | 1440×900、亮主题四节点及右侧职责详情 |
| [native-graph-narrow-windows.png](native-graph-narrow-windows.png) | 440×900、覆盖详情；Win32 在 macOS 浏览器模拟，未渲染原生 Windows 窗口控制按钮 |

验收记录包含：七文件测试（43 通过 / 0 失败）、Electron typecheck 通过、lint（0 errors / 87 existing warnings）、renderer build 与 diff check 通过；十节点适配和概览通过，实时视角保留、完成/回放静止、减少动态效果、成果、节点本地化读名、主窗/详情关闭焦点均有记录。窄详情 Tab 与 Shift+Tab 各（12）步的被遮挡焦点数为（0）。Windows 窄窗模拟观察窗顶部（72px），关闭目标（36×36px）。documenter 仅读取这些已有结果，没有重新运行验证。

本轮独立 finish 审查最初两项修复为节点状态读名本地化和窄详情焦点/背景 inert；修复后的 Verdict 为 **Pass**，两项 disposition 均已 resolved，交付建议为 **ship**。后续复核与评分只针对该 fix batch，不扩大为新一轮全表面审查。

acceptance 记录交付状态为本地 `codex/autonomous-task-graph` 未提交，相关 Issues 保持 open；此状态引用本轮验收记录，未在本次 documenter 再查远程。协调 agent 已确认 Issue #480 回填本轮证据，链接保存在 acceptance 中；证据回填不表示 Issue 已关闭。**ship** 是本地 finish 判定，不表示已提交、推送、创建 PR、远程发布或关闭 Issue。截图为开发证据，不是随产品分发的 raster 资产。

## 未规范化的漂移与限制

旧 [documentation.md](documentation.md) 和 [flow-motion-documentation.md](flow-motion-documentation.md) 中的 React Flow、280×144 节点和旧适配参数保留为历史验收记录；当前实现已由本文件明确记录为原生 HTML/SVG 与 288×128 节点，不将旧数值提升为现行规则。surface 的通用 FINISH 模板仍提 DESIGN.md，但其 ordinary-extension 适用说明排除本轮创建；该模板措辞未规范化。既存 lint warnings、synthetic 后端证据与 Windows 模拟边界不作为系统规则，也不在本次文档核对中修复或扩大结论。
