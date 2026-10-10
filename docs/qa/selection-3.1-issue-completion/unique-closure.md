# #466 / #468 / #449 唯一工作包与联合证据

验收基准：`test` 的 `4fb3aef546fd77bfb01f7af53582d7806974b88a`，文件树与普通包 14 的源码 HEAD `800b40caa` 一致。旧对照为 `f9e515235bf48a06e8dc25a540b42ec9fae45be5` 普通包。全部模型运行使用 GPT-6-luna、创建即 `allow-all`，通过普通桌面宿主 RPC 发送自然语言目标；不预写 YAML、不补成果或判定、不启用开发功能开关。

## 工作归属

| Issue | 唯一工作 | 完成凭据 |
| --- | --- | --- |
| #466 | 最小普通包结构化纠错闭环、旧 PRO / 当前 PRO / NORM 同输入功能对照 | 新运行记录、同输入 hash / 目标 hash、脚本断言、实际父节点交付 |
| #468 | 增量整改 01–05 的原归属、实现、回归与边界映射；06 只引用 #466 | 下方整改映射和定向证据索引；不再复制联合案例 |
| #449 | 九项能力的总验收与发布边界 | 下方能力矩阵、#466 结果、#468 映射、test / CI 交付状态 |

经用户要求，原六份材料 G7 改为一份五行文本的最小联合案例。已经停止或失败的 G7 记录仍保留、不计成功。长资料、并发、求助、恢复和回放复用已完成的专项证据。三种方案的工具数量、用时是这个案例的观测值；模型非确定性、共享上游及并行运行不支持普遍性能结论。

## #468 整改映射

| 阶段 | 原归属 | test 中入口与证据 | 证明边界 |
| --- | --- | --- | --- |
| 01 可靠观测、失败留证 | #469 / #459 | `SessionManager.onRuntimeActivity`；`PRO-BACKEND-REMEDIATION.md`；`pro-backend-remediation-acceptance.json`；本次最小普通包运行 | 真实进展续租；失败、人工停止与网络错误分开，不将静止心跳算进展 |
| 02 并发反馈代际 | #470 / #461 | `connection-pool.ts` / `connection-pool.test.ts`；`pro-request-concurrency-a8-acceptance.json` | 同批重复 429 的确定性回归与真实请求峰值分开；不声称遇到真实 429 的模型样本 |
| 03 原文来源与长材料 | #460 / #464 | `backend-batch2-acceptance.json`；`worker-documents-pro.json`；`native-source-acquisition.json` | PDF 页 17、DOCX 段 204、XLSX Costs!B2、PPTX slide 2；文本 / 结构入口不等于 OCR、版面、图表或公式重算 |
| 04 分层记忆与项目检索 | #471 | `session-history` / `project-history`；`backend-batch2-acceptance.json` 的实际根和 worker 检索记录 | 显式项目授权、精确版本回查、排除兄弟上下文；历史哈希修复前的差异保留为限制 |
| 05 执行解释 | #465 | `replay.ts` / `dependency-impact.ts`；`backend-batch2-acceptance.json` 的 194 事件只读回放；`history-replay.json` | 五视图由同一计划派生；562 文件 hash、305 工具调用不变；普通包回放未新增模型调用 |
| 06 联合验证 | #466 | 仅引用本轮最小案例结果 | 不另建整改流程或重复整包案例 |

## #449 九项能力矩阵

