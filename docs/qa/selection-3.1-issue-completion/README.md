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

- 后续按 [#474 收尾执行单](https://github.com/0-CHENAI/Selection/issues/474) 推进，已原生关联为 #466 子 Issue：固定框架 → 首个阻断 → 定向普通包验证 → G7 / 同条件对照 → 远端交付。完全接管旧 test 样本 `261009-fair-sapphire` 复现隔离 worker 原生入口拒绝已提供的 PDF / DOCX / XLSX / PPTX；用户要求等待后先暂停调度、再停放运行。归档为 stopped，720391 ms、97 次工具、3 个 worker、47 条事件，不能作为未经干预的对照或产品自发失败。

- #474 的定向修复沿用宿主已校验并持久化的 `isolatedWorkspace.sourceRoot`，仅提供给文档索引与读取；worker 的 cwd / Shell / Write 保持隔离。当前相关 3 文件 **9 项测试 / 85 assertions**、全工作区类型检查、修改文件 lint 和普通 Electron 构建通过；测试同时覆盖四种原生位置、worker 自有文档、无来源绑定、目录越界、符号链接逃逸、原件变化与既有写入隔离。普通包根 `261010-neat-elk` completed，331602 ms、28 次工具、2 个 worker、14 条事件。隔离检查 worker `261010-swift-meadow` 的四次 document_index 和四次 document_read 全部成功：PDF 第 17 页、DOCX 段落 204、XLSX Costs!B2、PPTX 幻灯片 2；来源 manifest 的 originalHash 与冻结原件一致，返回文字与 snapshot 的实际范围一致。另一独立上下文核对报告与回执范围完整性；它没有重新核验原件语义，后者仍由 G7 验证。六份输入 hash 前后不变，0 人工改图 / 输出 / 判定。见 [worker-documents-pro.json](worker-documents-pro.json)。

- 用户明确保留虚线气泡图标，本轮只恢复并对齐折叠图标列。普通包 13 重开上述已完成会话确认图标与轻量文字出现，中间内容没有 Copy / Markdown / 分支操作；最终回答仍有正常操作。[实际界面](pro-progress-icon.png)。相关 36 tests / 360 assertions、全工作区类型检查、修改文件 lint、普通构建与目录包装通过。此前无图标的截图保留为历史，不能作为当前样式。

- G7 三方案例使用各自目录中的六份等字节原件，避免之前交付的报告被下一例当作输入。记录原始 promptHash 与仅归一化材料目录的 normalizedPromptHash；模型、目标和完全接管权限一致。这个固定案例核对正确性与实际调用，不据此推断普遍性能优势。

- 折叠工作区简介跳过尚未开始的下游节点，继续按时间取最后一项实际活动。相关 20 项测试 / 268 assertions、全工作区类型检查、修改文件 lint 与普通 Electron 构建通过。原生实时确认随本轮完全接管联验完成。

- 按用户最新要求，受控验收从新建时使用 `PRO / allow-all`，对应 UI 的“完全接管”；NORM 仅保留为同权限对照。六份冻结原文件在开始前及结束后分别计算 hash。此前 `261009-grand-delta` 只读样本被关闭隔离回放窗口时误退出宿主打断，终态 stopped，1313717 ms、153 次工具、8 个 worker，不计为成功、性能对照或后端自发中断。

- 异步启动的真实回执是 `waiting-coordinator`，原有 UI 仅识别 `running` 导致启动说明误用最终回答卡片。补齐活动状态识别，沿用轻量文字样式、去除 Copy / Markdown / 分支操作栏。此前误移除了虚线气泡图标，现已按用户要求恢复并调整位置。使用普通 arm64 包回放 `261009-grand-delta` 的原始聊天记录，未复制运行任务、未发送模型请求；此 UI 回放不计为模型联合验收。[早期中间进展截图](pro-interim-progress.png)。相关 20 项测试 / 265 assertions 通过，同时覆盖最终回答、失败/暂停与计划卡片保持原操作。

- Git 跟踪的 730 个源码测试入口已执行。首轮在外部 GitHub MCP OAuth 5 秒网络超时停止：已跑 509 个入口，4505 pass / 1 fail；该文件单独复跑通过，再补完其余 221 入口（3284 pass / 0 fail）。不是一次干净的全套运行，不将重复发现的测试双算。
- 本次提交前对改动及相邻入口执行 207 tests / 1148 assertions，全部通过。模式门禁、创建广播、TaskRunner 活动租约、原失败节点恢复与 SDK 交付保护均有相邻回归。
- 最终 typecheck、lint、Electron build 退出 0。lint 仍有 Electron 87 / shared 8 既有 warnings，无 errors。
- 普通 arm64 目录包装使用本地 ad-hoc 签名。首次自动选择 `Lin` 身份在 codesign 失败；重新关闭身份自动发现后打包成功。未声称正式证书签名或公证发布。
- 原生 PRO 时间线截图仅证明所示视口，不能代替所有后端路径的验收。

复跑：`bun scripts/selection-pro-joint-package-acceptance.ts <隔离配置目录> <label> <PRO|NORM> <冻结资料目录> [既有根ID|-] [定向目标文件]`；既有 ID 只观察不重发目标。连接配置只在本机读取，不归档 token/API key。
