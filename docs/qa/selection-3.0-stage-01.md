# #450 阶段 01 验收

日期：2026-10-04（Asia/Shanghai）。基于 `test` 的 `9308ef00`，独立分支 `codex/issue-450-pro-execution`，目标集成分支 `version-3.0`。

## 交付

- 真实入口：`scripts/selection-3.0-f0.ts`，复用现有 `SessionManager` 和 `TaskRunner`，单节点 `conduct` 不启动 Swarm。
- 执行身份：运行快照携带 workspace；attempt 查询携带调度时 revision；成果查询带根会话、任务、执行会话、attempt 和计划版本。
- 统一已提交计划：成果查询与恢复均读取已提交 revision，忽略崩溃时可能遗留的未提交计划文件。
- 会话清理：释放 agent 后端，防止验收完成后遗留子进程；重复 cleanup 不重复释放，也不删除会话历史。
- 公共关系与下一阶段入口：`docs/plans/selection-3.0-execution.md`。

## 资料与真实流程

固定资料 `scripts/fixtures/selection-3.0/costs.txt` 的 SHA-256 为 `4c99133f5aba0554887a6e679c276035b86b13a6d88c6da6fbc4868c0a144fb6`。使用已配置连接 `pi-api-key-2`、原模型 `gpt-6-luna`、safe 权限，没有更换模型、复制凭据或写入授权。各会话隐藏保存，仅处理这份测试资料。

机读记录为 `selection-3.0-stage-01.json`，包含具体根会话、run、revision、attempt、执行会话、成果和普通/旧编排回归定位。运行日志确认实际调用 `Read` 和 `submit_task_output`。

| 固定案例 | 检查 | 结果 |
| --- | --- | --- |
| F0 输入→执行→成果→终态 | 真实 agent 读取资料，提交 `total_cost=1000000`、`unresolved=true` | completed；A 的成本正确，B 口径和风险缺口保留为未核实 |
| 同 run 重新加载 | 新建 TaskRunner，比较 workspace/task/run/revision/root、节点状态/session/attempt/历史以及输出；检查原日志 | 相同结果和状态，`node-spawned` 仍只有一次，日志不变 |
| 跨进程读取 | `--inspect <slug> <runId>`；检查历史快照、成果和日志 | 只读重载通过，未创建新 worker |
| 未记录终态中断 | `TaskRunner.test.ts` 的 crash/startup 扫描案例 | 未完成节点为 interrupted；扫描不调度、不假定完成；明确 continue 只重做未完成节点 |
| 普通会话回归 | 真实普通会话读取同一资料 | 返回 1,000,000 元及未决问题，没有创建任务图 |
| 已有编排回归 | 既有 v1 conduct，两节点显式依赖及 `${inputs.cost}` 输入 | 两节点都完成；下游从上游结果返回 1000000 |
| workspace 隔离/版本来源 | 成果单测使用另一个 workspace，模拟未提交 revision 文件以及异步创建期间的新 revision | 不混用成果；返回已提交计划及原 attempt 的调度版本 |

## 本地验证

```sh
bun test packages/server-core/src/sessions/cleanup-runtime.test.ts packages/server-core/src/tasks packages/shared/src/tasks/results.test.ts packages/server-core/src/handlers/rpc/tasks.startup.test.ts packages/server-core/src/handlers/rpc/tasks.proposal.test.ts
bun run typecheck:all
bun run lint
bun run electron:build
git diff --check
```

相关检查：185 tests 通过，0 failed；全仓库类型检查通过；lint 无错误（保留原有警告）；Electron 完整构建通过，最终宿主改动另复验 main 构建。

全量测试按仓库 tracked-test 顺序覆盖。首轮在 OfficeCLI 原生烟测处出现 `.NET System.Linq.Expressions, Version=10.0.0.0` 加载失败；原测试单项复验及整文件复验均通过（27 tests），无需改动 OfficeCLI。继续执行其后的 92 个普通测试文件全部通过；5 个 isolated 文件按仓库脚本使用绝对路径执行也全部通过。首轮命令曾失败，分段复验后全部测试文件覆盖通过，另有新增 cleanup 回归通过。

## 已知边界

本阶段成果是有结构化值的节点报告；文件产出、版本/hash 与隔离集成沿用既有路径及测试，没有新建成果体系。F0 不做独立研究质量审查，审查与研究记录属于 #455。真实流程使用已配置的模型；离线恢复正确性由确定性测试及只读重载共同验证。

#451 的平面 Task List 上游为 #337；#453 的完整编辑/布局上游为 #320/#321。用户已将这三条一并纳入本轮，采用各自独立分支实现并合并至 `version-3.0`，不在 #450 复制实现。
