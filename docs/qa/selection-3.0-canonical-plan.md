# #453 规范计划与 F3 验收

表单、YAML、AI 提案、图和执行器现在使用同一份 TaskSpec。`depends_on` 保留用户显式值，有效依赖再并入 prompt 与 inputs 中的节点引用，图和 TaskRunner 均复用这个结果。保存只更新后续运行的定义；当前运行继续使用冻结 revision。

## 实际入口与公共约定

| 能力 | 入口 / 行为 |
| --- | --- |
| 有效依赖 | `packages/shared/src/tasks/plan.ts` 的 `effectiveNodeDeps` / `planDependencies`；`validate.materializeDeps`、`conductor-graph`、critical-path 共用 |
| 手工保护 | 节点 `locked`；根 `constraints` / `decisions` 与 `locked_fields`。`planProtectionErrors` 在宿主生成、客户端应用和运行 patch 中检查，必须手工解锁后再修改 |
| 多轮草稿 | `TaskEditor` 的单调 draftVersion；`TaskProposal` 请求/结果的 `baseDraftVersion`、草稿身份与应用前后的版本检查。过期提案需重新生成，应用不保存或启动 |
| 保存与运行 | 保存沿用 task document etag；保存期间的后续草稿保留。保存并运行携带 `expectedEtag`，确认定义未被其他保存替换后再冻结 |
| 当前运行修订 | `tasks:patchRun` → `definitionToPatch` → `TaskRunner.applyManualPlanPatch`；等待协调器时复用同一 checkpoint 决策入口，否则复用原 patch 入口 |
| 运行边界 | 宿主验证根会话所属工作区及 PRO 能力、baseRevision、节点 pending/ready 状态、模型、连接、权限上限、锁和完整无环图。running/已执行节点被拒绝，目标/权限等根范围变化要求后继运行 |
| 原子提交 | 先写不可变 revision，再追加决策/patch 日志并原子写一次 checkpoint。落盘失败回滚内存和追加日志；恢复与成果读取只采用 checkpoint 已提交 revision，忽略孤立文件 |
| 执行与评审 | 约束和已定决策来自冻结规范计划；结构化评审附节点输出声明、运行校验后的 typed values、runId 和 revision，沿用原质量门 |

已有节点种类、结构化输入/输出、交付物、质量门和审批点沿用原 schema、YAML 与执行机制，表单不理解的扩展字段继续保留。完整拖拽画布、运行替换、成果复用和动态 actor 协同留给 #454。

## 真实 F3

使用生产 `SessionManager`、生成 RPC 与 `TaskRunner`，只读固定资料；命令：

```sh
bun scripts/selection-3.0-f3.ts
```

第一轮只调整 C 的中文报告要求。用户手工将 B 改为另一个已配置的模型与连接，设置 timeout=1234、locked=true，并锁定约束和决策；第二轮只增加 C 的未核实问题说明，B 全部值保留。第三轮请求触及锁定内容，模型保持定义不变或宿主拒绝非法提案。

执行结果与稳定身份记录在 [机器记录](selection-3.0-canonical-plan.json)。最终 task 为 `f3-1791055813851`、run 为 `run-1791055926614`、PRO 根为 `261004-active-birch`；主模型 gpt-6-luna，B 手改为已配置连接上的 pi/MiniMax-M3。运行 completed，质量门 verdict=pass。A、B 无依赖；C 显式依赖 A，同时输入引用 B，因此图和调度得到 A→C、B→C。run-log 验证 C 的首次派发晚于 A、B 的 done。C 结构化结果为 `a_cost=1000000`、`b_verified=false`，报告保留资料不足和未知风险。启动后另存未来定义中的 B prompt，活动运行的 B 与原冻结计划仍相同。最终评审消息中冻结计划、任务标识、约束/决策、typed values 均已逐项核对。

验收过程中定位并修复了三个真实阻塞：生成模型复制折叠 YAML 时改变锁定 prompt 换行，改为将当前规范计划以 JSON 原值置于生成上下文；会话同步/异步写入共用临时文件导致隔离核对竞争，改为独立临时文件并完整等待排队写入；最终评审只收到 prose，误判缺少已经提交的 typed values，补齐声明与运行校验值。最初固定选择的模型不在该连接配置内，也改为选用实际已配置的第二模型；没有降低质量门或跳过真实执行。

