# 流式文本与 Markdown 渲染稳定性

视觉来源：[Transitions.dev — Streaming text](https://transitions.dev/detail.html?t=streaming-text)。产品集成保留渐显和原缓动，不使用示例的逐词定时重播。

## 当前行为

- 每条消息的首帧、历史内容、新消息身份、替换文本及完成内容同步呈现。正在流式追加的增量通过 `useFrameContent` 合并到下一显示帧；只合并已有内容，不人为逐字排队。完成时取消待提交的旧帧并同步呈现全部文本。
- 帧输入和流式生命周期标记在 React 提交后的布局效果中更新。被挂起或放弃的并发渲染不更新这些缓存；完成与消息切换仍同步显示。
- `rehypeStreamChunks` 给文本片段附加 Markdown 源文范围。渐显控制器以已提交源文长度为界，仅为新范围播放动画。加粗、链接、表格、引用定义补齐导致 DOM 替换时，已显示文字立即保持可见。
- 预处理可能重写已收到的链接、货币或预览内容。源文不再是前一版本的追加时，本次结构更新直接显示；实体、转义及无源文范围的生成节点保守处理，避免把旧文字当成新内容。
- 源文被替换时，屏幕外已有的待显示节点也立即解除裁剪；不能继续等待进入视口后才显示被修正的文字。
- 默认时长 `--stream-fade: 180ms`、`--stream-gap: 0ms`，缓动 `cubic-bezier(0.22, 1, 0.36, 1)`。默认仅 opacity 动画，不创建 filter/transform 动画层。`--stream-blur` 默认 `0px`，需要时可以显式覆盖为非零值。
- 每帧最多测量 32 个变更单元，超出预算直接显示；完成不会截断正在播放的淡入。历史消息、选择文字、缩放窗口及 reduced-motion 保留立即显示行为。动画不改变排版高度。
- `remarkStreamingCache` 缓存未被插件修改的解析树，复用已有稳定块，仅解析整个末尾块；不能把空行当作列表、引用或代码围栏已经结束的依据。引用/脚注定义和 HTML 使用整篇解析；预处理改写源文、消息替换则重建缓存。缓存树与传给后续插件的树隔离，保留全局行号及源文偏移。
- 聊天自动滚动与“回到底部”共用 `createStickyScrollFollow`：ResizeObserver 更新目标，一条 rAF 循环跟随，不因每个 token 重启动画、不平移整篇正文。reduced-motion、显式即时滚动及超过一屏的自动增长立即吸底。用户向上阅读后停止跟随，卸载时取消待执行帧。进入实时跟随时取消虚拟列表旧的滚动目标，避免两套控制器竞争。
- 未闭合的富内容围栏保留占位，完成后使用原有富内容组件。正文自然增长，底栏预留固定高度，不在完成时额外撑开卡片。

## 验证

```sh
bun test packages/ui/src/components/markdown/__tests__
bun test packages/ui/src/components/chat/__tests__/turn-thinking-indicator.test.tsx packages/ui/src/components/chat/__tests__/natural-answer-stream.test.ts apps/electron/src/renderer/components/app-shell/__tests__/ChatDisplay.scroll-to-bottom.test.ts apps/electron/src/renderer/components/app-shell/__tests__/ChatVirtualHistory.test.ts
bun run typecheck:electron
bun run lint:ui
bun run lint:electron
bun run electron:build:renderer
# Electron Vite 已运行时：
ego-browser nodejs < scripts/qa-streaming-stability.js
```

2026-10-14 使用生产 ResponseCard / Markdown / 滚动控制器进行浏览器回放：

- 加粗及链接补齐仅新尾部渐显；表格表头不重播，新行渐显。
- 同一帧内 20 次追加合并为一个新的文字片段和一次 180ms 淡入，未丢失文本。
- 完成同步提交全部文本，待执行旧帧不能覆盖它；首段 DOM 身份保留，历史不播放动画，替换文本及新消息不显示旧内容。
- 晚到的引用定义及脚注可用，未完成 Mermaid 围栏在完成后正确切换。
- 回放滚动最大单帧位移 5.5px，最终底部误差 0px；向上阅读后位置保持，完成阶段底栏未额外移动。
- 缓存单测逐字符对照完整 Markdown 解析，覆盖列表、引用、表格、围栏、缩进、HTML、引用及脚注定义；100 段稳定前文追加时，解析输入只有末尾块。
- 审查补充列表内引用定义、含转义方括号和跨行标签的回归：出现可能的全局引用定义时保守整篇解析，避免早先段落遗漏链接。
- 帧调度清理后清空取消的帧 id；字素边界检测直接定位边界所在字素，避免为整段尾文分配分词数组；无围栏正文跳过按行扫描。
- 补充挂起/放弃渲染、完成和消息身份切换的帧调度回归；浏览器使用真实渐显控制器验证屏幕外段落被替换后立即解除隐藏。滚动回放有 1.5 秒收敛上限，继续保留位移、方向、底部误差和读者控制断言，避免把固定帧数误当作高刷新率显示器上的时间预算。

浏览器结果使用模拟增量，不代表真实模型/网络的端到端帧率。默认去掉 blur，动画层也不掩盖网络自身的停顿。

## 历史对话中的部分位置元数据

2026-10-14 使用“蒙提霍尔概率问题”的实际历史消息复现并修复 `Cannot read properties of undefined (reading 'offset')`。`rehype-raw` 会把嵌套列表父项的标点与换行合并为只有 `position.start`、没有 `position.end` 的文本节点。范围读取现在分别检查起点和终点；不完整范围的文字继续显示，不猜测动画范围。

新增最小嵌套列表回归及三个渲染模式的历史加载测试。生产 TurnCard 在 StrictMode 下回放实际两轮历史消息，没有异常，Mermaid 图成功渲染；同时确认桌面中的原对话已恢复显示。实际历史数据仅用于本地验证，未加入仓库。

## 工作状态加载图标

聊天页已有带计时的顶部工作状态，通过 `hasExternalWorkStatus` 告诉 TurnCard 不再显示通用思考头或工具间隙的加载占位。实际工具行继续呈现自身状态；独立会话查看器默认保留原有思考提示。

运行 `ego-browser nodejs < scripts/qa-work-status-loading.js` 验证生产 ChatDisplay。2026-10-14 回放首个回复前、空思考、缓冲、工具运行（折叠）、工具间隙（折叠/展开）、正文流式及完成共八种状态，逐帧记录可见图标：每个运行阶段始终只有一个通用加载图标，完成后没有加载图标，顶部勾和耗时保留。

回放每次生成独立测试会话，避免上一轮保存的工作链展开状态影响“折叠”场景，不清除用户已有偏好。展开实际运行中的工具时，该工具自己的状态图标仍正常显示。