| 能力 | 原阶段 | 已交付专项证据 | 本轮联合证明 / 限制 |
| --- | --- | --- | --- |
| 1 原文查阅与来源包 | #460 | A1；第二批 71 真实读取回执；四格式普通包 | 最小结构化研究的真实读取与来源包 |
| 2 证伪条件 | #462 | `pro-research-judgment-b2-b4-acceptance.json` | 最小案例保留当前关键结论的证伪条件；不同前提候选复用专项 |
| 3 精确勘误与传播 | #460 | `pro-research-a3-acceptance.json`；第二批 a-cost@1 → @2 | 本轮精确旧版本、勘误、修订与新独立审查 |
| 4 阶段门与局部汇合 | #462 | B2/B4 的阶段门；`research-judgment.test.ts` | 本轮当前研究阶段可交付；多线局部汇合复用专项 |
| 5 长资料索引与原文核验 | #464 | 普通包 `worker-documents-pro.json`、冻结采集凭据 | 不重复四格式大案例；独立原件语义读取由最小案例验证 |
| 6 规范计划五视图 | #465 | 第二批回放 task/data/control/actor/research 与 UI | 不因五视图存在就宣称所有布局已完整视觉验收 |
| 7 预检、影响与只读回放 | #465 | 第二批 r0 → r5；普通包 `history-replay.json` | 当前普通包 RPC 缺省游标已修复并实测 |
| 8 请求级公平并发 | #461 / #470 | A8 实际 52 次准入/释放、峰值 3；同批代际回归 | 本轮串行纠错流程不重复压测，不作吞吐优势推断 |
| 9 求助与恢复身份 | #463 | B9 原上下文继续；TaskRunner.help 重启 / 迟到回答回归 | 不在最小文本中人为制造求助；已有实际与确定性证据复用 |

所有原阶段 #459–#465、增量阶段 #469–#471 已 CLOSED，代码与证据已经 PR #472 和 #473 交付；原 Issue 中“仅本地 / 尚未实现”的日期快照不代表当前状态。历史资料保留原测试模型、权限和运行方式，不将 headless 或 safe 的旧样本改称当前普通包 / allow-all。

## 异常边界的定向证据

- 精确 claim/source 版本失效与旧报告传播：`research-errata.test.ts`、A3；不覆盖旧记录。
- 重复请求与并发修订：`TaskRunner.dynamic.test.ts`、`research-lines.test.ts` 和 `connection-pool.test.ts`；旧准入反馈不能重复降额。
- 未知副作用、只读恢复边界：`execution-recovery.test.ts`、`execution-checkpoint.test.ts`；未知写入不自动重放。
- 求助恢复、旧上下文与迟到答复：`TaskRunner.help.test.ts`；保留完成兄弟节点，丢失 waiter 用新 attempt 恢复。
- 本轮复验：研究勘误、阶段门、回放、连接池与求助共 **50 tests / 290 assertions / 0 fail**（含导入的相邻测试，10 文件）；另对动态修订、共享研究注册和未知副作用恢复复验 **116 tests / 830 assertions / 0 fail**（8 文件，含导入的相邻测试）。两批不累加为不重复测试总数；既有更完整回归与远端 CI 直接复用。

## 远端交付

PR #473 已合入 `test`：`4fb3aef546fd77bfb01f7af53582d7806974b88a`。合并后 [Validate 37967764110](https://github.com/0-CHENAI/Selection/actions/runs/37967764110) 和 [桌面安装包 37967764042](https://github.com/0-CHENAI/Selection/actions/runs/37967764042) 均 success。本轮新增观测脚本和证据的提交 / PR 单独记录，不借用产品旧 CI 证明新脚本已交付。

复跑：`bun scripts/selection-pro-structured-minimal-acceptance.ts <普通包配置目录> <新的空资料目录> <current|baseline|norm> <PRO|NORM>`。脚本不会覆盖旧原件，记录实际模式、权限、hash、独立上下文、原生输出和断言；旧基线失败保留为对照结果。当前 PRO 与 NORM 必须通过对应断言。

## 本轮联合案例结果：尚未满足收口门槛

`unique-comparison.json` 保留三组同输入 / 同规范化目标的观测。模型生成的五阶段计划仍比两节点功能检查复杂；这些数字不支持速度或普遍性能优势结论。

