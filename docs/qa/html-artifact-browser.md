# HTML 成果浏览器验收（2026-09-28）

## 范围

HTML 成果链接、`html-preview` 单文件/多文件入口、历史 HTML 版本统一使用已有内置浏览器。聊天不执行 HTML；已删除 HTMLPreviewOverlay、InlineHtmlFrame 及专用 iframe 缩放交互实现和导出。图片、PDF、Markdown、代码预览保持原入口。

## 已验证

- 浏览器及文档资源测试：83 通过，覆盖独立临时会话、无 Node/应用 preload、拒绝权限、欢迎页加载竞态、导航限制、关闭回收、中文/空格/编码路径、目录穿越、隐藏文件及逃逸链接。另覆盖外部 frame 无 referrer 时不能读取本地资源、合法 WebSocket、显式打开隐藏 HTML 和窗口创建失败后的授权回收。
- 文件分类、预览规范、Markdown 路由和提示词测试：97 通过。
- Electron RPC 注册：2 通过；新通道明确为 local-only。
- 实际 Electron 页运行：相对 CSS、ES 模块导入、相对 JSON fetch、requestAnimationFrame 和 CSS transform 动画有效；生成页没有 require/electronAPI；两次打开不共享 session；敏感文件和目录外文件读取返回 404；旧版本脚本读取旧快照值。
- 实际前端组件：HTML/HTM/大写 HTML 均调用浏览器入口，没有 readFile/iframe；切换多文件项后打开正确路径；Markdown 仍读取文件并进入原预览。390px 窗口无横向溢出。
- 全工作区 typecheck、根目录 lint、i18n parity/coverage、根目录 electron:build 通过。lint 保留既有警告。
- 本轮复验时独立 Electron 测试页报告 `document.visibilityState = hidden`，截图接口返回 `Current display surface not available for capture`，因此没有把本轮动画截图检查记为通过。上条动画验收来自前一轮可见窗口；当前新增授权规则另行以真实 Electron 的模块、fetch、HEAD、历史快照及 session 隔离检查复验。

## 执行入口

```sh
bun test apps/electron/src/main/__tests__/html-artifact.test.ts apps/electron/src/main/__tests__/browser-pane-manager.test.ts
bun test apps/electron/src/main/handlers/__tests__/registration.test.ts
bun test packages/ui/src/lib/__tests__/file-classification.test.ts packages/ui/src/components/markdown/__tests__/markdown-preview-helpers.test.ts packages/ui/src/components/markdown/__tests__/markdown-link-routing.test.ts packages/shared/src/prompts/__tests__/system.test.ts
bun run typecheck:all
bun run lint
bun run lint:i18n:parity
bun run lint:i18n:coverage
bun run electron:build
```

## 实际限制

- 本机实际运行验收为 macOS；Windows 路径的前端路由已验证，但没有宣称完成 Windows 11 原生窗口/跨盘运行验收。
- 本地资源范围为所打开 HTML 所在目录及子目录，父目录和原始 file:// 引用不开放。远程资源遵守浏览器 CORS 和联网条件。
- 既有版本机制保存单个文件，不归档独立 CSS/JS/图片。历史预览仅使用快照目录，不能以当前文件依赖冒充历史资源。需要完整可复现的 HTML 版本时使用内嵌资源。
- 生成页面在用户点击后执行 JavaScript 和联网；临时会话与普通浏览器登录状态隔离。它不再是禁止脚本的邮件阅读器。
- apps/electron 下的旧 `build` 脚本末尾引用不存在的 scripts/validate-assets.ts；本次使用根目录正式 electron:build 完成构建，没有修改无关构建脚本。

## 开发热更新兼容补充

真实开发实例复现了 `No handler for: browser-pane:open-html-file`：运行的 Electron 主进程仍为 2026-09-27 22:53 启动的旧代码，Vite 已更新前端。esbuild watch 只重建 main.cjs，不自动重启进程。

前端现在先查询主进程声明的通道；旧主进程、旧 API 对象或 CHANNEL_NOT_FOUND 使用已有授权文件打开接口，并提示重启后启用内置浏览器。权限、文件缺失、网络错误不进入兼容分支，不伪装成功。新增兼容及现有文件动作测试 12 通过；Electron 类型、受影响文件 lint、i18n 与 renderer 构建通过。

在用户当前会话点击月报成果入口，已确认 Chrome 出现 `八月运营月报 — Novalab · 虚构演示数据`，URL 为该会话 data 目录中的准确 HTML 路径。没有重启用户应用或中断其他任务。

## 成果版本窗口

在实际 Selection 会话重新打开成果版本，确认文件名后直接显示 v1、短标识、当前版本、摘要、时间与预览入口；已按产品要求移除中间两段说明。预览按钮等待实际打开结果，失败保留在窗口内，不提前撤掉加载状态。
