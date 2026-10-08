# #454 动态执行、协作与恢复验收

实现按动态计划、actor/worker 协作、恢复/后继/复用三步推进，三步均使用生产 SessionManager 和 TaskRunner 跑过真实模型执行。完整运行身份、原结果、日志和失败尝试说明保存在 [机器记录](selection-3.0-dynamic-execution.json)。F4-d/e/f 的故障、重复和副作用边界使用确定性宿主测试，未将模拟输出表述为真实模型结果。

## 实际入口与规则

| 能力 | 实际入口及持久化规则 |
| --- | --- |
| 结果消费 | TaskRunner 的稳定 `run:node:attempt:revision:state` resultEvent；协调器 checkpoint 冻结结果集合，决策、消费确认和规范计划 revision 原子提交；失败回滚，过期/重复决策不吞结果 |
| 规划阶段 | `planner.phase` 为 active/draining/exhausted 派生值；不替代 RunStatus。当前 worker、待消费结果、审批、预算和最终验收仍阻塞 completed；最终 PASS 再核对成果文件版本，不能批准验收背景冻结后变化的文件；关闭 preview 开关不能丢弃原 run 的冻结规划规则 |
| 动态计划 | `orchestration-decision.ts`、`orchestration-patch.ts` 继续校验 revision、权限、锁、环和未执行边界；日志记录变更类型、原因、新增/更新/取消 id，Workbench 显示 |
| actor | TaskNode.actor 的 id/persona；effectiveNodeDeps 将同 actor 顺序前缀纳入规范依赖，含 map/replica 实例的实际串行守卫。复用前核对模型、连接、权限、persona、执行前缀和已读取来源当前字节；无法证明时新建上下文并显式传入已确认成果 |
| 工作归属 | SessionManager.bindTaskSession 在每次派发前落盘 run/node/attempt/revision/actor；generation 拒绝旧任务迟到事件。execution-checkpoint 读取器验证整数和 actor 身份。各节点成果分别写入原 node/attempt |
| 托管 worker | spawn_session 的 taskBinding、TaskRunner.reserveWorker/bindWorker/completeWorker；先落盘 reservation，再创建真实会话，成果作为独立 worker 事实进入原节点计划/验收背景。根会话委派、权限上限和既有资格校验保留。3.0 preview 内的委派必须绑定规范运行，worker 不另建计划或聚合验收链 |
| 主节点等待 | `node-awaiting-workers` 保留主节点答复、typed values 和来源；worker 未结算不能提交节点成功。刷新/暂停恢复核对持久化 worker 结果后重放原答复，不重复调用主节点；缺失交付物结算凭证不能仅从 prose 推断成功 |
| 停止与后继 | `execution-shutdown` 持久化停止意图/确认，失败后暂停且刷新仍阻塞。SessionManager 核对执行锁、待创建 worker、实际 backend 停止、pending tools 与交付物；未知副作用阻止重试/重叠工作。新 run 的 resumedFrom 为规范来源，旧 run 的 supersededBy 可从新启动记录重建 |
| 条件复用 | workspace-cache v2 验证完整来源、成果 hash、输入、来源版本、actor/persona/前缀、模型/连接、权限及既有纯任务边界；原成果记录或文件版本改变、缺失/损坏记录均拒绝复用并记录原因 |
| 历史保留 | 已完成 run 的完成事实、原成果和 verdict 保留。外部文件版本变化单独记录 artifact-availability 并显示警告；活动运行的受影响结果仍失效。按新输入重做使用后继 run，不能在完成历史中原地重执行 |

## 三步真实执行

模型 gpt-6-luna，连接 pi-api-key-2，safe 权限；使用只读固定 costs.txt，资料 hash 为 `4c99133f5aba0554887a6e679c276035b86b13a6d88c6da6fbc4868c0a144fb6`。此资料是验收材料，不代表市场事实。脚本通过固定发送时序控制确保并行/先后案例可复现，每份成果与计划决定仍来自真实模型。

| 顺序 | 案例 / 身份 | 结果 |
| --- | --- | --- |
| 1 | F4-a，f4-a-1791078012437 / run-1791078012461 / 261004-prime-laurel | A 完成时 B 仍运行；planner 添加 D、修改 C 依赖；D/B 后 C 取得 typed values，D 只创建一次。revision 1、消费 4 份结果、pending 0、exhausted、最终 verdict pass |
| 2 | F4-c，f4-c-1791079613512 / run-1791079613543 / 261004-fresh-coral | A1/A2 同会话 261004-fit-ocean，A2 恢复仅存在于 A1 私有上下文的随机标记；两份成果分别归属。B 独立并行。reviewer 261004-brave-eclipse 归属 A2 attempt 1，主节点答复后仍等待 reviewer 结算 |
| 3 | F4-b，f4-b-1791079747396 / 261004-bold-tulip；run-1791079747421 → run-1791079792891 | 授权预算情景从 1000000 改为 1100000，新 run 重做 A/C，B 纯任务条件不变命中原 run 缓存且无第二次模型调用；旧 A/C 和原报告逐项相等，来源双向关联 |

