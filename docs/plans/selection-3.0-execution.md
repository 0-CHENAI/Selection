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

`SessionConfig.handover` 是独立来源关系，包含 `handoverId`、来源会话/消息和快照版本。NORM→PRO、PRO→NORM 均创建新根；不借用 parent/worker 身份。模型、连接选择和用户选定的权限模式作为普通配置保留，在一致快照提交时冻结到宿主创建配置，重试使用同一配置；单次操作授权、认证请求、工具参数或凭据不复制。目标操作仍通过原有权限校验和交接复核。既有目标保持自己的权限选择，旧 prepared 回执缺少权限配置时沿用原来的 `safe` 默认。源历史保持原样。

现有 `sessions.COMMAND` 的 `handover` 操作支持 create/get/list/cancel/review。客户端同次请求复用 ID；workspace `handovers/<sha256(id)>/record.json` 依次提交 waiting→prepared→created→applied。prepared 已冻结快照、配置并预留目标 ID；每次重试使用相同目标。目标资料另存 `data/handover/<id>/`，隐藏输入回执 `handover-<id>` 只应用一次；创建交接本身不启动模型。新交接使用新 ID，已有快照和回执不能覆盖。

一致点使用现有跨进程 execution-owner 和 ProjectLock；源会话、相关 worker、后台工作或运行仍活动时等待，不创建目标。取消 waiting 只取消交接请求。暂停且已落盘的 run 可以交接背景；其所有权始终留在原根，目标及其 worker 不可续跑该 run。快照读取已提交 revision 和成果 hash/version，不采未提交 revision 或当前改写的结果文件。

交接包复用 Pi 活动分支的 task_context/history 和 #337 清单。用户原文确定目标、约束和验收；助手结论标为未审查。执行参数从 SDK 原始调用读取，不用 UI 的显示相对路径作为文件或操作身份。文件和网页响应保存独立快照；网页变化仅在用户点击“检查来源变化”时复用 WebFetch 查询，下载路径元数据不参与内容 hash；不能核对时显示无法核对。变化检查不更新冻结输入。缺失输入、凭据排除有明确提示，源删除不会删除目标资料。

未知操作及损坏的执行检查点阻塞目标写入、委派和编排，直到用户在目标记录检查依据和结果；读取和答案交付可继续。已完成请求以原始调用的规范 hash 防重放；缺失请求身份的已完成操作继续禁止重放该工具。约束也覆盖目标 worker。每个模型回合检查目标快照及文件完整性并注入来源背景，权限仍走原有校验。

宿主入口：`SessionManager.handoverSession`、`handover-snapshot.ts`、`reliability/handover-store.ts`；UI 为实际 ChatPage 中的 `HandoverPanel`。F2 命令 `bun scripts/selection-3.0-f2.ts`，阶段记录见 `docs/qa/selection-3.0-handover.md`。交给 #453 的是新 PRO 根与可追溯背景，任务编辑与执行继续复用当前 TaskEditor/TaskRunner。

## #320：多轮编排编辑

AI 提案在本次编辑器打开期间保留对话轮次和应用/放弃状态，携带最新人工草稿；用户可在未应用提案上继续修改。稳定节点 id 的字段差异、图和 YAML 供确认。应用前宿主校验和草稿身份检查均通过后才整体更新未保存草稿，仍不保存或启动运行。可信结构化提交、安全临时生成会话和已有任务 id 保留规则继续生效。

真实四轮模型修改、人工模型/连接/超时配置保留及固定传输 UI 验收见 `docs/qa/selection-3.0-conversation.md`。

## #321：编排编辑器与子界面布局

按实际面板宽度适配定义、节点、图和 YAML；顶部操作固定，长内容滚动。模板、导入、迁移、运行修订与未保存确认统一固定底部返回/取消及操作顺序。实际组件逐项验收、前后截图和明确创建/保存不自动运行的记录见 `docs/qa/selection-3.0-editor-layout.md`。

## #453：统一规范计划与原子修订

TaskSpec 是表单、YAML、生成提案、图和执行的共同定义。`tasks/plan.ts` 提供显式 depends_on 与 prompt/inputs 引用并集；materializeDeps、图拓扑和关键路径复用该结果，保持用户显式字段不被重写。新增节点 `locked`、根 `constraints` / `decisions` 与 `locked_fields`；生成、应用、运行修订均校验保护值，手工解锁是修改保护内容的入口。

每轮生成携带 baseDraftVersion，应用前后同时检查草稿版本和身份；变化只应用到草稿。无效 YAML/引用/环显示诊断并保持旧有效规范计划。保存 task.yaml 仅影响未来运行，保存并启动携带 expectedEtag 后冻结 revision。

`tasks:patchRun` 的 `{slug, runId, baseRevision, yaml, rationale}` 由宿主验证所属 PRO 根与工作区，再通过 definitionToPatch 与 TaskRunner.applyManualPlanPatch 进入既有协调器/patch 校验和提交。仅 pending/ready 可改，运行中或已执行节点、锁、模型连接及权限范围继续受控。新 revision 和日志完成一次 durable checkpoint 后才确认成功；失败回滚内存和追加日志，恢复忽略孤立 revision。冻结计划的约束与决策传给 worker 和评审；评审复用运行已校验的 typed outputs。

F3 的真实两轮生成、模型锁定、A/B 独立运行及 C 等待两份输入、保存不改当前 run，另含客户端冲突与实际 RPC 同 revision 竞争/落盘故障验收，见 `docs/qa/selection-3.0-canonical-plan.md`。#454 应直接复用此规范变更入口、版本和 checkpoint，追加动态调度与运行替换，不另建计划或调度解释。


