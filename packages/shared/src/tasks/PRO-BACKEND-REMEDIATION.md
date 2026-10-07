# 后端核验整改

父框架：[核验整改 #468](https://github.com/0-CHENAI/Selection/issues/468)，归属 [#449](https://github.com/0-CHENAI/Selection/issues/449)。沿用 #448 的框架 → 内容填充 → 联合验收顺序，复用规范计划、Conductor / TaskRunner、研究记录和原生 Skills。

## 阶段

| 顺序 | Issue | 交付与边界 |
| --- | --- | --- |
| 01 框架可靠性 | [#469](https://github.com/0-CHENAI/Selection/issues/469) | 宿主观察实际模型 / 工具活动，过滤当前根会话；失败证据先保存再清理；worker 工具身份回归 |
| 02 并发反馈 | [#470](https://github.com/0-CHENAI/Selection/issues/470)、所属 [#461](https://github.com/0-CHENAI/Selection/issues/461) | 每次额度调整形成准入代际，旧反馈不能继续降额或提前恢复，迟到限流仍尊重冷却 |
| 03 来源与长材料 | [#460](https://github.com/0-CHENAI/Selection/issues/460)、[#464](https://github.com/0-CHENAI/Selection/issues/464) | 实际获取内容冻结，目录 → 定位 → 原文读取 → 凭据；真实页码 / 单元格与解析限制 |
| 04 分层记忆 | [#471](https://github.com/0-CHENAI/Selection/issues/471) | 从现有压缩和日志展开原文，再填充受授权的项目共享检索；新会话不自动继承背景 |
| 05 执行解释 | [#465](https://github.com/0-CHENAI/Selection/issues/465) | 规范计划及事件派生视图、预检、影响预览和无副作用回放 |
| 06 联合验收 | [#466](https://github.com/0-CHENAI/Selection/issues/466) | 普通包九项联验、GPT-6-luna 真实独立审查与报告、同条件效果对照 |

先接通阶段的完整流程，再补必需内容。阶段测试通过、真实模型闭环、普通安装包及远端交付分别记录。未实现阶段保持开放，不将框架或历史通过记录当作整体完成。

## 当前实现入口

- `SessionManager.onRuntimeActivity` 是仅供宿主的可取消订阅。它位于有效代际的 agent 事件消费处，报告会话 / 根会话 / 运行身份、时间、事件种类与字节计数，不携带思考或工具正文，也不发给 renderer。管理器清理会释放订阅。
- `selection-pro-chat-acceptance.ts` 按本次根会话过滤活动，保留原有 600 秒空闲断言。失败时保存初始错误、最后活动和当时运行状态，然后清理；运行清理引发的取消不能替代初始失败原因。
- `LlmConnectionPool` 的 lease 捕获准入 epoch，额度变化后旧反馈只处理冷却和释放。新批次仍可以进一步降额，成功恢复保持现有阈值和容量上限。

## 2026-10-07 基线

核验基线 Selection `b364aaa84`、Misaka `c76f88a96`、ZCode `29628c9ac`。核心测试原为 521 通过 / 1 失败，失败 fixture 缺少 taskRunId；另 55 项超时 / 恢复测试通过。真实研究读取完成后，独立审查阶段因验收可见活动断言超时，报告未产生；不能单独据此判定后端死锁。

同批四个准入请求的两个限流反馈，整改前容量为 4 → 2 → 1。整改后保留现有保守降幅，同批为 4 → 2 → 2；只有新代际再限流才降为 1。确定性模拟与实际上游限流分开验收，不宣称性能收益。

## 首批修复与验证

- 研究创建入口发现 `conduct` 与聊天自动启用的 `judgmentVersion: 1` 不兼容。此时在持久化前要求作者改用 `orchestrate`，不静默改写已选 runner；普通 `conduct` 计划照常支持。回归覆盖研究协议、来源和权限范围、稳定创建与启动身份。
- 有效结构化提交后没有 assistant 结束语，不再被误判为空回复。完成判定查询当前 TaskRunner 的已验收成果，保留运行 / 会话 / generation 身份与 API 错误检查。真实 SessionManager + TaskRunner 回归覆盖有效成果、类型拒绝、过期代际和 provider 错误，状态分别为 done、failed、failed 和原有 retry-wait。
- 当前相关源码回归 599 项通过（50 文件、3394 断言），另有交接、任务协作、父会话交付和子会话的 153 项邻近回归通过（4 文件、774 断言），合计 752 项、0 失败；全工作区类型检查、lint 和服务端构建通过。lint 保留 8 项既存警告、0 错误；额外检查了 server-core 修改文件。
- GPT-6-luna 第一轮整改运行 `261007-prime-slate` 完成实际原文读取、4 项独立来源审查和 4 项前提审查，但报告因缺显式问题处置而受阻，静态 runner 又拒绝修补。已在中止重复查询前保存失败快照 `/tmp/selection-audit-research-conduct-blocker.json`。这是阻塞证据，不是闭环通过。
- 入口修复后的 `261007-true-beach` 仍失败：误判的原读取节点未修复，协调者自行新增的读取、独立审查、报告及质量核验节点均完成，但不能覆盖原失败事实。此失败快照由脚本先保存、再清理。
- 最新代码 GPT-6-luna 研究重跑 `261007-proud-sparrow` 完整通过（715850 ms）：3 节点 done、7 项原文读取凭据、4 项独立支持的结论、1 项当前前提审查、0 研究 blockers，最终报告保留 B 未核实和风险缺口。
- 最新代码 GPT-6-luna 并发重跑 `261007-eager-mountain` 完整通过（474664 ms）：5 节点 done，42 次真实请求取得 / 42 次释放、最终 active=0、并发峰值 3、统一根 owner。无人工计划改写或输出注入。
- 所有失败样本、通过样本和工具拒绝都保存在 [本批证据](../../../../scripts/fixtures/selection-3.0/pro-backend-remediation-acceptance.json)。研究维度的 covered 表示其约定问题有依据，并不表示现实风险已全面覆盖；最终报告明确现有风险资料的局限。普通安装包九项联验、受控三方效果对照与远端交付尚未完成；阶段 03–05 未实现内容继续留在相应 Issue。

## 复验入口

```sh
bun test ./packages/server-core/src/tasks/connection-pool.test.ts
bun test ./packages/server-core/src/tasks/chat-plan.test.ts ./packages/server-core/src/sessions/chat-plan.test.ts
bun test ./packages/server-core/src/sessions/empty-response-recovery.test.ts ./packages/server-core/src/supervision/session-progress.test.ts
bun run typecheck:all
bun run lint
bun run server:build
```

真实模型使用配置了 GPT-6-luna 的独立测试工作区运行 `bun scripts/selection-pro-chat-acceptance.ts --research` 和 `--concurrency`。前者验证原文读取、来源独立审查、限制和报告，后者验证真实请求槽位、并发峰值、统一根身份与释放。来源资料固定为 `scripts/fixtures/selection-3.0/costs.txt`；模型输出由实际工具提交，不在脚本预制计划或注入最终判定。
