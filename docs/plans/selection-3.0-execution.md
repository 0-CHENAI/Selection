# Selection 3.0 执行约定

对应 #448 的共用约定，第一阶段由 #450 交付。产品版本 3.0 与 `TaskSpec.schema_version: 3` 是不同概念。

## 权威数据与身份

```text
workspaceId / workspaceRoot
  └─ 根会话 orchestratorSessionId（目标、模型、既有权限）
      └─ taskSlug / TaskSpec.id（整份工作流，不是节点）
          └─ runId / revision（一次运行及冻结计划）
              └─ nodeId / instanceId / attempt
                  ├─ sessionId（实际执行会话）
                  └─ NodeOutput（文本、结构化输出、文件版本/hash与集成回执）
```

任务、运行和成果的存储读取必须携带所属 `workspaceRoot`，RPC 必须先解析 `workspaceId`。`RunSnapshot.workspaceId` 在推送中保留此归属。相同 slug 在另一个 workspace 没有同一成果。

节点 attempt 的计划版本来自 `node-scheduled` 事件；异步创建会话期间其他节点的 patch 不改变该 attempt 的版本。`nodes[].attempts` 提供执行会话、attempt、revision 与终态。持续复用的逻辑 actor 属于 #454；当前没有额外 actor 存储。

## 实际入口

| 操作 | 当前代码入口 | 边界 |
| --- | --- | --- |
| 创建定义及根会话 | `createTaskFromSpec`、`tasks:create` | 保存任务不启动执行；现有 attach/adopt 入口仍复用原根会话 |
| 读取/保存定义 | `loadTaskDocument`、`saveTaskDocument`、`tasks:get/save` | `task.yaml` 是草稿的保存结果；etag 保护覆盖，保存不改已有 run |
| 启动 | `TaskRunner.run`、`tasks:run` | 校验后冻结 revision 0，创建真实执行会话，沿用模型/连接；节点权限受定义 ceiling 约束 |
| 运行变更 | `applyOrchestrationPatch` / `applyOrchestrationDecisionByRunId` | 根协调者、baseRevision、节点状态、既有权限及图校验；落盘后推送 |
| 运行查询/恢复 | `getRunState`、`getLatestRun`、`getRunHistory`、`scanUnfinished` | 从日志和已提交 revision 恢复，历史读取不调度；启动扫描把未完成执行标为 interrupted |
| 成果提交/查询 | `submitNodeOutput`、`loadTaskResults`、`tasks:get_results` | 节点输出先落盘再提交 done，文件保存版本/hash；查询返回根会话、任务、revision、attempt、执行会话和成果 |
| 错误与人工处理 | `tasks:continue/pause/resume/stop` | interrupted 不自动重做；已完成节点复用记录，未知副作用先复核后明确继续 |

追加式 `run-log.jsonl` 保存运行事实，`run-state.json` 是检查点，`RunSnapshot` 是派生查询。UI 不独立维护可写的执行终态。成果查询与恢复采用相同的已提交 revision；不能仅凭最新 `spec-revisions` 文件采纳可能未提交的计划。

宿主调用链为 `SessionManager → TaskRunner → SessionManager.createSession/sendMessage → agent → submit_task_output/onSessionComplete → 节点输出和运行日志 → 查询/RPC推送`。单节点 `conduct` 可直接完成，不自动启动 Swarm，也不改变模型或节点权限。

## 后续接入

- #451 在根会话持久化 NORM/PRO，统一宿主能力校验；`permissionMode` 继续独立控制操作授权。
- #452 在会话存储增加独立交接来源和一致快照，引用以上 run/成果入口；不借用 worker 的 `parentSessionId`。
- #453 继续使用 `TaskSpec`、定义 etag、冻结 revision 与已校验 patch；表单/YAML/AI 不各存一份执行状态。
- #454 增加连续 actor 和动态调度；#455 的研究记录只引用执行事实和成果版本，不成为第二个调度器。

## F0 验收入口