命令分别为 `bun scripts/selection-3.0-f4.ts`、`bun scripts/selection-3.0-f4-cooperation.ts`、`bun scripts/selection-3.0-f4-successor.ts`。可使用 F4_RECORD_PATH 保存独立尝试。协作案例中的 reviewer 资格由固定内部验收入口授予，实际创建、归属、权限、模型和结算仍使用生产路径；正常工具调用继续要求当前回合资格。

首次 F4-a 因 120 秒 planner 超时暂停；后续真实重试通过。首次 F4-c 暴露原 checkpoint 读取器仅接受字符串身份的问题，修复后两次通过，第三次包含来源字节复用条件。F4-b 首次脚本字符串转义错误发生在模型调用前，修复后真实运行通过。所有失败均保留在机器记录的尝试说明，不将失败算为模型成功。

## F4-d/e/f 与组件验收

确定性回归覆盖：孤立 revision/决策文件忽略、同 decisionId 重试不重复增图；已提交 patch 后尚未启动 worker 的恢复；成果落盘后待消费事件恢复；主节点等待 reviewer 时的运行中和暂停崩溃恢复；重复/迟到 worker 完成、创建后 Stop；模拟副作用计数器保持旧执行停止前不新增效果，未知结果阻塞；停止失败跨重启保留未确认记录；pending results、最终验收、锁、暂停和审批等待不提前结算；来源变化、actor/persona/前缀变化、损坏/缺失复用凭证拒绝缓存。

组件使用实际 TaskEditor/ConductorWorkbench，固定传输与真实模型记录分开。1200×850 下显示变更原因、worker 节点/attempt/revision、独立成果、来源运行和 actor 详情；查看执行会话回调携带真实所选会话 id，保存/创建/运行计数仍为 0。375×700 无横向溢出，展开长成果后内容可滚动、图高度 204px，节点详情可独立滚动，summary 的键盘焦点可达。截图已目视检查：[宽屏](selection-3.0-editor-images/454-dynamic-workers-wide.png)、[窄屏状态](selection-3.0-editor-images/454-dynamic-workers-narrow.png)、[窄屏图与详情](selection-3.0-editor-images/454-narrow-actor-detail.png)。浏览器翻译扩展的边缘浮层不属于产品控件。

## 验证

```sh
bun test packages/shared/src/tasks packages/server-core/src/tasks \
  packages/server-core/src/handlers/rpc/tasks.*.test.ts \
  packages/server-core/src/sessions/spawn-session*.test.ts \
  packages/server-core/src/sessions/swarm-delivery.test.ts \
  packages/server-core/src/sessions/task-cooperation.test.ts \
  packages/server-core/src/reliability/execution-checkpoint.test.ts \
  packages/shared/src/agent/__tests__/spawn-session-thinking-level.test.ts
bun run typecheck:all
bun run lint
bun run lint:i18n:parity
bun run lint:i18n:sorted
bun run lint:i18n:coverage
bun run electron:build
git diff --check
```

综合定向回归 441 pass / 0 fail / 1853 assertions / 35 files。实际 UI 单元回归 91 pass / 0 fail / 310 assertions / 14 files。最终 PASS 文件版本守卫的执行器回归 165 pass / 0 fail / 794 assertions / 3 files。后续损坏 JSON 拒绝及交付物缺凭证守卫另跑安全回归 15 pass / 0 fail / 58 assertions；八包类型检查通过，守卫修改后 server-core 再检。lint 0 errors、既有 warnings；2349 个 key 在七语言中一致，调用引用检查与排序通过。完整 Electron 构建通过，最终 UI/语言修改后 renderer 再构建，最终验收守卫修改后 main 再构建。#457 负责全仓 tracked tests、真实桌面端到端与配对比较；本记录不把定向测试称为全仓通过。

运行 token 指标沿用历史 runner 的 context/session 估计值；不能据此作总调用成本比较。#457 的配对比较必须使用完整逐调用/逐回合账，纳入 planner/reviewer/retry。

## 交给 #455

研究记录引用上述 run/node/attempt/revision/成果版本与独立 reviewer 会话，研究 revision 继续走规范计划提交；资料缺口补任务复用动态 patch，不新增调度器。Deep Research 只用于显式选择的 PRO；普通 PRO/NORM 继续原路径。3.1 阅读凭据、自动来源包、细化阶段门和多图投影继续留在 #449。
