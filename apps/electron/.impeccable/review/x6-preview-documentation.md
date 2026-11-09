# X6 三节点预览：普通扩展文档核对

日期：2026-10-10。Operate 模式的 ordinary extension，依据完成后的代码、[方向契约](../surfaces/x6-task-graph-preview.md)、[PRODUCT.md](../../PRODUCT.md) 与最终截图。

## 范围

- [x6-task-graph.tsx](../../src/renderer/playground/registry/x6-task-graph.tsx) / [CSS](../../src/renderer/playground/registry/x6-task-graph.css) 通过 [registry](../../src/renderer/playground/registry/index.ts) 提供独立 playground 预览；正式任务观察窗未接入 X6。
- [package.json](../../package.json) 的 devDependencies 使用 X6 3.1.8、react-shape 3.0.1；复用现有 dagre 布局辅助函数。
- 三个静态节点、两条依赖边：官方信息与社区反馈独立输入到核验节点。三个阶段只改变演示状态；详情接收空实例，未传 run/workspaceId，不触发结果后端读取或真实任务执行。

## 继承证据

| 维度 | 核对的既有来源与实际使用 |
| --- | --- |
| 色彩 | [index.css](../../src/renderer/index.css) 的 foreground/card/popover 构成黑白中性表面；pro-accent 沿用浅色铜金、深色香槟金，完成态沿用 success 绿色 |
| 节点 | 直接复用 [TaskFlowNode](../../src/renderer/components/app-shell/kanban/TaskFlowNode.tsx)：288×128、14px 圆角、16px 内边距；状态通过文字、Lucide 图标和颜色共同表达 |
| 字体 | 继承默认系统字体栈及用户字体设置；元信息 11px、说明/阶段 12px、详情正文 13px、节点标题 15px/600、窗口标题 16px，未引入字体 |
| 表面 | 复用中性 popover 节点、card 点阵画布及 12px 圆角画布/详情；X6 承担 SVG/React 承载、路由与视角操作，未引入组件皮肤 |
| 详情 | 直接复用 [TaskNodeInspector](../../src/renderer/components/app-shell/kanban/TaskNodeInspector.tsx)：宽窗 360px 侧栏，窄窗覆盖；展示职责、依赖、预期成果和执行记录 |
| 控件 | 复用关闭/缩放/适配样式、图标明暗反馈和可见焦点；节点与阶段使用有名称的 button 和 aria-pressed，SVG group 保留节点按钮语义 |
| 窗口 | 继承 [AutomaticTaskGraphDialog](../../src/renderer/components/app-shell/kanban/AutomaticTaskGraphDialog.tsx) 的 Dialog、尺寸规则和 native-caption 安全 inset；关闭/Esc 返回入口焦点 |
| 布局 | 复用 [conductor-graph](../../src/renderer/components/app-shell/kanban/conductor-graph.ts)；workbench 小于 760px 时堆叠独立输入、沿右侧汇合，没有输入间依赖；阶段更新保留 pan/zoom |
| 动效 | 继承节点 180ms 过渡和详情进入动画；汇合核验连线以 2.6s 虚线流动表达状态；reduced-motion 禁用新增动画和过渡 |

预览局部将 muted-foreground 设为 foreground 与 popover 的 70% 混合，恢复说明和未选阶段的可读性；未改写全局主题 token。

## 验收与边界

核对五张最终截图：[浅色](x6-preview-light.png)、[深色](x6-preview-dark.png)、[窄窗](x6-preview-narrow.png)、[浅色详情](x6-preview-light-details.png)、[窄窗详情](x6-preview-narrow-details.png)。宽窗呈现并行后汇合，窄窗保持独立输入语义，详情延续现有层级。

- [acceptance](x6-preview-acceptance.json) 记录 1440×900 浅/深色、440×900 深色，以及平移、缩放、适配、阶段保留视角、三个完成节点和节点不可拖动。源码禁用编辑连线。
- 可访问性树暴露三个命名节点按钮；Enter 打开详情，Esc 返回入口焦点。窄窗详情令画布 inert/aria-hidden，焦点进入关闭按钮，关闭后回到节点；reduced-motion 验证通过。
- Windows 分支仅在浏览器仿真中验证：native-caption=true 时窄窗顶部 72px，未进行真实 Windows OS 或原生标题栏验收。
- Electron typecheck、预览 ESLint、renderer build、git diff --check 实际通过；[detector](x6-preview-detector.json) 为 `[]`。正式集成、提交、推送尚未发生。
- 独立审查使用 degraded reviewer 契约（指定 reviewer definition 不可用）；首次指出详情裁切与辅助文字对比不足，一次修复和同名五截图复查后两项 resolved。浅色文字 6.81:1、未选阶段 6.25:1；所选边界 603–1017 位于画布 35–1033 内，144% 缩放不变。ship 仅覆盖这两项修复的复查结论。

## 系统处理与五行摘要

未创建或编辑 DESIGN.md / `.impeccable/design.json`。项目根与 Electron app 根未见这两项文件，但已有代码提供一致视觉依据；本次没有获批的新视觉世界或系统变更，ordinary extension 保留 incumbent 系统。三节点布局、760px 切换和阶段控制仅为预览策略，不升格为全局规则。

1. 色彩：黑白中性表面、PRO 铜金/香槟金、success 完成绿。
2. 文字：继承用户字体设置与任务图 11/12/13/15/16px 层级。
3. 表面：复用节点、点阵画布、详情的边框、圆角和内边距。
4. 规则：状态文字与图标共同表达；节点选择逐步展开职责和依赖。
5. 交互：语义按钮、可见焦点、安全 inset、状态保留视角及 reduced-motion。

未 canonize 或修复：已解决的裁切与低对比度不写成系统规则；范围外漂移未扫描或修复，真实 Windows 原生验收未扩展处理。
