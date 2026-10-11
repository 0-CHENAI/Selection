# 自动任务图动效与 Windows 顶栏避让记录

记录日期：2026-10-10。范围：Selection Electron 的 PRO 自动任务观察窗，本轮 ordinary extension 的本地实现与验收证据。

## 适用范围与继承关系

本记录描述已构建的观察窗行为，供本轮交付和后续维护查阅。视觉权威仍为既有 Selection 实现与 [自动任务图 surface brief](../surfaces/automatic-task-graph.md)：系统字体、用户所选亮暗主题的中性前景/表面/边界、亮主题 PRO 铜金与暗主题 PRO 香槟金。完成和失败沿用语义成功色与错误色。

本轮仅扩展自动任务图的动效、状态呈现和 Windows 安全区；保留 incumbent 设计系统。本文件不建立新的全局 token 或品牌规则，也不更新 surface brief、DESIGN.md、PRODUCT.md 或 design.json。任务图仍是只读观察面，允许平移、缩放、适配画布与选择节点。

## 实现来源

本记录采样以下本轮组件及相关样式，未扩展到其它页面的设计审查：

- [AutomaticTaskGraphDialog.tsx](../../src/renderer/components/app-shell/kanban/AutomaticTaskGraphDialog.tsx)：观察窗标题、原生控制区条件、关闭与入口焦点、加载/空/错误呈现。
- [TaskFlowNode.tsx](../../src/renderer/components/app-shell/kanban/TaskFlowNode.tsx)：固定节点尺寸、类型和状态图标、语义状态色。
- [TaskFlowEdge.tsx](../../src/renderer/components/app-shell/kanban/TaskFlowEdge.tsx)：依赖路径、箭头与沿路径移动的信号。
- [ConductorWorkbench.tsx](../../src/renderer/components/app-shell/kanban/ConductorWorkbench.tsx)：动效激活条件、页面可见性、历史回放、实时状态更新、画布选择与详情关闭焦点。
- [index.css](../../src/renderer/index.css)：继承字体和主题、Windows 安全区、节点状态表面、动效时长与减少动态效果处理。

## 动效合同

**持续动效只用于传递可用依赖。** 连线信号仅在源节点为 `done`、目标节点为 `running` 时生成；它表示已完成依赖正在供给执行任务。尚未完成的输出不流动，目标离开 `running` 后信号消失。连线保留箭头以表达依赖方向。

| 对象 | 已实现行为 | 触发与停止条件 |
| --- | --- | --- |
| 活跃连线 | 小光点半径（3px），沿实际连接路径移动；周期（2600ms），曲线 `cubic-bezier(.45,0,.2,1)`；起终点淡出，周期的 12%–82% 保持可见 | `done → running` 时出现；源或目标不再满足条件时移除 |
| 页面隐藏 | 连线动画暂停 | `document.hidden` 经 `visibilitychange` 更新；页面恢复可见后继续 |
| 历史回放 | 隐藏连线信号，保留静态依赖和状态 | 检查历史 snapshot 时生效，返回实时后按当前状态重新判断 |
| 节点悬停/选择 | 表面与阴影渐变（180ms，`ease-out`），端口和节点位置保持稳定 | 悬停、选择及其退出；运行中的节点使用轻微 PRO 色表面 |
| 详情进入 | 一次性淡入和水平进入（8px、180ms），曲线 `cubic-bezier(.2,.7,.2,1)` | 选中节点、挂载详情时 |
| 自动适配画布 | 节点实际初始化及容器变化后适配；常规过渡（180ms），padding（0.16），缩放限制（0.35–1.15） | 拓扑/视图变化或画布尺寸变化；普通状态刷新保留已有节点位置 |

运行节点的 `Loader2` 状态图标保持静态。finish 修复已移除其旋转类，使连线信号成为唯一持续动效；一次性详情进入和状态过渡保留。

**减少动态效果保留信息。** `prefers-reduced-motion: reduce` 下取消节点过渡和详情进入动画，隐藏连线信号并关闭其动画；自动适配画布的过渡时长为零。状态文字、图标、静态连线和方向箭头继续可读。

## 状态与可访问性合同

节点固定为（280×144px），内边距（16px），圆角（14px）。类型图标使用紧凑底色（24×24px）；名称（15px、600、20px 行高）最多两行，说明（12px）单行省略，类型/状态标签（11px）。字体继承全局默认系统栈及既有用户字体选择，本轮未增加字体。

运行状态表面混入 PRO 色（6%）；选中表面混入 PRO 色（4%）。类型使用 PRO 色；完成使用 `--success`，失败/无效使用 `--destructive`，运行/就绪/审批等待/重试等待使用 `--pro-accent`，其它状态使用主题前景与表面的混色。颜色跟随应用所选主题。

状态同时呈现小图标和文字；装饰图标与连线光点设置 `aria-hidden`，连线信号不接收指针事件。节点的可访问名称采用任务标题，节点选中或键盘焦点显示 PRO 色轮廓（2px、3px 外偏移）。运行总状态使用 `aria-live="polite"`；视图选择有隐藏标签，记录展开按钮提供 `aria-expanded` 与 `aria-controls`。

加载与空状态使用 `role="status"`，加载错误和历史读取错误使用 `role="alert"`。加载错误提供重试与可展开技术详情。技术信息按既有渐进展开合同呈现。