## 实际组件验收

浏览器使用实际 TaskEditor、TaskProposal、ConductorWorkbench 和 ConfirmationHost；宿主传输是固定验收数据，与上面的真实模型执行分开记录。图、YAML 与节点表单均基于同一规范草稿。

| 场景 | 结果 |
| --- | --- |
| 两轮 AI、手改 B 模型并锁定、保护多行约束与决策 | B 与保护值完整保留；两轮状态均显示已应用到草稿，保存/创建/运行均为 0 |
| C 显式依赖 A + 输入引用 B | 画布显示两条边；表单单独显示输入依赖 B，YAML 保留原显式依赖 |
| 无效输入引用、A→C→A 环 | 显示具体诊断，整份 YAML 回退至旧有效草稿；schema 规范化比较确认表单/图/规范计划未变化 |
| AI 请求覆盖锁定 B | 显示 Locked node 原因，B 模型和锁保持原值 |
| 旧提案与新草稿竞争 | 相同内容的后续手工编辑也增加版本，旧提案被拒绝；实际手改 v2 标题同样保留。保存提交也增加版本，关闭/重新打开会丢弃未应用旧提案 |
| 应用到当前运行 | 确认 revision 与仅未执行节点边界；收到宿主完成回执后才显示新版本。此操作保存/创建/启动计数仍为 0 |
| 375×700 活动运行编辑器 | 顶部操作换行可见，无水平溢出；内容继续滚动，提交完成提示显示 revision 1 |

截图：[依赖图](selection-3.0-editor-images/453-f3-canvas.png)、[手工锁定 YAML](selection-3.0-editor-images/453-manual-locked-yaml.png)、[环回滚](selection-3.0-editor-images/453-invalid-cycle.png)、[锁拒绝](selection-3.0-editor-images/453-locked-rejection.png)、[过期拒绝](selection-3.0-editor-images/453-stale-rejection.png)、[运行修订回执](selection-3.0-editor-images/453-active-patch.png)、[窄窗口](selection-3.0-editor-images/453-narrow-active.png)。均已目视检查。

## 自动检查

定向测试覆盖有效依赖与图同源、锁/根字段保护、可选字段删除、无效引用和环、实际 RPC 的同 revision 竞争、NORM 拒绝、执行中节点拒绝、落盘故障回滚及重新加载忽略孤立 revision、协调器 gate 的重试与 durable identity、会话并发 flush、typed values 评审背景。

```sh
bun test packages/shared/src/tasks \
  packages/shared/src/sessions/__tests__/persistence-queue.test.ts \
  packages/shared/src/sessions/__tests__/bundle.test.ts \
  packages/shared/src/sessions/__tests__/jsonl-permission-mode-normalization.test.ts \
  packages/server-core/src/tasks/TaskRunner.test.ts \
  packages/server-core/src/tasks/TaskRunner.v3.test.ts \
  packages/server-core/src/handlers/rpc/tasks.proposal.test.ts \
  packages/server-core/src/handlers/rpc/tasks.plan.test.ts \
  apps/electron/src/renderer/components/app-shell/kanban/__tests__
bun run typecheck:all
bun run lint
bun run lint:i18n:parity
bun run lint:i18n:sorted
bun run electron:build
git diff --check
```

定向结果为 377 tests / 0 failures / 1400 assertions，覆盖 35 files；八包类型检查通过。lint 为 0 errors，既有 Electron 86 / shared 8 warnings；2325 keys 在七语言中一致且排序正确。完整 Electron 构建通过，最终评审上下文补全后的 main 构建再次通过，diff check 通过。此前全仓混跑的既有 mock 污染失败已记录在 #451 验收，相关文件隔离测试通过；本阶段不把定向通过表述为全仓测试通过。

会话持久化修复后额外运行 `handover.test.ts`、宿主与 shared 的 `work-mode.test.ts`、RPC 的 `tasks.work-mode.test.ts`：18 tests / 0 failures / 262 assertions，覆盖 4 files。

## 交给 #454

复用以上 TaskSpec、effective dependencies、frozen revision、PRO/权限边界、同一 patch/CAS 与 checkpoint 提交链路。后续运行替换与成果复用应追加版本和 attempt，不能覆盖已执行节点；需保留锁定、约束、决策以及结构化输出和执行凭证。
