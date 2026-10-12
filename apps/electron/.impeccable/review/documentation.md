# 自动任务图：普通扩展文档核对

核对完成。本轮为 code-led Operate 普通扩展，沿用现有 Selection 设计体系；只记录实际实现，不创建或覆盖 `DESIGN.md`、`.impeccable/design.json`，不修改 `PRODUCT.md`。

## 继承来源与五行系统摘要

1. **色彩**：Electron [index.css](../../src/renderer/index.css) 的 `:root` / `.dark` 提供前景、表面、边界、成功与失败语义色；PRO 沿用亮色铜金（`oklch(0.50178870 0.09392988 58.44502375)`）与暗色香槟金（`oklch(0.76808414 0.08380584 76.89195147)`）。这些既有变量在本轮未改变。
2. **字体**：继续继承 `--font-default`，默认系统字体栈，保留既有 Inter 选项；节点标题（14px / 600 / 20px）、详情正文（13px / 1.75）、节点摘要（12px）、元信息（11px）构成本表面的实际层级，没有新增字体。
3. **形状与深度**：节点（280×144px、16px 内边距、14px 圆角）位于点阵画布；使用主题前景混色的柔和阴影、细连接线与 PRO 选中轮廓，沿用既有 React Flow 主题映射。
4. **布局规则**：观察窗宽为 `min(1680px, 100vw - 40px)`、高为 `100dvh - 40px`；桌面工具占一行，余下空间归画布；选中后右侧详情为 360px。节点实际尺寸传入 dagre，React Flow 完成测量后适配，容器变化时重新适配。
5. **状态与交互规则**：类型、名称、状态分别呈现；状态同时有图标和文字，颜色随所选主题；允许选择、平移、缩放、适配与会话跳转，禁止拖拽、连线、删除、编辑或执行。短暂详情进入／选中反馈与运行旋转尊重减少动态效果设置。

核对源码：[TaskFlowNode.tsx](../../src/renderer/components/app-shell/kanban/TaskFlowNode.tsx)、[ConductorWorkbench.tsx](../../src/renderer/components/app-shell/kanban/ConductorWorkbench.tsx)、[TaskNodeInspector.tsx](../../src/renderer/components/app-shell/kanban/TaskNodeInspector.tsx)、[AutomaticTaskGraphDialog.tsx](../../src/renderer/components/app-shell/kanban/AutomaticTaskGraphDialog.tsx)、[TaskGraphButton.tsx](../../src/renderer/components/ui/TaskGraphButton.tsx)、[dialog.tsx](../../src/renderer/components/ui/dialog.tsx)、[ChatPage.tsx](../../src/renderer/pages/ChatPage.tsx)。产品原则只作为继承背景，表面布局与运行检查规则保留在 [surface brief](../surfaces/automatic-task-graph.md)。

## 职责、成果与运行记录

- **职责默认展示**：实际实例指令优先，缺省使用该运行冻结定义的提示；正文摘录最多六行，提供完整指令入口。依赖从 `effectiveNodeDeps` 解析，展示友好名称并可选中；预期交付仅在定义有输出名称时展示。依赖失败时说明该节点未能开始。
- **成果只读**：切到成果后读取 `getTaskResults(workspaceId, slug, runId)`；仅渲染返回的真实 `output`，加载、空值、错误、重试、刷新各有明确信息。回放不读取当前成果，显示说明；裁决来自所查看快照的实例记录。
- **运行记录**：原始节点 ID、完整指令、权限、角色、控制流与尝试指标在独立页签逐步展开；底部会话入口使用实例记录中的真实 `sessionId`。
- **身份契约**：[automatic-task-graph.ts](../../src/renderer/components/app-shell/kanban/automatic-task-graph.ts) 先验证图的只读检查、冻结定义、`slug`、`runId`、运行修订与可用的编排会话身份；不回退到当前编辑定义。成果必须匹配 `slug`、`runId`、运行修订、实例 ID 与执行尝试，并核对可用的编排会话、子会话及尝试修订。旧协议缺省修订按 0、缺省成果尝试按 1；子会话两端均有值时才比较，尝试修订有记录时才比较，不将缺省字段描述为已验证身份。
- **持续观察**：结果请求键包含工作区、运行、修订、节点、回放状态与实例尝试／状态／会话；旧响应受键和取消标记约束。运行状态更新只替换节点数据和边，不重新设定节点坐标；同一节点实例保持所选详情页签。

## 响应式与关闭

工作台容器宽度不超过 760px 时，详情覆盖画布，宽为 `min(360px, 100%)`；详情 X 关闭后将焦点交还该图节点。窗口不超过 600px 时观察窗采用 16px 水平、32px 垂直总留白；工具允许自然换行。主观察窗继承 Radix Dialog 的窗外点击、Esc 与 X 关闭，明确将焦点返回聊天图入口；打开子会话时先关闭观察窗。

已对照 [desktop-light.png](desktop-light.png)、[desktop-dark.png](desktop-dark.png)、[mobile.png](mobile.png)、[failed-dependency.png](failed-dependency.png)：亮暗状态语义、并行到汇合结构、右侧职责与窄窗覆盖详情与源码相符。截图仅为开发验收证据，不是随产品分发的 raster 资产；本轮没有图片 prompt 或资产溯源新增需求。

## 已有漂移，仅报告

`packages/ui/src/styles/index.css` 与 Electron `index.css` 的部分默认色值存在既有差异（如暗色背景与常规紫色 accent），`HEAD` 已有同样差异；本表面以 Electron 运行主题为证据，没有将共享包默认值另立为同一套规范，也未跨应用修复。Surface brief 的通用 `FINISH` 行仍提到 `DESIGN.md`，其后的 ordinary-extension 适用说明明确排除本轮生成；该模板措辞未当作新设计规则。此次核对不改这些既有漂移，不扩张全局产品或设计文档。
