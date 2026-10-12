# #457：Selection 3.0 整体验收与 #448 本地汇总

2026-10-04，基于更新后的 test 基线 `9308ef00ed9801cddfec7ae7ec1f848a3d1f4f10`。#450—#457 与明确纳入的 #337/#320/#321 都在同一执行框架中交付。本文是 #448 的本地交付汇总；没有写入 GitHub、推送、创建 PR 或关闭 Issue。#449 的九项 3.1 增强未纳入。

## F0—F7 与上游验收

| 组 | 结果 | 可核对证据 |
| --- | --- | --- |
| F0 / #450 框架 | 同 run/node/attempt/revision 的产出与只读重载，不重跑 worker | [阶段 01](selection-3.0-stage-01.md)、[模式复验](selection-3.0-session-modes.md) |
| F1 / #451 模式 | NORM 委派及 DAG 能力由宿主拒绝；PRO 执行根明确，模型和权限不提升 | [模式](selection-3.0-session-modes.md)，本阶段实际历史普通 / PRO / reviewer / 无根 worker 桌面检查 |
| F2 / #452 交接 | 重复请求只有单目标，源历史与快照独立；活动源等待、落盘中断可恢复 | [交接](selection-3.0-handover.md)，本阶段实际双击、刷新与退出重启 |
| F3 / #453 规范计划 | 引用依赖与图 / 执行一致，锁、过期补丁和落盘故障整体保护 | [规范计划](selection-3.0-canonical-plan.md)，F7 原子追加研究与 revision 3 恢复 |
| F4 / #454 动态执行 | 结果消费去重、actor 串行、worker 身份、受影响后继及未知外部操作边界有效 | [动态执行](selection-3.0-dynamic-execution.md)，本阶段全量回归覆盖迟到事件、替换、缓存和故障边界 |
| F5 / #455 单线研究 | 错误关键值经独立原文审查后修订，旧审查不能支持新版本，风险仍未覆盖 | [深度研究](selection-3.0-deep-research.md)，F7 的 cost@1 → cost@2 |
| F6 / #456 多前提 | 高 / 低利用率竞争条件、明确共享电价问题、条件式推荐及受影响后继 | [多线研究](selection-3.0-research-lines.md)，此前失败样本和实际开销保留 |
| F7 / #457 完整产品流程 | 真实 NORM → 同背景的新 PRO → 动态补研究 / 审查 → 当前报告 → 新 NORM；暂停、重启和局部重试后通过 | 本文、[机器记录](selection-3.0-integrated-acceptance.json)、实际桌面截图 |
| #337 Task List | 普通会话原生清单，多轮修订 / 刷新；不自动启动复杂流水线 | [Task List](selection-3.0-task-list.md)，F7 初始 NORM 实际使用 |
| #320 多轮编辑 | 最新人工草稿、稳定节点差异与提案身份；应用不保存 / 不运行 | [多轮编辑](selection-3.0-conversation.md)，本阶段回归 |
| #321 编辑器布局 | 定义 / 图 / YAML / 子界面、固定操作区和窄面板 | [布局](selection-3.0-editor-layout.md)，本阶段实际 900×700 专注窗口、长内容和控制操作 |

以上组的确定性测试在本阶段完整测试中复验；F0—F6 的真实模型凭证沿用各阶段已提交的实际记录，F7 新增真实桌面全程。退出重启与注入崩溃故障分开记录，不把正常退出当成强制崩溃。

## 真实桌面 F7

固定资料为 `scripts/fixtures/selection-3.0/costs.txt`，SHA-256 `4c99133f5aba0554887a6e679c276035b86b13a6d88c6da6fbc4868c0a144fb6`。模型 `gpt-6-luna`，连接 `pi-api-key-2`，原权限 `safe`；只分析两年成本与风险，不部署，不写外部服务。合成资料不代表市场事实。

