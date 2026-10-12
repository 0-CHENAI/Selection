# Selection 3.0 · #451 验收

2026-10-04，从已合并 #450/#337 的 `version-3.0` 创建 `codex/issue-451-session-modes`。公共字段、迁移、能力入口已追加到 `docs/plans/selection-3.0-execution.md`。

## 实际场景

F1：`bun scripts/selection-3.0-f1.ts` 使用原 workspace `797f4ce6-6124-0541-4f53-44eb5e7e0767`、原模型 `gpt-6-luna` 和 safe 权限。真实 NORM 会话 `261004-open-gorge` 读取固定资料、完成三项 Task List、确认 A 两年 100 万元并保留 B 口径/风险缺口未知。自动及用户明确委派、原生 Task/Agent、session aliases、DAG 启动和定义提交均被宿主拒绝；worker 数为零，任务目录未变。RPC 的 NORM 启动在 runner 获取前拒绝，真实 host 直接启动同样拒绝。

F0：`bun scripts/selection-3.0-f0.ts` 再次通过。PRO 根 `261004-sharp-delta`，slug `f0-1791048837698`，run `run-1791048837720`，revision 0，单节点 attempt 1 完成；没有额外 Swarm，沿用原模型/权限。普通文件会话和旧 v1 conduct 依赖编排回归通过。随后独立进程 `--inspect f0-1791048837698 run-1791048837720` 只读重载通过，没有重跑 worker。

历史迁移覆盖显式类型、任务根、实际 Swarm 根/worker/reviewer、开关记录、普通记录、缺父级、缺根 worker、循环、显式 NORM 与任务归属矛盾。真实 JSONL 连续两次冷启动的 header 相同，原消息/权限/父级保留。矛盾记录标记待核对并禁止新委派。

NORM 文件反馈复用当前会话执行，不产生子会话；真实候选及成果版本存储验证目录恢复、回执独立（第二次失败不能误认第一次成果）、崩溃后恢复原目录、持久化阻塞检查点，并在第二次冷启动继续阻止自动重播。现有 PRO 文件反馈、授权撤销和代码验证保留。

## 界面操作

通过 ego-browser 的同一验收 TaskSpace 操作实际 `TopBar`、`ChatPage`、`SessionItem` 和 `ExecutionChildren`，传输为固定数据，不在预览启动模型。

- NORM 输入“NORM 独立草稿”；PRO 输入“PRO 独立草稿”并上传真实 `costs.txt`；来回切换，文本各自保留，附件仅在 PRO 草稿出现。
- 打开 PRO worker 深链接后 PRO 按钮 `aria-pressed=true`，子会话分组可见，原 safe 权限和模型保留，worker 的 Swarm 入口 disabled。
- 执行组点击收起后按 Enter 展开，`aria-expanded` 正确变化，未读点使用既有 accent。
- 375px 紧凑 TopBar 的两个模式均在容器内，scrollWidth 与宽度相等。

截图已目视检查：`screenshots/451-norm-draft.png`、`451-pro-draft.png`、`451-pro-worker.png`、`451-compact-topbar.png`。这证明实际组件的交互；真实宿主行为由上述脚本及 RPC/SessionManager 测试验证。

## 检查结果

- 最终模式/迁移/RPC/草稿导航回归：27 passed，8 files。
- 文件反馈与冷恢复：19 passed，2 files；反馈存储回归 9 passed。
- provider 原生工具前置检查此前单独运行：81 passed。
- `bun run typecheck:all`：8 个 workspace package 全通过。
- `bun run lint`：0 errors；Electron 86 warnings、shared 8 warnings，均未阻断。
- i18n parity / sorted：通过，6 个非英文 locale 与英文各 2252 keys 对齐。
- `bun run electron:build`、`git diff --check`：通过。

全仓单进程首轮为 **7253 passed、11 skipped、37 failed、1 error（693 files，exit 1）**，不能记为全绿。旧复杂能力正向夹具已显式指定 PRO；草稿静态断言已更新。余下 Electron export、Spinner、i18n/config 错误受到同进程 mock 影响。所有首轮失败文件和 BrowserPaneManager error 文件分别隔离复跑，全部 exit 0；文件清单与场景原始结果保存在同名 JSON。没有改写无关 Electron mock 框架来掩盖首轮结果。

## 下一阶段

#452 在固定模式上加入 NORM → 新 PRO / PRO → 新 NORM 交接。交接必须等当前一致点，包括正在进行的单 agent 文件反馈，不能通过改变模式或借用 worker 父级模拟交接。
