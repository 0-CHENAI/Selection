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
