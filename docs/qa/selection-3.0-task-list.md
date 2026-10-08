# #337 普通会话 Task List 验收

日期：2026-10-04。分支 `codex/issue-337-task-list`，独立提交后合并至 `version-3.0`，供 #451 复用。

## 入口与合同

- `update_task_list` 是 canonical registry 工具，Pi 自动注册其 MCP 名称。提交完整 `items` 替换数组，稳定 id，最多一条进行中，允许清空；非法状态、空标题、重复 id、依赖字段均拒绝。
- SessionManager 注入宿主回调，普通会话可用；DAG、提案、worker、Swarm 归属拒绝。成功结果随原活动管线写入 transcript；不触及 TaskRunner、任务目录或 sessionStatus。
- UI 每个回合只提取最新成功结果。后续回合不改写历史；停止时进行中显示为 interrupted，pending 保持。恢复后宿主将最后未完成清单作为模型上下文，目标改变时要求替换。新分支不复制 Task List 活动。
- TurnCard 独立卡片与工作链并存。进行中默认展开，全部完成自动收起，可用鼠标和键盘展开；状态有图标及无障碍名称，长条目换行。中文/英文文案来自 i18n；其余现有语言保留英文回退文案和键一致性。
- 遗留 TodoWrite 仅兼容读取，不作为新工具合同。Task List、Swarm、DAG 和 SubmitPlan 的区别已进入系统提示。

## 真实验收

运行 `bun scripts/selection-3.0-task-list.ts`，使用原已配置连接 `pi-api-key-2`、原模型 `gpt-6-luna` 和 safe 权限。记录见 `selection-3.0-task-list.json`。

1. 多步请求真实读取固定资料，两项完成，最终报告待处理，成功调用写清单工具；持久化后从 session.jsonl 重新读取，清单一致。
2. 用户说继续，同一会话、同一批稳定 id 完成最终报告；先前回合工具快照没有改变。
3. 简单计算问答直接回答“每年50万元”，没有写清单活动。
4. 前后 task 目录完全相同，普通根会话没有 taskSlug 或父会话。

UI 在真实 Vite playground 检查工作链收起时清单仍可见、键盘 Enter 展开、全部完成自动收起、中英文汇总和状态名称；另以 320px 容器检查紧凑显示和不截断条目。截图为 `screenshots/337-task-list-{en,zh,compact}.png`。

## 验证

`bun test packages/session-tools-core/src` 加清单提取/历史/停止、会话绑定、i18n 相关回归：197 pass，0 fail。`bun run typecheck:all`、`bun run lint`、`bun run electron:build`、最终 main/renderer 构建、`git diff --check` 通过；lint 保留原有警告。

首次真实验收发现 Pi 的调用上下文复制未携带新 getter，已补 enumerable 和覆盖真实 spread 路径的回归，修复后真实脚本正常退出。无新依赖，清单不是工作流执行或授权机制。
