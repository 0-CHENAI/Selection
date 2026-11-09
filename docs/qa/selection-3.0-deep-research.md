# #455 原生深度研究与独立审查验收

研究是 PRO 的显式可选配置。业务记录引用既有 run/node/attempt/revision、实际会话和成果 hash，不改变执行状态，不另建调度器。完整结论、原文与审查关联、计划日志、实际读取记录及 Handover 凭证保存在 [机器记录](selection-3.0-deep-research.json)。

## 实际入口

| 能力 | 入口与行为 |
| --- | --- |
| 原生 Skill | `apps/electron/resources/skills/deep-research/SKILL.md`；研究角色派发时引用现有原生 Skill 流程，实际成功读取了打包来源的 SKILL.md；并非另加一套研究工具 |
| 可选模板 | `research-template.ts` 的 addResearchTemplate；编辑器显式“添加深度研究模板”，保留原任务，追加研究、独立审查和报告节点；配置问题、前提、必答维度与资料路径。未选择时普通任务不产生研究节点、快照或 Skill 工作 |
| 输出契约 | `research.ts` 的严格 JSON 契约，沿用 submit_task_output 的 values.research；只提交本节点的新记录或异议更新，已有 evidence/claim/review 不重复提交。研究角色必须声明 required JSON research 输出，各项引用有校验 |
| 来源 | 启动时冻结授权任务目录内 UTF-8 原文、字节 hash、版本、获取时间和可读取快照；来源清单 hash 与启动凭证绑定。缺失、二进制、不可读或快照损坏保持不可核验，不能用 hash 替代真实支持 |
| 业务持久化 | 原子 node-finished 执行凭证携带最小业务记录；产出者来自真实运行身份，成果版本与独立 attempt 文件 hash 关联。读取时核对运行、节点、会话、角色、revision 与文件；损坏或缺失凭证阻塞交付。get_task_results 与结果 RPC 返回同一研究状态 |
| 独立审查 | reviewer 不复用产出者 actor 会话；记录具体 claim 版本、定位是否存在、语义支持和来源限制。实际审查者分别读取冻结原文。当前更高版本没有审查时显示待复核，旧审查不能批准它 |
| 异议 | 修正、补证、回应、限定、规范后续任务、带理由暂存；规范任务引用必须存在。新修订须指向同一受影响 claim 的更高版本。处置标签不能自行解决异议，修订获得独立支持才派生 resolved，限定/暂存保留限制 |
| 成果一致性 | reporter 引用当前支持版本；重要结论不可通过取消标记、移除必答维度或将事实改为推断规避审查。报告遗漏关键数值、使用旧版或未支持结论、未披露覆盖/未决缺口会被拒绝；用户报告由相同有效 claim 版本渲染 |
| 覆盖与 Handover | Workbench/Results 分别展示 covered/limited/uncovered 数量、原文、审查、异议与产出者；不拿完成率替代覆盖率。Handover 保留当前研究成果，复制原文快照，将未覆盖维度及未解决异议放入 openQuestions；新 NORM 不继承活动 worker |

问题、维度和来源不能通过 AI 提案或运行 patch 改写以降低原标准；用户可编辑定义后启动新 run。资料缺口补工作继续使用 #454 规范 patch；研究角色不盲目使用跨运行执行缓存。追加个别研究任务沿用规范 session 节点，而非 map/replica 聚合出的另一套业务身份。

## F5 实际模型执行

生产 SessionManager、TaskRunner；gpt-6-luna、pi-api-key-2、safe，固定 costs.txt（测试资料，不代表市场事实），hash `4c99133f5aba0554887a6e679c276035b86b13a6d88c6da6fbc4868c0a144fb6`。

成功运行 `f5-1791082135204 / run-1791082135233`，根 `261004-sunny-copper`。研究者故意注入 cost@1 的 100000 元；独立 review 会话 `261004-awake-bear` 成功读取原文并记录 contradicted、wrong-cost 与带理由暂存。在该 checkpoint 暂停、关闭两运行实例并从持久化会话/业务凭证重建后，实际 planner 追加 fix/review2，更新待执行 report 依赖，revision 1。fix 形成 cost@2；其尚未复核的状态被真实记录。第二独立会话 `261004-smooth-gust` 成功读取原文，支持 1000000 元的新版本；异议随后 resolved。报告只引用 cost@2，并明确税、B 口径和风险资料限制。最终执行 completed、structured PASS；研究 covered 1 / limited 0 / uncovered 1 / total 2。