## #454：动态执行、协作与后继

规划阶段 active/draining/exhausted 是既有运行上的派生信息。node-finished 携带稳定 resultEvent，coordinator checkpoint 冻结待消费集合；计划决定、consumedResultIds 和 revision 原子提交，decisionEventSeqs 排除孤立日志。过期/重复失败不消费成果，关闭 feature flag 不改变既有 run 的规划契约。

TaskNode.actor 为 id/persona，同 actor 的定义顺序进入 effective dependencies，实例也串行。每次执行先落盘 taskRunId/taskNodeId/taskAttempt/taskRevision/taskActor，generation 拒绝前任务迟到事件；当前读取来源字节、模型、连接、权限和完整前缀都符合才复用上下文，否则显式传入已确认成果。托管 worker 以 taskWorkerId 和 taskBinding 定位 root/run/node/attempt/revision，主节点等待所有归属 worker 结算，worker 成果独立保留并参与既有 planner/验收。

停止意图与实际确认写入 execution-shutdown；未知外部结果、执行锁、pending worker 或交付物阻止后继重叠执行。新 run 的 resumedFrom 为规范后继回执，旧 supersededBy 可由其恢复。纯任务缓存 v2 核对原成果 hash/版本和完整条件；已完成历史不原地改写，文件版本变化以 artifact-availability 警告披露，按新输入执行创建后继 run。

F4-a/c/b 三步真实记录及 F4-d/e/f 故障边界见 docs/qa/selection-3.0-dynamic-execution.md/json。#455 在这些身份与独立执行上下文上附研究记录，不能另设执行完成状态或调度器。

### #455 原生深度研究与独立审查

- 原生 deep-research Skill、显式 PRO 模板与配置、严格研究输出契约，复用既有 session-tools、Sources/文件读取与规范执行器。
- node-finished 业务凭证关联真实 run/node/attempt/revision/session/成果 hash；冻结原文、定位与语义支持分开，claim 修订必须独立复核；异议与覆盖从具体凭证派生。
- 同版本校验与渲染保持机器状态和报告一致，普通 PRO/NORM 没有新增研究工作；结果查询、界面与 Handover 保留当前版本和资料限制。
- 真实 F5 运行在审查后重建实例、实际动态追加修订/复核，最终 cost@2/独立支持、成本 covered 1/2、风险 uncovered 1/2、structured PASS；实际交接到新 NORM。驱动失败与恢复核验分别记录。
- 入口、范围与验收见 `docs/qa/selection-3.0-deep-research.md/json`；后续 #456 继续扩展语义关系、多前提与共享规范任务。3.1 自动阅读凭据和自动来源包仍在 #449。

### #456 多前提、共享问题与条件式报告

- 在同一研究记录上追加稳定研究线、六项明确口径的共享问题及双方精确父输入，沿用既有原子 revision 注册一个 canonical task。语义 supports/refutes/converges 关系不改变执行 DAG。
- 精确 inputClaimRefs、来源版本及独立审查派生当前有效性；同一执行根的安全后继核对标准、records hash 与生产凭证，只重新安排受影响任务。异议必须明确 correct/revisedClaimRef 且独立支持才能解决。
- 条件式报告与界面保留不同推荐、各线覆盖、双方共享输入、替代解释与改变结论所需证据。Handover 保留历史报告并明确当前后继，当前待办不会复活已被修正的旧缺口。
- 实际 F6 在共享电价复核后重建宿主，后继仅修正高线原事实并复核/报告；高利用率选 A、低利用率选 B，成本 2/2 covered、风险 2/2 uncovered、市场异议仍 limited、实际 PASS 后交接新 NORM。首次失败、驱动断言及实际高开销均保留。
- 入口、边界、组件截图和全部实际凭证见 `docs/qa/selection-3.0-research-lines.md/json`；#457 复验完整桌面闭环与真实模型对照。3.1 九项仍在 #449。

### #457 完整桌面闭环与发布验收

- 显式创建计划可指定当前未绑定的 PRO rootSessionId；宿主检查工作区、根所有权、活动执行与未知操作，并通过既有绑定入口保留背景 / 模型 / 权限。创建不会开始运行，旧 import/adopt 契约不改变。
- 预览构建标志采用静态属性供 renderer 打包替换；恢复只保存带工作区的编辑目标身份。新窗口明确会话路由进入启动 URL，由现有元数据就绪恢复流程处理；Markdown 内部链接复用原宿主安全路由。
- 等待状态允许人工暂停；当前节点成功或进入重试后不暴露旧 blocker，但原历史保留。Handover 精确识别源 run 内部提交记账，保留原文与规范结果；真实外部操作和未知工具仍待复核，目标不能恢复源 run。
- F7 真实桌面从 NORM 阅读 / Task List → 同背景新 PRO → 动态追加修订 / 独立审查 → 两次退出重启 / 两次局部重试 → revision 4 PASS → 新 NORM。原人工锁和 safe 权限保持；成本有限事实支持、风险未覆盖。零调用控制计划实际暂停 / 恢复 / 停止，没有下游派生。
- F0—F7、#337/#320/#321、全部失败样本、真实配对、全量验证及 #448 本地汇总见 `docs/qa/selection-3.0-integrated-acceptance.md/json`。冻结实现提交上的普通模型对照与后续文档提交分开，不能把少量样本解释为性能普遍改善。
- 本轮在本地分阶段提交并合入 version-3.0，未推送 / PR / GitHub 写入；3.1 九项继续归属 #449。
