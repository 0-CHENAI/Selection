# #769–#772 目标完成与低成本验证验收

日期：2026-11-02
基线：`test@ccd1ee6436e9339b4c91c4fd0e052aaac4769b8e`

## 实现边界

- 普通 NORM/PRO 会话在原有主模型轮次内执行短完成审计：当前原始请求、后续纠正、引用规格、TaskSpec 与当前证据按权威顺序核对；不新增 Router、mini completion、隐藏 reviewer、子代理或持久 Intent Ledger。
- TaskSpec v3 最终验证支持 `auto | required | off`。`auto` 只看显式配置、DAG 覆盖和宿主证据；旧 `required` 布尔值保持兼容，新旧字段并存时拒绝。
- artifact、声明输出、运行状态、未收尾 worker、shutdown、研究 blocker 与 planner result 始终先做确定性门禁。只有仍需语义判断时才发起最终模型复核。
- 最终复核使用有界摘要和 `get_task_results` 按需读取；不再复制完整 frozen plan 或全部节点正文。
- 新 v3 模型复核必须提交结构化 checks。PASS 的所有检查必须为 pass 且引用当前 run/revision 的宿主目录证据；fail/unknown、外来引用和未知字段均被拒绝。

## 固定案例与证据

| 案例 | 结果 | 回归证据 |
| --- | --- | --- |
| A1 简单单步 | 完成审计位于既有系统提示，同一模型轮次执行；没有新增调用入口或计划要求 | `system.test.ts` 的完成审计与 7,981 token 上限；`auto` 无验收标准运行记录为 0 次最终模型请求 |
| A2 多项要求缺一项 | 合同要求逐项对照，缺失时继续工作或披露精确边界，不得声称全部完成 | 完成审计提示快照；v3 checks 的 fail/unknown 宿主门禁 |
| A3 窄测试不能证明宽目标 | 历史叙述、自述和窄测试均不作为宽目标完成证据 | NORM/PRO/节点提示合同断言；unknown 不能 PASS |
| A4 已有终态 verifier PASS | `auto` 复用 verdict，不请求父协调复核，不预留验证预算 | `auto reuses a covering terminal verifier...`：请求 0、reserve 0 |
| A5 显式 required | 恰好发起一次最终复核；默认一次局部 repair | `required verification enforces...`：请求 1、验证上下文 1,318 bytes、记录用量 123 tokens、repair 0 |
| A6 研究/开放语义 | 有验收标准且证据边界未由终态 verifier 覆盖时保留复核；报告仍披露 unresolved | research 回归使用冻结原文、独立 review、当前 claim 版本和最终 checks；结构通过不替代研究证据判断 |
| A7 缺失/冲突证据 | unknown/fail 不能作为 PASS；其他 run/revision 引用被拒绝 | `required verification enforces...` 与局部前沿测试 |
| A8 旧配置/历史记录 | `true → required`、`false → off`；旧 verdict 无 checks 时原样读取，不伪造逐项通过 | `v3-contract.test.ts`、`results.test.ts` |

## 成本与上下文实测

这些数字来自确定性 MockHost 运行真实 TaskRunner 状态机，不是供应商模型质量或速度基准：

| 场景 | 最终模型请求 | 首条验证上下文 | 验证用量 | repair | 最终状态 |
| --- | ---: | ---: | ---: | ---: | --- |
| `auto`，无验收标准 | 0 | 0 | 0 | 0 | completed |
| `auto`，覆盖交付的 verifier PASS | 0 | 0 | 0 | 0 | completed |
| `required`，两项 checks 全 pass | 1 | 1,318 bytes | 123 mock tokens | 0 | completed |
| `required`，首次未提交结构 verdict | 2（含唯一格式纠正） | 两条均计量 | 70 mock tokens | 0 | completed |
| 50 节点、每节点 20,000 字符输出 | 1 | 7,860 bytes | 未模拟供应商用量 | 0 | verifying 后由测试停止 |

50 节点案例累计生成约 1,000,000 字符节点正文；首条验证消息不含这些正文、完整 TaskSpec 或原始 prompt，只保留有界状态摘要和引用。验证者必须按验收项调用 `get_task_results` 读取必要结果。

## 审查中发现并修复的问题

- 重启中的 verifying 运行一度会被通用启动扫描标记为普通中断后重复发送上下文；现在保留父验证续跑标记，`continue` 只恢复原进度轮次。
- 仅看终态聚合节点会把“模型输出 → 本地 aggregate”误判为纯确定性交付；现在必须同时确认交付节点及全部祖先都不是模型会话节点。
- 当前证据引用改为节点实际产出 revision，防止计划修订后把旧产出伪装成新 revision 证据。
- `off`/复用 verifier 之前也会重新验证 artifact；恢复成果集成测试改用真实存在且 hash 匹配的宿主回执，不再以虚构路径绕过门禁。
- 条件分支已明确跳过的节点不再因其声明输出缺失而被计为未决证据，避免最终复核把合法 skip 误判为交付缺口。

## 自动化门禁

- `bun run typecheck:all`：通过。
- Electron 主进程构建：通过；Session Tools、Pi Agent Server、网络拦截器与主进程产物均完成构建和校验。
- UI ESLint、本次 Shared 改动的定向 ESLint、原生 IPC send 守卫、Task/Agent 工具名守卫：通过。
- server-core TaskRunner/TaskSpec 回归：269 项通过；唯一未执行成功的用例是在当前 Windows 权限策略下创建符号链接时返回 `EPERM`，失败发生在 fixture 建立阶段，不进入被测逻辑。排除该平台权限用例后，本轮涉及的 research 回归 15/15 通过。
- shared TaskSpec/prompt/session verdict 回归：176 项通过；唯一未执行成功的用例同样是在 fixture 建立阶段创建符号链接返回 `EPERM`。
- 仓库级 Electron ESLint 仍被 `apps/electron/src/renderer/App.tsx` 的一项既有 `no-direct-file-open` 错误阻断；仓库级 Shared ESLint 仍被未触及的来源认证和 `open` 导入规则错误阻断。本轮没有把这些存量问题混入 769–772 的提交。
- `server:build` 明确只支持 macOS/Linux，因此在 Windows 返回 unsupported platform；改用当前平台可执行的 Electron 主进程构建完成交付验证。

## 剩余不确定性

宿主可以保证 checks 非空、有界、引用当前运行，且 unknown/fail 不能 PASS；它不能证明模型是否把自然语言验收拆分得足够细，也不能证明引用证据在语义上真的支持 criterion。Office 视觉质量、研究结论和外部状态仍需对应的实际读取、渲染、独立审查或现场验证。本轮没有把 MockHost token 数解释为真实供应商成本，也不声称固定百分比收益。