1. NORM `261004-light-poplar` 实际读取资料、记录 Task List，没有任务绑定或 worker。重复点击交接创建一个 PRO `261004-clever-laurel`，Handover `2ff53c66-bc5d-42e4-aab6-bdc2a9343b77`。刷新及正常退出重启保留交接输入，不自动执行。
2. 在该 PRO 的标题入口显式新建编排，绑定原根而不再创建另一会话。创建不运行；之后实际点击“保存并运行”，slug `f7-desktop-research`，run `run-1791087470605`，启动 revision 0。
3. cost 注入 100000 元的待审查错误；独立 reviewer 实际 Read 同一原文，否定 cost@1。risk 第一次提交重复 e-cost / 未知 claim 被宿主拒绝，没有成为有效依据。模型暂停在 seq 25；实际退出重启保留原 log、revision、三次派生身份，没有额外派生。
4. 人工通过桌面发送恢复标记、明确恢复后，根原子追加 fix / review2 / basis / basis-review。A 的同一 claim 修订为 cost@2 = 1000000 元，新的 reviewer 再次实际 Read；B 口径 b-basis@1 也独立读取并审查。根 goal / acceptance / constraints / decisions 及人工锁定 risk 节点保持原值。
5. 无效 risk 阻塞实际运行；人工“局部重跑”仅重置 risk 与 report，保留六个成功节点。根额外建立的 risk-retry 又重复 e-risk，被拒绝。报告依赖改回成功的原 risk。人工暂停时让正在执行的报告结算，再进入 paused。
6. revision 3 的实际第二次退出重启，state/log/results 联合 hash 前后都是 `0eb704fc97bf7876bb670f5469ebb988749cac2199027c0e9732296746ab2d58`；当前报告仍引用 cost@2 与 b-basis@1，没有新 worker。未结算的无效 risk-retry 使 PASS 被拒绝。人工局部重跑仅该节点；revision 4 提示沿用现有 e-risk、提交空研究结构与缺口说明，第二次尝试成功。
7. 实际最终 PASS，9/9 当前节点完成，cost@2 与 b-basis@1 均有不同生产会话的独立支持；wrong-cost 已关联新版本和修正任务并 resolved。成本 covered 1/2、风险 uncovered 1/2，blockers 空。有限结论明确税口径未给出、B 暂不可直接比较、风险资料缺失；没有无依据总体推荐。
8. 完成后通过原生“基于成果继续聊”创建 NORM `261004-young-laurel`，Handover `c4194fbc-bdf7-49b8-b812-6ba7c29385da`。目标没有 taskSlug、父会话或 worker，原模型 / safe 权限保留；实际读交接成果后准确回答 revision 4、cost@2 与 b-basis@1，旧 cost@1 不能当事实。没有重放源 run。

F7 在集成修复过程中运行，核心基于 `0d2e8d665`，不能宣称其执行字节等于后续冻结的最终配对提交。机器记录保留全部运行日志、失败工具、精确 claim / review 凭证与恢复 hash；交接大段重复文本保留摘要、长度与 SHA-256，完整原始快照可由只读检查器重新导出。

### 实际失败与人工介入

不能把最终通过说成一次自动成功。原 risk 无效、额外 risk-retry 无效、两次 run-failed、重复 / 过期 coordinator 决定、锁定节点修改、未结算时提交 PASS 均在日志中保留。部分 worker 还尝试了无 verifying run 的 verdict，由宿主拒绝。新 NORM 曾尝试 safe 下不允许的 Bash 读取，被拒绝后改用 Read 完成交付；这次失败也计入全程 usage。

人工介入包括启动、恢复标记、两次明确恢复、两次局部重试，以及提示只修复剩余节点。成功节点没有因局部重试重新执行；原失败尝试仍可展开回查。F7 因有限事实通过，不代表风险已覆盖或总体推荐已支持。

SDK assistant 调用去重汇总包含初始 NORM、planner、全部 worker / reviewer / 重试与最终 NORM：108 次调用，input 4,612,820、cache-read 1,451,008、output 16,264、reasoning 928，无缺失 usage。run 壁钟 19 分 39.355 秒；初始用户输入至最终 NORM 交付 41 分 13.722 秒，含人工等待、重启和集成检查。TaskRunner 节点 token 不是上述全程口径。连接返回的 cost=0 未提供可靠价格，标为未定价，不能解释为免费。

## 真实桌面交互与发布阻塞修复

