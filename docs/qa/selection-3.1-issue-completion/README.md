# 2026-10-09：保留 Issue 的修复与原生验收

基准是 `origin/test` 的 `f9e515235bf48a06e8dc25a540b42ec9fae45be5`。本次使用隔离配置与普通 macOS arm64 桌面构建，不设置额外功能开关；连接为现有 GPT-6-luna。这里区分源码测试、真实模型、原生界面、远端交付，历史通过不替代新的阻断项。

## #446：消息分支的即时与重开历史

普通桌面 NORM 根 `261009-spry-cove` 从消息创建分支 `261009-eager-coast`。新分支立即显示截至所选助手消息的 3 条历史；原根后续 3 条未进入；离开并重开仍是同一 3 条。来自真实 RPC 与原生 UI，无补写聊天历史。见 [branch.json](branch.json)。相关即时消息 hydration 已存在于 test，本次补齐复验凭据。

## NORM / PRO 与旧包截图

用户截图中的 QA 包位于 `/tmp/selection-pro-package-mounted/Selection.app`，源码 `6c8bfd5f0`，并非当前 test / 本轮构建。该根的持久模式实际为 PRO；外部创建会话没有广播完整 metadata，窗口按默认值显示 NORM，同时留下旧版顶部状态条与编排 icon。CREATE 恢复 `session_created` 广播，沿用现有窗口去重与权威 metadata hydration。真正 NORM 后端仍拒绝 Task/Agent/spawn/DAG，开启全局编排开关或提高权限也不能绕过。

普通模型 NORM 对照 `261009-slim-pebble`：完成，24 次工具、0 worker。新原生包把外部创建的根 `261009-awake-robin` 立即放入 PRO 列表、显示 λ，实际 worker 与其他操作按同一时间线显示，折叠行点击详情，没有独立顶部子代理按钮；仅实际编排出现 DAG 图标。[PRO 时间线截图](pro-timeline-desktop.png) 只覆盖所示视口，不能代替完整视觉审查。

## #466：协调者检查点修复与联合交付

协调者的 120 秒变为无活动租约：真实文字/思考/工具进展续租，静止 heartbeat、等待请求和 worker 活动不续租；续租记录可恢复。成功 decision/patch 在工具凭据入 SDK 历史后向主机让出回合，避免旧检查点和新检查点交叉。SDK 为此产生的空 aborted 尾消息不被误报为服务中断；真实错误和未接受的中断保留。fresh PRO root 能提供 task_help；owner/run/revision 权限校验不放松，NORM 仍不可用。

首次完整联合模型运行 `261009-awake-robin` 最终 failed：原独立复核节点失败，追加替代复核与报告没有恢复原失败节点。运行中权限从 safe 变为 allow-all，因而不能作为受控三方对照。新增 retry 决策及结构化研究契约提示的后续样本 `261009-eager-canyon` 尚无完成凭据，未计为通过。本记录暂不据此关闭 #466、#449、#468；失败样本保留，最终状态、实际远端提交及 CI 在交付时更新。耗时不代表稳定性能优势。

## 验证范围与执行

- 异步启动的真实回执是 `waiting-coordinator`，原有 UI 仅识别 `running` 导致启动说明误用最终回答卡片。补齐活动状态识别，沿用轻量文字样式、去除虚线气泡与 Copy / Markdown / 分支操作栏。使用普通 arm64 包回放 `261009-grand-delta` 的原始聊天记录，未复制运行任务、未发送模型请求；此 UI 回放不计为模型联合验收。[中间进展截图](pro-interim-progress.png)。相关 20 项测试 / 265 assertions 通过，同时覆盖最终回答、失败/暂停与计划卡片保持原操作。

- Git 跟踪的 730 个源码测试入口已执行。首轮在外部 GitHub MCP OAuth 5 秒网络超时停止：已跑 509 个入口，4505 pass / 1 fail；该文件单独复跑通过，再补完其余 221 入口（3284 pass / 0 fail）。不是一次干净的全套运行，不将重复发现的测试双算。
- 本次提交前对改动及相邻入口执行 207 tests / 1148 assertions，全部通过。模式门禁、创建广播、TaskRunner 活动租约、原失败节点恢复与 SDK 交付保护均有相邻回归。
- 最终 typecheck、lint、Electron build 退出 0。lint 仍有 Electron 87 / shared 8 既有 warnings，无 errors。
- 普通 arm64 目录包装使用本地 ad-hoc 签名。首次自动选择 `Lin` 身份在 codesign 失败；重新关闭身份自动发现后打包成功。未声称正式证书签名或公证发布。
- 原生 PRO 时间线截图仅证明所示视口，不能代替所有后端路径的验收。

复跑：`bun scripts/selection-pro-joint-package-acceptance.ts <隔离配置目录> <label> <PRO|NORM> <冻结资料目录> [既有根ID]`；既有 ID 只观察不重发目标。连接配置只在本机读取，不归档 token/API key。
