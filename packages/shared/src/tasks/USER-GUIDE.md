# Tasks / Conductor 用户指南

看板 Tasks 上的 Conductor 按 `task.yaml` 调度子会话。运行完成**不会**自动关闭顶层卡片。

## 入口

打开看板任务 → 定义 / 画布 / YAML / 结果。保存后才把 v1 文件写成 v2。画布只展示拓扑和运行态，不编辑节点；增删改在定义或 YAML。

普通会话输入区的 Swarm 开关默认关闭，只影响当前会话及其后代。开启不代表一定拆分：只有至少两个独立工具工作轨、并行有收益、输入/输出/证据合同完整且父级定义了汇总或验证时才会创建 worker；资格不足会留在当前会话。worker 默认隐藏，可从父会话运行详情进入。

Swarm Token 预算与 DAG run 预算独立计量。`spawn_session` Swarm 的上限固定为 262144 Token，用户不能改。输入区会显示当前 Swarm 用量；达到上限后当前 worker 允许收尾，但不会再派发或唤醒新工作，父会话进入 `need-to-check`。看板 Task 的 `token_budget` 仍由用户提高。

用「生成」时优先走 `submit_task_definition`（结构化 v2 spec），服务端最多修正两次。只有工具不可用时才回退到从回复里截 YAML。

## conduct 与 orchestrate

- **conduct**：启动时冻结 revision 0，只按该图跑。
- **orchestrate**（Beta）：协调器可补丁尚未执行的节点。仅在当前会话开启 Swarm 且通过资格门槛时作为默认策略；还需 `CRAFT_FEATURE_TASKS_ORCHESTRATE=1`，未开旗标时选择器禁用。

`runner` 是运行策略，不是节点种类。任务父会话是系统 Coordinator。

## 节点、引用、参数、输出

- 节点通过 `depends_on` 和 `${nodes.<id>.output}` / `${params.<name>}` 连接。
- map/loop 使用 `${item}` `${index}` `${prev}`。下游依赖整个定义节点，等全部实例结束。
- 声明了 `outputs` 的节点必须 `submit_task_output`。`kind: artifact` 仅接受工作区相对路径，由服务端解析真实路径并拒绝绝对路径和符号链接逃逸。
- 敏感参数不写日志、不落盘明文；重启后 resume/continue 必须重输。一旦写入子会话 prompt，transcript 里可能仍有明文。

## 暂停、预算、审批、重启

- **暂停 / 恢复**：停派发，in-flight 收尾后才 `paused`。
- **继续**：仅 `interrupted`（启动扫描标记，不自动续跑）。
- **停止运行**：取消 in-flight；若有就绪 `finally` 先跑再 `stopped`。与后台任务芯片的 Stop Task 不是同一动作。
- 预算用尽后停派发，空闲时 `waiting-budget`。只有用户能加预算或停止。
- 审批：拒绝或超时 = 节点失败。绝不自动批准。

## v1 迁移

没有 `schema_version` 的文件是 v1。编辑器可内存迁移并显示警告。**未首次保存为 v2 之前，运行仍按 v1**：只执行 session / 旧 orchestrator，其余 kind skip。

首次保存：原 YAML 备份到 `tasks/<slug>/.history/`，写出 `schema_version: 2`。

v3 首次保存同样备份历史并校验 ETag，不改写旧 run log。`cache: pure` 只有在用户确认迁移后才会变成 `run-pure`；`workspace-pure` 必须显式声明。强制质量门要求可检查的 `acceptance_criteria`。

## v3 调度门与验证

- orchestrate v3 在首次调度、节点失败、审批响应、预算恢复、无 ready 节点和最终验证前进入 `waiting-coordinator`。
- 协调器必须调用 `submit_orchestration_decision`（continue / patch / pause）。过期、重复或错误 revision 会被拒绝。
- 等待上限 120 秒；超时后暂停并显示 `coordinator-timeout`，不会自动继续。
- verify/judge 必须 `submit_task_node_verdict`。最终 run verdict 仍由父 Coordinator 的 `submit_task_verdict` 提交，普通聊天文本不是 verdict。

## 补丁边界（orchestrate）

合法补丁只能增改取消 **pending** 节点。不能改已完成节点、任务身份、预算或提高权限。每 run 最多 8 次图 revision。回写定义要用户确认，且只写定义节点，不写展开的 map/loop 实例。

## 运行状态不依赖看板

标题上的运行中、绿色完成点和 `need-to-check` 来自独立的编排状态。审批、预算、权限、非法补丁、失败和恢复缺少敏感参数都进入 `need-to-check` 并展示真实 blocker。现有看板状态只做兼容镜像，不参与派发、恢复或完成判断。

## 技术预览构建与验收

- 构建：`bun run electron:build:swarm-preview`
- macOS 独立包：`bun run electron:dist:swarm-preview:mac`
- 独立身份：`Selection Swarm Preview` / `com.lukilabs.craft-agent.swarm-preview`，产物写入 `apps/electron/release-swarm-preview`，不发布到正式更新通道。

真实模型门槛固定使用 ORDER 连接 `pi-api-key-2` 和 `Laufry`，七个场景各连续运行三次。未完成打包 Electron 与真实模型门槛前不得合入 `test`，也不得默认开放给普通用户。