| 实际触发的问题 | 所属模块与修复 | 复验 |
| --- | --- | --- |
| 交接 PRO 没有可用的新建编排入口，顶部入口另建根丢失背景 | #451/#453：显式 rootSessionId 创建；宿主检查 PRO 所有权、工作区、活动会话与外部操作，绑定不执行 | F7 同根创建；四项真实 SessionManager/RPC 测试含落盘中断与失败重试 |
| browser 没有 process 全局，构建 flag=1 仍关闭动态编排 | #454：静态环境变量访问供打包替换，默认 / 显式 0 仍关闭 | 四项真实 esbuild browser bundle 检查与 actual preview run |
| 刷新 / 退出后编辑目标丢失，打开空创建页 | #453：只存带工作区的编辑目标身份，恢复 PRO；新建、打开与取消清理目标并保留未保存确认 | 实际刷新和正常退出重启；跨工作区拒绝测试。未保存正文仍仅在当前 renderer 保留 |
| 等待 coordinator / 审批时没有暂停按钮；成功后残留旧阻塞 | #454：复用现有状态允许暂停；当前快照隐藏已恢复节点的 lastFailure，原历史保留 | F7 与零调用控制计划实际暂停 / 恢复 / 停止；重试回归及完成后编辑器检查 |
| 被拒绝的 run 内部记账误判为未知外部操作，阻塞最终 NORM | #452：精确工具名排除源 run 记账；原记录仍保留，真实 Write / 外部工具及相似名称仍待核对 | 修复前目标 `261004-copper-panther` 的旧快照保持不变；新快照 unknown=0，实际最终 NORM 读取成功；15 个 alias / pending 样本回归 |
| Markdown craftagents 链接误当文件；新专注窗口早期路由被覆盖 | #451/#452：复用原 URL 安全 / 深链接路由；将明确目标放入窗口启动 URL，等待元数据就绪恢复 | fresh window 的 URL 明确 broad-topaz，模式 PRO；reviewer 分组与无根 worker 隔离实测 |
| 窄面板标题压入右侧操作区 | #321：标题 grid 给两侧实际内容保留最小宽度，标题缩短 | 原标题测试 7 项通过；900×700 有 / 无侧栏最终截图实测 |

历史合成普通 `261004-fit-swan` → NORM；旧 taskDraft 根 `261004-broad-topaz` → PRO；reviewer `261004-clever-sand` 归入该根执行组；无根 `261004-copper-raven` → NORM / 归属待核对，不能新增委派。原模型和权限保留。长历史 24 段 / 3757 字符可滚动到末尾。模式切换在同一 renderer 保留各自未发送草稿，没有自动发送。

控制计划 `desktop-control` / 根 `261004-silent-eddy` / run `run-1791089461014`：创建后尚未运行；显式启动 → 等待审批 → 暂停 → 恢复原审批检查点 → 停止。两个节点 cancelled，run stopped，node-spawned=0、模型调用=0。它没有批准下游来模拟成功。

## 真实模型同条件对照

旧版固定 SHA `9308ef00ed9801cddfec7ae7ec1f848a3d1f4f10`；3.0 冻结实现 SHA `504f04a105a356f0fbc7136b11769a68a681fa92`。三类任务的 prompt、固定资料路径 / hash、`gpt-6-luna` / low / safe、禁止写入 / 部署 / 委派条件完全相同。允许的共同工具是 Read、session_history、submit_answer。旧版实际完成其普通会话流程；运行、独立 reviewer、规范异议与缓存后继机制在这个共同 NORM 对照中为不适用。

最终配对结果与逐轮去重 usage 见机器记录的 frozenPair；早期 3.0 pilot 也完整保留为额外样本，不能伪称冻结版本。模型目录 /系统工具开销会随版本不同，旧版 catalog 55 项、3.0 35 项；两者这三项任务实际使用相同只读工具。工具目录大小是版本差异，不是权限提升。

| 任务 | 旧版 秒 / 调用 / input / cache-read / output | 冻结 3.0 秒 / 调用 / input / cache-read / output | 正确交付 |
| --- | --- | --- | --- |
| 简单阅读 | 9.228 / 3 / 41,761 / 0 / 167 | 9.145 / 3 / 37,605 / 0 / 156 | 双方各 1/1 |
| 双维比较（有限结论） | 10.815 / 3 / 41,850 / 0 / 297 | 12.975 / 3 / 37,696 / 0 / 335 | 双方各 1/1 |
| 错误修订（两轮） | 17.596 / 6 / 44,814 / 39,936 / 351 | 18.607 / 6 / 30,910 / 45,568 / 347 | 双方各 1/1 |

冻结配对双方各 3/3 正确交付；早期 3.0 pilot 另 3/3。全部九个普通样本无工具失败或会话错误，实际读取正文 hash 相同。人工错误注入轮是明确未核验的测试输入，不算已确认事实。调用、input / cache-read / output 按 session + startedAt 的 turn 去重，避免流式 usage 更新重复累加。

正确交付的判定：简单阅读给出 1000000 元 / 100 万元及第 3 行；双维比较明确 B 成本口径和风险都不足以支持总体推荐；错误修订否定人工注入的 100000 元并独立读取原文改为 1000000 元，说明 B 与风险缺口。普通对照中的“独立读取”不是正式的独立 reviewer。

