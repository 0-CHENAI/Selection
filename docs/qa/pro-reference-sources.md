# PRO 交接网页的参考来源

2026-10-04，基于 `version-3.0` 的 `b7cafd216`。

PRO 会读取交接保存的 WebFetch 网页快照。快照仍保留 `Content from <原始 URL>`，但原来的来源提取只接受 WebSearch/WebFetch，漏掉了这些 Read 记录。修复在共享提取函数中识别交接目录下的内容哈希 `.txt` 文件，并要求输出符合原有网页协议。支持 Native 的 `file_path`、Pi 的 `path`、会话路径占位符及 Windows 路径。

沿用现有回答底部的参考来源按钮和右侧资料栏。仅收集本轮成功读取的网页，去重后保留原始 URL 和网页摘要。普通文件、快照清单、无关工具、失败及未完成读取不进入来源列表，也不把网页内部的其他链接当成已读取来源。

## 验收

- 只读加载本次缺失来源的真实 PRO 会话，通过生产使用的消息转换、回合分组和来源提取函数验证：最新回答的 3 次成功 Read 对应 3 个来源。没有修改会话数据或重新调用模型、网络抓取。
- `source-metadata.test.ts`、`turn-sources.test.tsx`、`response-sources.test.ts` 共 35 项通过，0 失败。覆盖快照路径、去重、错误记录排除、其他回合隔离，以及应用和动画两条渲染路径。
- Playground 的 `Turn Cards → PRO Reference Sources` 使用真实 TurnCard、来源按钮及来源侧栏，可切换 PRO 快照和 NORM WebFetch；仅示例资料使用固定数据。
- 同一个 ego-browser 测试空间验证 PRO/NORM 均显示 3 条来源，侧栏摘要与地址正确，Enter 打开、Escape/关闭按钮关闭。点击资料捕获到原始 URL；测试拦截外部跳转，没有访问示例网站。
- 深色、浅色和 390px 窄视口验证通过。窄视口仅将测试组件填充视口，确认参考来源按钮完整可见；临时测试样式和视口设置已清理。内置浏览器也已验证打开来源侧栏。

截图：`pro-reference-sources-dark.png`、`pro-reference-sources-light.png`、`pro-reference-sources-narrow.png`、`pro-reference-sources-iab.png`。

## 代码检查

工作区类型检查、改动文件 ESLint、渲染端构建和差异检查通过。