固定资料为 `scripts/fixtures/selection-3.0/costs.txt`：A 两年 100 万元，B 口径待核对，风险资料有缺口。

```sh
bun scripts/selection-3.0-f0.ts
bun scripts/selection-3.0-f0.ts --inspect <slug> <runId>
bun test packages/shared/src/tasks/results.test.ts packages/server-core/src/tasks packages/server-core/src/handlers/rpc/tasks.startup.test.ts packages/server-core/src/handlers/rpc/tasks.proposal.test.ts
```

运行脚本使用已配置的 workspace、默认连接和原模型，创建隐藏的 safe 会话，通过真实 agent 读取资料和提交结构化成果。`F0_WORKSPACE_ID`、`F0_LLM_CONNECTION` 可指定配置；`F0_RECORD_PATH` 可指定验收记录路径。记录包含资料 hash、配置、根会话、run、revision、attempt、执行会话、成果以及普通会话/旧 conduct 编排的回归结果。`--inspect` 是跨进程只读重载，不启动 worker，不修改原日志。

恢复与中断的确定性检查沿用 `TaskRunner.test.ts` 的 `scans a crashed running run as interrupted and continues without re-running done nodes` 等案例：扫描不执行未知操作；明确继续才执行 interrupted 节点，done 节点不再运行。日志恢复不构成外部操作恰好执行一次的保证。

各阶段的实际结果另记在 `docs/qa/selection-3.0-stage-01.md`；后续阶段同步扩展本说明，不提前建立研究 schema。

## #451：会话模式与能力边界

正式字段位于会话 JSONL header、metadata、`SessionConfig` 和协议 DTO：`workMode?: 'NORM' | 'PRO'`、`workModeNeedsReview?: boolean`、`executionRootSessionId?: string`。新普通会话默认 NORM，任务定义/编排草稿根会话默认 PRO；worker 继承根模式和执行归属。工作开始后类型固定，导航只切列表和新建草稿。`permissionMode`、模型与连接继续独立保存。

`migrateWorkModes` 按每个 workspace 的全部 header 迁移：合法显式模式保留；实际任务/托管子会话的根归 PRO；仅开启 Swarm 开关和普通记录归 NORM；缺失父级、循环、worker 身份缺根或模式与活动归属矛盾时保留记录，标记待核对并阻止新增复杂执行。第二次迁移不改结果，不修改权限、模型和既有任务关系。

| 能力入口 | 实际模式校验 |
| --- | --- |
| Pi 工具目录 / 原生 Task、Agent / session aliases | `getSessionToolProxyDefs`、`runPreToolUseChecks`、宿主 `onBeforeToolExecution` 共用 `complexToolCapability` / `complexCapabilityError` |
| 自动/显式 worker、既有 worker 收到新任务 | `spawnSessionFromTool`、`createSession(parentSessionId)`、`sendAgentMessageFn`；只允许同执行根的 PRO coordinator，并继续检查 Swarm 全局设置和原授权 |
| 编排定义提交/绑定/启动 | `submitTaskDefinitionFn`、adopt/bind、`runTaskFromTool`、`tasks:run`、`TaskRunner.run`；启动必须提供同 workspace 的 PRO 根 |
| 运行计划修改 | patch/decision 回调及工具执行前统一校验；原 baseRevision、节点锁和权限检查保留 |
| 会话能力初始化 | Pi execution scope 与 Swarm init 只向合格根开放委派；worker/reviewer 只完成已分配工作，不自提角色 |
| 普通工具、Skills、Sources、成果与 Task List | 保留现有工具路径；NORM 文件反馈在当前单 agent 内修改隔离候选，使用独立反馈回执，恢复原目录；中断后保留候选并先人工复核 |

renderer `workModeViewAtom` 是导航视图，`sessionWorkModeView` 根据真实执行根高亮深链接；`draftSessionOptionsId(workspace, project, mode)` 隔离两种草稿的文本、附件、模型、目录、Sources、思考选项和 Swarm 选择。尚未发送的草稿只保留于 renderer，程序退出后的跨进程草稿恢复不在本阶段新增。

