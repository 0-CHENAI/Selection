# Issue #288：V3 人机协同工作流验收

日期：2026-09-07。基线：最新 `origin/test`（含 #287/#290/#291/#292）；实现分支：`codex/issue-288-v3-human-workflow`。

## 实现合同

- 恢复“新建编排”的表单工作流，使用 V3 定义；YAML 文件/粘贴导入保留为可选入口。
- AI 只生成提案。用户审阅后应用到未保存草稿，可以增删节点、修改提示词/标题/依赖/节点类型，再显式保存；丢弃提案不创建任务。
- 编排图用于预览；增删改通过表单和 YAML 完成，不宣称已实现拖拽式图编辑。
- 新建不自动运行。已有工作流保留显式“保存并运行”，活动运行期间禁用该按钮，定义保存只影响下一次运行。
- 人工审批展示运行快照中的提示词和上游结果，支持批准、拒绝、发送修改意见但保持等待。意见通过父会话交给 AI 讨论，不能代替人工批准。
- 运行中的定义被冻结；不能通过编辑当前文件偷偷改变正在执行的图。修改后重新运行，或使用已有的显式 revision 流程。
- V1/V2 现有编辑/迁移合同保留；新建要求 V3。`create_task` 仍不可用，普通会话不能调用提案提交入口创建任务。
- 默认仍为 `conduct`。此次不将 `orchestrate` 技术预览默认开放。

## 代码质量与业务逻辑审查

| 问题 | 原因 | 修复 |
| --- | --- | --- |
| AI 提案应用后 ID 被标题重新推导 | 新建表单没有固定 ID | 保留提案 ID，并增加人工增删改回归 |
| 提案预览遮挡“应用”按钮 | 完整 DAG 视图的最小高度超过预览区 | 增加 compact 布局，真实 Electron 点击复验 |
| 生成结果可能覆盖期间的人工修改 | 异步生成缺少草稿版本比较 | 用完整草稿身份比较，陈旧提案拒绝应用 |
| 快速结果、取消或离开页面可能留下请求 | RPC 确认与推送存在竞态 | 先订阅、缓存早到结果、超时取消、前后端清理临时会话 |
| 同名任务跨工作区污染运行状态 | 事件仅按 slug 过滤 | 同时校验 workspaceId |
| 审批上下文随编辑改变 | 活动定义与运行定义可能不同 | 返回运行快照中的审批定义/依赖，读取指定 run 的输出 |
| 修改意见重启丢失或重复发送 | 缺乏持久化意见/投递状态 | 记录意见与投递事件；失败/未知状态允许显式重试，普通重复请求去重 |
| 过期/终态审批可能被再次操作 | 控制入口需要统一检查 | 校验状态、超时、布尔类型、长度，冲突返回权威快照 |
| 批准输出容易与旧反馈混淆 | 反馈文本可能写着“尚未批准” | 输出显式批准前缀和结构化 approved:true，保留原始意见作为审计信息 |

## 自动化验证

- 最新定向测试：**340 pass、0 fail、1167 assertions，33 个文件**。覆盖 runner、schema/storage、创建/提案 RPC、表单增删改、提示词及入口。
- 最新全量 `bun run validate:ci`：**退出码 0，通过**。它包含 typecheck:all、全仓源码测试（含新增未跟踪测试）、lint 与多语言检查；提案 RPC 测试也由上述定向命令单独覆盖。原有 lint warnings 保留，没有 lint errors。
- Electron main/preload/renderer 最新构建通过；renderer 保留大 chunk 提示，不将其写作构建失败。
- `git diff --check` 通过。

复现定向命令：

```sh
bun test packages/server-core/src/tasks packages/server-core/src/handlers/rpc/tasks.import.test.ts packages/server-core/src/handlers/rpc/tasks.proposal.test.ts packages/shared/src/tasks apps/electron/src/renderer/components/app-shell/kanban/__tests__ packages/shared/src/prompts/__tests__/system.test.ts apps/electron/src/renderer/components/app-shell/__tests__/session-list-header-actions.test.tsx
```

## 真实 Electron + 模型验收

使用 macOS 本地构建、隔离工作区 `qa288` 和已有 ORDER/Laufry 模型连接。没有改动用户原工作区配置或会话。临时证据目录为 `/tmp/selection-288-CnC43t`，不属于仓库交付物，系统清理后可能消失。

1. 从“新建编排”进入表单；真实模型生成 V3 三节点提案。生成结束时没有创建任务，临时提案会话已清理。
2. 应用提案后人工修改初稿提示词，新增一个审批节点，再删除该节点；最终显式保存的是三个节点。保存后尚无运行目录。
3. 显式运行 `qa-288`，run ID 为 `run-1788759952815`。初稿输出“周五发布，先完成内部检查”，随后进入 review 审批；final 未调度。
4. 发送“改为下周一发布，并先完成内部检查。此消息只是修改意见，不代表批准。”真实 AI 收到意见并讨论，审批仍关闭，final 未调度。
5. 重启 Electron；意见与待审批状态保留，活动运行的“保存并运行”禁用，界面提示定义修改只影响下一次运行。
6. 用户点击批准，日志 seq 8 才记录 `approved:true`；seq 10 才调度 final。seq 14 verifier 返回 pass，seq 15 记录 run-completed；最终结果包含“下周一发布、先完成内部检查”。
7. 查看结果页，运行显示已完成，三个节点均完成；截图已人工检查。

证据：`approval.png`、`final.png`（表单）、`results.png`；工作区下 `tasks/qa-288/runs/run-1788759952815/run-log.jsonl` 及 `nodes/*.json`。最新定向和全量日志分别为 `targeted-latest.log`、`validate-latest.log`。

验收结束后已退出隔离 Electron、断开浏览器调试，并删除临时 `config/credentials.enc` 凭据副本（不需恢复；用户原凭据未改动）。Playwright 证据移至临时目录，未混入仓库改动。

## 结论与边界

恢复 V2 式创建/编辑体验并保留 V3 人工控制边界的核心闭环已真实跑通；不是仅把 YAML 导入改名。

- 最终模型文案仍引用了原意见里的“尚未批准”，尽管机器审批状态已明确 approved:true。这是生成内容的语义偏差，不能把 verifier 的 pass 当作文案完全正确，也不应据模型文字判断实际授权状态。
- 本次真实流程使用 conduct；没有宣称完成 orchestrate 全套真实模型矩阵、签名分发包、Windows/Linux 原生验收或长期稳定性验收。
- 最新投递失败/重启重试路径通过确定性测试；真实模型流程证明正常意见已送达，未额外制造真实网络中断。
- 审查后已清理 YAML-only 入口文案、提案 YAML 预览标签、保存/Agent 错误串，并将前端提案超时对齐到略高于服务端 180s；审批意见随运行快照同步。
- PR/远端 CI 在开 PR 后执行。
