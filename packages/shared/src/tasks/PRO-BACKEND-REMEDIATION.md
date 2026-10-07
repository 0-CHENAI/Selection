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

## 第二批实现与验证（2026-10-07）

按阶段 03 → 04 → 05 接通入口，再填充当前验收所需内容。代码、本地验证、真实模型闭环和远端交付分开记录。

| Issue | 实现入口与本批证据 | 尚待收尾 |
| --- | --- | --- |
| [#460](https://github.com/0-CHENAI/Selection/issues/460) | 原生 `web_fetch` 将成功获取的实际字节、确定性提取文本、来源版本和返回行范围冻结；`source-snapshot` → `freezeResearchSources` → 现有读取凭据 / 来源包。失败、索引和搜索摘要不能登记原文查阅。沿用既有精确版本勘误、审查失效与报告约束。 | 新格式与网页输入的 GPT-6-luna 勘误、重新独立审查及最终报告闭环。 |
| [#464](https://github.com/0-CHENAI/Selection/issues/464) | `document_index` → `document_read` 接通目录、定位、原文返回及字面引文核验；真实 20 页 PDF 的第 17 页、XLSX `Costs!B2`、DOCX 第 204 段、PPTX 第 2 张均定位到 1000000。文件 hash 变化使旧索引失效，冻结研究输入保持原字节。原生 Office / PDF Skills 保留，安全模式可读取完整 OfficeCLI 原生指南。 | 解析只覆盖结构 / 文本；OCR、图表、版面和公式重算继续使用原生 Skills，不作为索引已验证内容。 |
| [#471](https://github.com/0-CHENAI/Selection/issues/471) | `session_history` 从当前 JSONL 分支派生层级摘要、版本、parent / child 和原文展开；原文变化使祖先摘要版本失效。项目设置显式授权后，`project_history` 仅按明确查询检索本项目并按精确消息版本展开，排除兄弟执行上下文；源变更、删除和撤权立即生效。无第二份记忆数据库，无新会话自动背景注入。 | GPT-6-luna worker 按需项目历史回查；根节点实际查询与展开已发生，不能替代 worker 验收。 |
| [#465](https://github.com/0-CHENAI/Selection/issues/465) | 同一规范计划派生任务 / 数据 / 控制 / actor / 研究五视图，复用既有校验、权限模式和原子 revision；影响预览覆盖修订前后依赖及下游。新的只读 `inspectTaskRun` RPC 直接读取已提交事件和精确 revision，不创建 TaskRunner。 | 普通安装包联验仍归 #466；缺精确历史快照时显示限制，不借当前可变计划补造历史。 |

最终源码回归 **1039 通过 / 0 失败**（130 文件、5021 断言、45.58 秒）；全工作区类型检查、lint、i18n parity、renderer 构建、独立服务端构建均通过。lint 的既存警告和 renderer 的既存大块提示保留。服务端包的交接 / 项目历史 / 回放模块实际导入通过；桌面资源与服务端包均复制最后生产构建的原生工具，三份 bundle hash 一致。独立服务端补齐了项目历史依赖的 Pi 源码助手及原生 bundle 打包。

真实 GPT-6-luna 运行 `261007-ready-opal` 的根节点完成 2 次项目历史工具操作、6 次文档索引、27 次文档原文读取和 1 次实际网页获取，冻结 PDF、XLSX、DOCX 和网页内容。随后研究 worker 及重试 worker 收到 `network_error / Connection error`，运行暂停，718903 ms。第二次运行 `261007-still-lagoon` 同样连接失败，未建立规范计划。失败快照在清理前保存；研究 worker 查阅凭据为 0，不能把根节点的成功读取当作独立审查，也不能把本轮标为完整通过。

对 `ready-opal` 的实际已提交 38 条事件进行只读回放：r0 → r1 的真实修订及影响可见，五视图保留相同规范节点；400 个工作区文件的 hash 前后完全相同，根节点工具调用记录保持 61 → 61，新读取进程重启后结果一致。独立 RPC 测试另验证管理器尚未初始化时也能只读查询，模型 / 创建会话调用计数为 0。浅色与深色 UI 验证覆盖视图、历史游标及返回实时；该 UI 使用展示 fixture，不冒充真实后端 / 模型证据。

证据：[结构化记录](../../../../scripts/fixtures/selection-3.1/backend-batch2-acceptance.json)、[浅色界面](../../../../scripts/fixtures/selection-3.1/backend-batch2-light.png)、[深色界面](../../../../scripts/fixtures/selection-3.1/backend-batch2-dark.png)。GitHub API 当前返回 EOF，故远端证据回填和 Issue 关闭尚未执行。网络恢复后继续上述真实模型收尾，再按完成条件更新 Issue；普通包九项联验与受控三方对照继续保留在 #466。

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

第二批使用 `create-documents.py /tmp/selection-batch2-originals` 生成真实格式输入（需要 python-docx、openpyxl、reportlab 和 python-pptx），再在隔离的已配置测试工作区运行 `bun scripts/selection-pro-chat-acceptance.ts --batch2`。项目历史口径消息是明确标识的验收输入；规范计划、勘误、审查和报告均须由实际模型工具提交。确定性格式、层级历史和回放验证分别见 `documents.test.ts`、`history-tree.test.ts`、`project-history.test.ts`、`replay.test.ts` 和 `tasks.replay.test.ts`。