实际 Handover `f5-handover-run-1791082135233` 已 applied，新 NORM `261004-jade-reed`；当前 cost@2 及其审查保留、风险明确作为未覆盖问题，原文复制到新背景中。没有为这次核验再调用研究模型。

```sh
F5_RECORD_PATH=/tmp/selection-version-3.0/455-f5-real.json bun scripts/selection-3.0-f5.ts
# 只核验既有真实执行及创建 Handover；不会重跑模型：
F5_RECOVER_RECORD=/tmp/selection-version-3.0/455-f5-real-attempt-2.json \
  F5_RECORD_PATH=/tmp/selection-version-3.0/455-f5-real-verified.json \
  bun scripts/selection-3.0-f5.ts
```

失败与重试如实保留：首次独立审查已识别矛盾，但验收驱动重建时未加载持久化会话元数据，发送失败，运行失败并保留。第二次真实运行 completed/PASS；模型两次不合法修订及一次不合法报告提交被拒绝后自行修正。末尾驱动因 EventSink 参数读取错误没有收集 tool_start，断言失败；修正驱动后从实际持久化工具记录独立核验成功 Read、来源和成果身份，完成实际 Handover，所有断言通过。机器记录区分真实运行完成与驱动断言失败，没有将首次失败算为成功。

## F5-c/d 与界面

确定性宿主回归覆盖打不开/缺失原文、无效行定位、仅部分支持、伪造产出者、来源快照变化、旧审查不能批准修订版、旧报告引用拒绝、假修订/不存在后续任务拒绝、重要性与必答维度保护，以及刷新后追加规范修正和复核。Handover 单元测试删除原运行的来源快照后，新 NORM 仍能读取独立复制的相同版本资料。普通单节点执行无研究目录、配置或 Skill。

界面为实际 TaskEditor/ResearchResults 的固定传输验收，与实际模型结果分开。模板保留 3 个原节点、追加 3 个研究节点，修改维度后 YAML 保留配置和输出契约，保存/创建/运行均为 0；Tab 从维度标识进入证据要求。宽屏 1200×850 和窄屏 375×700 显示当前结论、成本覆盖与风险缺口、异议修订关系、报告版本及限制。窄屏 documentWidth 375，研究区域 clientWidth/scrollWidth 均 309；“查看执行会话”回调正确指向独立 reviewer。截图已目视核对：[宽屏](selection-3.0-editor-images/455-research-wide.png)、[窄屏覆盖](selection-3.0-editor-images/455-research-narrow.png)、[窄屏异议与报告](selection-3.0-editor-images/455-research-narrow-issue.png)、[模板与配置](selection-3.0-editor-images/455-research-template.png)。浏览器翻译扩展边缘浮层不属于产品。

## 验证与范围

```sh
bun test packages/shared/src/tasks packages/server-core/src/tasks packages/server-core/src/sessions/handover.test.ts
bun test apps/electron/src/renderer/components/app-shell/kanban/__tests__
bun run typecheck:all
bun run lint
bun run lint:i18n:parity
bun run lint:i18n:sorted
bun run lint:i18n:coverage
bun run electron:build
git diff --check
```

任务与 Handover 综合定向回归 332 pass / 0 fail / 1377 assertions / 26 files；界面 92 pass / 0 fail / 319 assertions / 15 files。最终业务/运行/Handover 边界另检 22 pass / 0 fail / 154 assertions。八包类型检查通过，lint 无错误（既有 warnings）；2396 个 key 在七语言中一致，覆盖与排序通过。Electron 完整构建通过；原生 Skill 校验通过，打包副本与源文件 hash 一致。最后的冻结定义缺失守卫回归 12 pass / 0 fail / 68 assertions；shared/server-core 类型检查及 main 构建再通过。全仓 tracked tests、完整桌面端到端与配对成本比较由 #457 完成，不将定向通过称为全仓通过。

直接冻结可定位 UTF-8 资料。二进制或外部来源通过现有 Sources/原生工具预先准备可定位文本后配置到新运行；缺失来源只可明确有限交付。3.1 自动阅读凭据、自动来源包与完整阶段门留在 #449。当前独立审查来自新上下文和真实原文读取，hash 不构成真实性认证。历史 runner token 估计不用于总成本结论。

## 交给 #456

复用同一研究线、claim/version、执行产出者、source/version、审查及报告记录；语义关系和不同前提不得替代执行 DAG，也不能把不同前提平均。共享后续问题继续归属规范任务。当前“问题/前提/必答维度冻结”边界须通过显式多研究线扩展，保留每条线的标准与审查身份，不能原地改写旧线或旧报告。