亮主题验收场景的状态文字对比度为：完成（5.00:1）、运行（4.83:1）、待处理（6.08:1）。这些数值来自本轮 synthetic 场景的采样，适用于该场景的主题和合成背景，不作为全应用全部状态的对比度结论。

## Windows 原生顶栏安全区

Windows Electron 桌面以 `isWindows && !isWebUI` 设置原生控制区条件。观察窗预留高度采用以下已实现计算：

```css
--task-graph-window-inset: max(
  var(--topbar-height, 48px),
  calc(env(titlebar-area-y, 0px) + env(titlebar-area-height, 48px))
);
```

既有顶栏通常为（48px），视口宽度不超过（768px）时为（56px）。观察窗高度从可用窗口高度扣除此安全区，垂直中心向下移动安全区的一半，保证窗体完整位于原生标题区之下。常规宽度为可视窗口减（40px），最大（1680px）；不超过（600px）时改用窄窗口边距与高度公式。

关闭按钮位于观察窗标题行内，点击区域（36×36px），有本地化关闭标签；标题行与按钮使用既有禁止拖动区域标记。悬停和键盘焦点提高图标前景亮度；键盘焦点额外使用 PRO 色圆形轮廓（2px、2px 外偏移），保持可见焦点。

验收测量：模拟 Windows 常规窗口中观察窗顶部为（68px）、尺寸（1400×812px）；窄窗口中顶部为（72px）、尺寸（410×812px）。两者均避开模拟控制区，关闭目标均为（36×36px）；窄窗口无横向溢出。详情栏常规宽度（360px），workbench 容器不超过（760px）时覆盖画布，可关闭返回。

这些 Windows 平台值和原生控制区是在 macOS 浏览器中模拟的。现有证据支持实现条件与模拟几何；尚无 Windows 实机验收，不能据此宣称原生窗口控制区在 Windows 已验证。

## 关闭与焦点合同

用户从聊天右上角入口打开观察窗；窗外点击、Esc 和标题行关闭按钮均关闭。`onCloseAutoFocus` 在入口引用可用时将焦点显式返回该按钮；标题行使用 Dialog 的标题和描述语义。验收记录确认关闭按钮和 Esc 后的入口焦点返回。

详情关闭与整个观察窗关闭分别处理。详情关闭先将焦点返回对应 React Flow 节点，再清空选中状态；窄窗口因此恢复画布操作。点击画布空白处清除选择。实时状态刷新更新节点数据和连线，并保留节点位置与选中节点；同一节点详情实例继续沿用既有页签合同。

只读边界在画布中体现为禁止节点拖动、建立连接、重连及 Delete 删除；保留选择、平移、缩放和适配工具。此次验收 transport 的写调用计数为零。

## 验收证据与交付状态

证据为生产渲染组件配合明确标注的 **synthetic 四节点 transport**：一个完成前置任务、两个并行执行任务与一个汇合任务。它验证本轮组件和状态切换，不代表真实后台运行的端到端证明。静态截图用于记录布局与主题；连线移动、回放静止、减少动态效果、页面隐藏暂停和完成静止由 [flow-motion-acceptance.json](./flow-motion-acceptance.json) 的联合行为记录与实现代码支持。

| 截图 | 用途与来源 |
| --- | --- |
| [flow-motion-dark.png](./flow-motion-dark.png) | 生产组件 + synthetic 四节点 transport；暗主题、并行依赖、运行表面和静态状态层级 |
| [flow-motion-light-windows.png](./flow-motion-light-windows.png) | 同一生产组件与 synthetic transport；亮主题、选中节点和详情；Windows 平台/原生控制区由 macOS 浏览器模拟 |
| [flow-motion-narrow-windows.png](./flow-motion-narrow-windows.png) | 同一生产组件与 synthetic transport；窄窗口、覆盖式详情、关闭目标；Windows 平台/原生控制区由 macOS 浏览器模拟 |

本轮已有验证记录：定向测试（42 通过、0 失败、6 个文件），Electron typecheck 通过，renderer build 通过，lint（0 errors / 87 existing warnings），diff check 通过。本次 documenter 读取这些结果并核对指定源码、三张截图与 acceptance 文件，未重复执行整套验证。

独立 finish reviewer 的 disposition 为 **ship**。其唯一修复为取消运行节点图标旋转；后续确认未发现该修复直接造成的回归。本记录保持此审查结论，不扩大审查或追加设计优化。

截至记录时，相关实现与本文件仍在本地，未提交、未推送、未创建本轮 PR；`ship` 是本地 finish 判定，不等于远程发布或 Issue 关闭。2026-10-10 通过 GitHub 只读查询确认以下 Issues 仍为 **OPEN**：[#479](https://github.com/0-CHENAI/Selection/issues/479)、[#480](https://github.com/0-CHENAI/Selection/issues/480)、[#481](https://github.com/0-CHENAI/Selection/issues/481)。

## 保留边界

本次只记录可证实的局部合同。系统字体、PRO 色和中性表面是继承事实，不借此重新规范全应用；模拟 Windows 证据、synthetic transport 与既存 lint warnings 均保留其适用范围，不被写成新的品牌规则或已完成实机验收。