`executionChildrenByRoot` 将 worker/reviewer 排在真实根下面，复用 `SessionItem` 状态、未读和菜单；缺失可见根的待核对执行单独展示，不伪造可执行根。顶部 NORM/PRO 在桌面和紧凑布局均可选择。切换模式不会停止已有运行。

F1 使用 `bun scripts/selection-3.0-f1.ts`，真实单 agent 读取固定资料并提交 #337 清单，校验委派拒绝、任务目录未变、worker 数为零、模式落盘和原权限/模型保留。阶段验收记录见 `docs/qa/selection-3.0-session-modes.md`。#452 的 handover 来源必须使用独立字段，不能复用 `executionRootSessionId` 或 `parentSessionId`。

## #452：独立根会话的可靠交接

`SessionConfig.handover` 是独立来源关系，包含 `handoverId`、来源会话/消息和快照版本。NORM→PRO、PRO→NORM 均创建新根；不借用 parent/worker 身份。模型和连接选择作为普通配置保留，目标从 `safe` 权限开始，不复制授权、认证请求、工具参数或凭据。源历史保持原样。

现有 `sessions.COMMAND` 的 `handover` 操作支持 create/get/list/cancel/review。客户端同次请求复用 ID；workspace `handovers/<sha256(id)>/record.json` 依次提交 waiting→prepared→created→applied。prepared 已冻结快照、配置并预留目标 ID；每次重试使用相同目标。目标资料另存 `data/handover/<id>/`，隐藏输入回执 `handover-<id>` 只应用一次；创建交接本身不启动模型。新交接使用新 ID，已有快照和回执不能覆盖。

一致点使用现有跨进程 execution-owner 和 ProjectLock；源会话、相关 worker、后台工作或运行仍活动时等待，不创建目标。取消 waiting 只取消交接请求。暂停且已落盘的 run 可以交接背景；其所有权始终留在原根，目标及其 worker 不可续跑该 run。快照读取已提交 revision 和成果 hash/version，不采未提交 revision 或当前改写的结果文件。

交接包复用 Pi 活动分支的 task_context/history 和 #337 清单。用户原文确定目标、约束和验收；助手结论标为未审查。执行参数从 SDK 原始调用读取，不用 UI 的显示相对路径作为文件或操作身份。文件和网页响应保存独立快照；网页变化仅在用户点击“检查来源变化”时复用 WebFetch 查询，下载路径元数据不参与内容 hash；不能核对时显示无法核对。变化检查不更新冻结输入。缺失输入、凭据排除有明确提示，源删除不会删除目标资料。

未知操作及损坏的执行检查点阻塞目标写入、委派和编排，直到用户在目标记录检查依据和结果；读取和答案交付可继续。已完成请求以原始调用的规范 hash 防重放；缺失请求身份的已完成操作继续禁止重放该工具。约束也覆盖目标 worker。每个模型回合检查目标快照及文件完整性并注入来源背景，权限仍走原有校验。

宿主入口：`SessionManager.handoverSession`、`handover-snapshot.ts`、`reliability/handover-store.ts`；UI 为实际 ChatPage 中的 `HandoverPanel`。F2 命令 `bun scripts/selection-3.0-f2.ts`，阶段记录见 `docs/qa/selection-3.0-handover.md`。交给 #453 的是新 PRO 根与可追溯背景，任务编辑与执行继续复用当前 TaskEditor/TaskRunner。

## #320：多轮编排编辑

AI 提案在本次编辑器打开期间保留对话轮次和应用/放弃状态，携带最新人工草稿；用户可在未应用提案上继续修改。稳定节点 id 的字段差异、图和 YAML 供确认。应用前宿主校验和草稿身份检查均通过后才整体更新未保存草稿，仍不保存或启动运行。可信结构化提交、安全临时生成会话和已有任务 id 保留规则继续生效。

真实四轮模型修改、人工模型/连接/超时配置保留及固定传输 UI 验收见 `docs/qa/selection-3.0-conversation.md`。
