# #452：背景与成果交接验收

2026-10-04，分支 `codex/issue-452-handover`。前置 #450/#337/#451 已分别合并到 version-3.0。本阶段不增加任务执行器；共用约定见 `docs/plans/selection-3.0-execution.md`。

## 真实 F2

`bun scripts/selection-3.0-f2.ts` 使用真实 SessionManager、Pi 宿主和原有 `gpt-6-luna` 连接。NORM `261004-fresh-heath`→PRO `261004-coral-hawk`→NORM `261004-sunny-moon`。两次交接均 applied，模型不变、权限 safe、无 parent；交接本身无模型执行。源 JSONL 在交接前后完全相同，重试目标 ID 相同，输入回执只有一条。

PRO 从冻结快照得到 A 两年 100 万元，并保留 B 口径未知、风险缺口、仅约定资料和不部署约束。回到新 NORM 后仍保留上述事实与限制，并提出成本口径和风险资料的核对方向。固定资料 hash `4c99133f5aba0554887a6e679c276035b86b13a6d88c6da6fbc4868c0a144fb6`。结果、来源、交接 ID、文件 hash 和两个模型答案见同名 JSON。

首轮真实验收发现工具 UI 将绝对路径显示为相对于宿主进程的路径，不能用于恢复真实读取身份。已改为读取 SDK 活动分支的原始参数，真实 F2 重跑通过；没有原始参数的相对显示路径会明确提示无法保留，不能猜测原文件。

## 宿主恢复和执行检查

`bun test packages/server-core/src/sessions/handover.test.ts packages/server-core/src/sessions/work-mode.test.ts packages/server-core/src/handlers/rpc/tasks.work-mode.test.ts packages/server-core/src/tasks/TaskRunner.test.ts packages/server-core/src/tasks/TaskRunner.v3.test.ts packages/server-core/src/reliability/execution-checkpoint.test.ts`：167 通过、0 失败、894 次断言，6 个文件。

| 场景 | 实际结果 |
| --- | --- |
| 连续/并发同 ID 请求 | 一个目标、一条背景回执 |
| prepared 后、目标创建前崩溃 | 使用持久预留 ID 恢复 |
| 创建目标后、背景应用前崩溃 | 冷重启继续原目标 |
| 背景已落盘、applied 回执前崩溃 | 冷重启不重复输入 |
| 源 worker 活动与取消等待 | 无目标、不停止 worker；停止后可重新交接 |
| 另一运行实例占用源锁 | 不捕获、不开始第二份执行 |
| 文件后来改变/源删除 | 明确变化；目标仍读冻结资料 |
| 网页后来改变 | 显式检查显示变化；原响应快照不变 |
| 暂停的源 run、后续多次交接 | 原根继续拥有 run；目标不能接管原 slug |
| 旧成果文件已改写 | 读取注册的原版本，不用最新文件冒充 |
| 外部结果未知 | 读可继续；写入/编排阻塞，用户记录依据后重新校验权限 |
| 确认完成的操作 | 根和 worker 均拒绝相同请求重放 |
| 快照文件被改写/回执损坏 | 完整性或来源校验阻止执行 |
| 凭据和授权 | 认证请求不转移，已知凭据文本脱敏，目标 safe |

## 界面验收

ego-browser 的同一验收空间中运行实际 HandoverPanel；此处传输使用固定状态，宿主与模型由上面的真实 F2 和测试验证。检查了创建后资料/版本、来源和目标入口、等待后取消、未知操作填写依据并保存、文件变化、源删除和窄窗口。

截图均已目视检查：

- `452-handover-ready.png`：目标、约束和已冻结输入，打开目标或另建交接。
- `452-handover-waiting.png`：等待与取消，不启动重叠工作。
- `452-handover-review.png`：未知结果、选择结果并填写复核依据；保存后待复核提示消失。
- `452-handover-changed.png`：原文件已变化，快照保持冻结。
- `452-handover-source-removed.png`：源删除入口禁用，资料保留。
- `452-handover-compact.png`：375×700，正文滚动；底部关闭、源、目标和新交接按钮均在视口内。

小窗口的初次观察发现默认 sm 宽度覆盖了交接面板宽度；已使用响应式最大宽度和动态视口高度修正。最终弹窗在 375×700 内约 345×560，底部两行按钮均可见。

## 检查和下一阶段

8 包 `bun run typecheck:all` 通过。`bun run lint` 0 错误，保留现有 86 条 electron、8 条 shared 警告；i18n parity/sorted 通过，2295 键；完整 `bun run electron:build` 和 `git diff --check` 通过。全局同进程测试的既有 mock 污染记录见 #451，本阶段执行上述针对性回归。

首版等待策略、不热迁移 worker、不接管源 run。网页核对复用现有 WebFetch 的公开读取与内容表示，无法读取时显示无法核对，快照从不自动刷新。已知凭据材料排除并提示；助手结论保持未审查。后续资料自动勘误传播仍归 #449。

继续 #320 多轮编辑、#321 布局验收，再进入 #453 的统一草稿/保存/冻结运行计划。新 PRO 根及其背景可直接复用现有编辑入口。
