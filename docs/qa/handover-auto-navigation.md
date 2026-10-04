# 交接完成后自动进入目标聊天

2026-10-04，基于 `version-3.0` 的 `7a130f863`。

确认交接后先加载并注册目标会话，再关闭弹窗并导航到目标聊天。保存“下次不再显示”后使用相同流程。源会话仍保留原模式；交接详情只在主动点击“查看交接”时展示。

## 界面验收

同一 ego-browser 空间运行真实 `HandoverPanel`，Playground 固定传输返回完整会话，并通过真实导航事件切换预览。新目标最初不在元数据中；预览会拒绝导航到尚未注册的会话，因此覆盖目标创建通知与导航的先后问题。此处不启动模型工作。

`scripts/qa-handover-button.js` 和 `scripts/qa-handover-preference.js` 通过，覆盖：

- 默认确认、键盘 Enter/Space、触屏与 7 种语言入口。
- 勾选后确认保存；取消不保存；重新加载后直接交接。
- NORM→PRO→NORM，均自动进入目标聊天；返回源会话时源模式仍为 NORM。
- 创建和目标加载期间禁止重复请求；加载完成前不导航。
- 等待可查看和取消；完成后自动导航，包括完成通知与延迟轮询同时返回的情况。
- 主动查看既有交接详情不触发自动导航。
- 创建失败与目标加载失败保留源聊天并显示可重试错误；加载重试只保留一条交接记录。

两个脚本均恢复测试前的跳过确认偏好，没有清空其他存储。

截图已目视检查：`handover-dialog-dark.png`、`handover-dialog-light.png`、`handover-dialog-narrow.png` 为确认前界面；`handover-chat-pro.png` 为确认后直接进入的聊天预览。原自动展示结果页的截图已由聊天预览替换。用户当前的内置浏览器也已验证确认后进入 PRO，未出现详情弹窗。

## 代码检查

`bun test` 执行交接宿主、工作模式导航与导航事件桥接三个测试文件：25 通过、0 失败、143 次断言。`bun run typecheck:all`、改动组件 ESLint、QA 脚本语法检查、`bun run electron:build:renderer` 和 `git diff --check` 通过。