| 样本 | 实际模式 / 权限 | 结果 | 工具 / worker | 证明范围 |
| --- | --- | --- | --- | --- |
| 旧 PRO，f9e515235 | PRO / allow-all | 外部停止；未交付最终报告 | 115 / 12（含重试） | 复现相同 continue 已接受后仍误报人工暂停；停止不计为自然失败 |
| 当前 PRO，4fb3aef54 首次运行 | PRO / allow-all | blocked-awaiting-help | 69 / 5 | 旧结论、原文查错和 v2 勘误已登记；新版审查与报告未完成 |
| 当前 NORM | NORM / allow-all | 直接交付通过，无 DAG | 3 / 0 | 亲读同一原文，金额、B 口径和风险限制正确；没有派出子代理 |

当前 PRO 首次失败之后，另发过两条自然语言续跑提示、重启宿主一次；没有人工修改计划、输出或 verdict。恢复观察仍为 interrupted，独立复核与报告未完成；随后取消诊断协调回合，保留原运行。**不能把首次失败、人工恢复提示或两节点功能通过替换成五阶段无介入验收成功。#466 仍待完整交付；#468 的 06 和 #449 的发布判断引用这个结果，保持 OPEN。**

## 从失败观测修复的两个后端缺口

代码提交 `99061987f`：重复的相同持久化 continue 返回 `alreadyApplied`，不重跑节点、不消费新结果门；新检查点存在时 SDK 保留当前回合。冲突请求、外部身份、人工暂停仍拒绝。求助等待期间 claim/source 版本更新时，旧答复不采纳，原 waiter 退出过期等待并自行刷新规范版本。

- `continue-minimal.json`：普通包、GPT-6-luna、PRO / allow-all，两节点独立原文读取、verify PASS、父节点交付 completed；154604 ms，原件 hash 不变，没有人工计划、输出或 verdict。
- `continue-replay.json`：模型原样重放已接受请求，回执 `alreadyApplied=true`；运行日志前后 SHA-256 同为 `0f94710dcfe99f712fb4b8af39a0ad514f11d5c4f719727fa639e98c1aee4df6`。首次采集的脚本在断言和证据落盘后调用不存在的 disconnect 清理方法；修正为 destroy，该清理错误不计为产品错误，也不称脚本零退出通过。
- 最新源代码定向复验：71 tests / 577 assertions；扩展 Conductor 恢复回归 280 tests / 1483 assertions；均 0 fail。远端最初 CI 指出旧测试仍要求相同回执报错，以及 Windows 两次读取实时指标相差 1 ms；分别对齐契约和固定测试时钟，不放宽产品校验。

## NORM / PRO 显示与权限分开验证

用户截图对应 `261010-nimble-rainbow` 的后端始终为 PRO / allow-all，界面却是 NORM / 询问修改。流式事件先创建临时会话，完整加载只补正文而漏掉执行身份；`ddc5b8481` 补齐缺失模式、所有权及待审标记，同时保留更新事件和乐观 UI 状态。

- [修复前](mode-before.png)、[修复后](mode-after.png)、[真实 NORM](mode-norm.png)，元数据与普通包身份见 `mode-display.json`。修复后顶部 PRO、交接目标 NORM、输入区 PRO 与后端一致；模式切换不会改变既有会话执行身份。
- `norm-boundary.json`：在普通包创建 NORM / allow-all，故意请求 Swarm、PRO 子会话和 DAG；子会话与 DAG 均被宿主拒绝，swarm=false、0 新 worker、0 新 run。前端 NORM 无编排入口。这不是仅隐藏按钮。
- 22 tests / 165 assertions 覆盖临时会话 NORM/PRO 补齐、请求期间较新模式事件、原有 NORM 的工具 / RPC / 自动及显式 spawn 拦截；0 fail。typecheck:all、lint、普通构建、arm64 目录包通过；Impeccable 检测无结果。

本轮 PR：[#475](https://github.com/0-CHENAI/Selection/pull/475)。合并与新 CI 状态需以该 PR 和对应 test 提交为准，不能借用 #473 的成功替代。