覆盖分母按任务约定：简单事实 1/1；双维 A/B 总体比较 0/2 足以作比较结论，有限事实可支持但不能算完整比较；修订金额 1/1，B 与风险仍缺。小样本只说明本次交付观察，不能证明普遍速度、成本或研究质量优势。F7 与 F5/F6 的正式研究记录采用其独立审查 / 覆盖口径。

## 验证、恢复与收尾

| 命令 / 操作 | 结果 |
| --- | --- |
| `bun run test` | 7590 pass、0 fail，含新的 root-create、Handover 与 Markdown 回归 |
| `bun run typecheck:all` | 八个包 / 应用通过 |
| `bun run lint` | 0 error；既有 electron 86、shared 8 warnings |
| i18n parity / sorted / coverage | 2415 keys，通过 |
| `bun run electron:build` | 默认完整 main / preload / renderer / resources / assets 构建通过；默认技术预览关闭 |
| 显式 preview 全构建 + 最终 renderer 构建 | 通过；用于真实桌面 F7 与深链接 / 标题栏复验 |
| 最后变化的定向检查 | header 7、deep-link routing 3、root-create / Handover / Markdown 57 pass；0 fail |
| `git diff --check` | 通过 |

早期完整检查遇到三个基线测试问题，已定位并复验：fs.watch 用固定 300ms 等待在负载下丢失观察窗口，改为有上限的条件等待；IPC 快照补入已实现的 tasks:patchRun；durability 故障注入改为阻止唯一临时文件的最终 rename，仍验证实际落盘失败、回滚与成功重试。没有为通过测试减弱生产持久化逻辑。一次合成历史 fixture 把持久消息的 type 写成 role，导致不可渲染；修正 fixture 后重新验收，不算生产缺陷。

实际桌面正常退出重启验证交接、编辑目标、矛盾审查暂停与 revision 3 当前报告。注入崩溃 / 落盘边界由现有确定性测试覆盖：交接创建 / 应用、规范 revision、planner 消费、替换执行、证据 / claim 版本、成果交付与未知外部操作；具体故障断言在 F2/F3/F4/F5/F6 文档与当前全量结果中可查。没有向外部系统真实写入来制造副作用。

验收结束恢复原全局 DAG=false / Swarm=false，停止本次 Vite / Electron 进程并关闭 Ego 验收空间；基线 worktree 归档可恢复。原运行、失败尝试及本地 QA 资料仍保留。当前已发现的身份 / 版本 / 权限 / 旧成果发布阻塞均已修复并复验；资料缺失、模型无效尝试、人工恢复与高 planner 上下文开销是如实披露的限制。

## 桌面截图

- [初始 NORM 阅读](selection-3.0-desktop-images/457-norm-reading.jpg)、[交接 PRO](selection-3.0-desktop-images/457-handover-pro.jpg)、[矛盾后暂停](selection-3.0-desktop-images/457-paused-contradiction.jpg)。
- [两种模式草稿](selection-3.0-desktop-images/457-mode-drafts.jpg)、[实际完成根与历史尝试](selection-3.0-desktop-images/457-completed-root.jpg)、[最终 NORM 当前报告](selection-3.0-desktop-images/457-norm-report-small.jpg)。
- [专注窗口长内容修复前布局](selection-3.0-desktop-images/457-focused-pro-long.jpg)、[最终窄面板标题](selection-3.0-desktop-images/457-focused-header-fixed.jpg)、[reviewer 分组](selection-3.0-desktop-images/457-reviewer-group.jpg)、[无根 worker 隔离](selection-3.0-desktop-images/457-orphan-readonly.jpg)。
- [人工停止及两个 cancelled 节点](selection-3.0-desktop-images/457-control-stopped.jpg)、[完成后编辑器无旧阻塞](selection-3.0-desktop-images/457-completed-editor.jpg)。

## 重现入口

`scripts/selection-3.0-desktop-fixture.ts` 在本地创建合成工作区与历史样本，既有记录重复运行不新增；运行前使用自己的同等模型连接。`scripts/selection-3.0-f7-plan.ts` 从已应用的真实 Handover 用 `F7_HANDOVER_ID` 准备 YAML，不启动任务；在桌面创建 / 保存并运行及交接。`scripts/selection-3.0-integrated-inspect.ts` 只读导出实际 run / claim / reviewer / usage，不创建 SessionManager 或取得运行所有权。普通配对用 `scripts/selection-3.0-paired.ts` 的 PAIR_FIXTURE / PAIR_LABEL / PAIR_SHA / PAIR_RECORD 指定各冻结版本，禁止在已有活动任务的实例上混跑。
