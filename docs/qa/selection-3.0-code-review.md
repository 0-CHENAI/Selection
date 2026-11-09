# Selection 3.0 代码质量与业务逻辑审查

2026-10-04。审查对象为本地 `version-3.0` 的 #450—#457 与 #337/#320/#321 实现；更新后的 test 基线为 `9308ef00ed9801cddfec7ae7ec1f848a3d1f4f10`，修复前交付点为 `ccb7193fb96c35025624ccaf5b9c7f25ee99ea7c`。修复在 `codex/review-version-3.0` 分支完成。本轮没有 GitHub 写入、推送或 PR。

## 确认缺陷与修复

| 优先级 | 触发条件与原行为 | 修复及证据 |
| --- | --- | --- |
| P1 | `node-finished.researchRecord.payload` 与其生产凭证引用的 attempt 输出不一致。恢复只核对输出哈希与生产者身份，因此日志中的 `contradicted` 可被改成 `supported`，变成错误覆盖状态。 | 从被哈希验证的输出解析 `ResearchPayloadSchema`，再逐值核对记录 payload；不一致明确阻断交付。新增用例只改变 reviewer 日志内容，保持原输出及哈希不变；修复前失败，修复后覆盖数为零且存在损坏阻断。 |
| P1 | 交接用 `get_`、`submit_answer`、`session_history` 等前缀排除工具，遗漏 `get_external_publish`、`submit_answer_external` 等外部操作；`session__` 形式的真实内部工具又被误计为未知。 | 共享精确工具合同与别名归一化，仅豁免已知只读/会话内部操作；外部相似名称保留风险记录。捕获、待完成操作与目标执行校验使用同一规则。回归覆盖三种内部别名、外部相似名称及未知操作状态。 |
| P1 | 工具结果未知且 SDK/UI 都缺少原始参数时，仍生成了空参数请求哈希。人工确认已完成后，新参数或 `write` / `Write` 别名可绕过“不重放”检查。 | 缺少参数不制造请求身份；确认完成后，使用规范工具身份阻止同工具重放。真实只读和内部查询/提交仍允许使用。回归通过真实 SessionManager 交接、人工确认与目标操作校验复现。 |
| P2 | Coordinator 规划和最终验证检查点通过普通用户消息发送。其冻结计划和累积研究记录随后进入用户目标、约束与验收，并重复注入新会话。SDK task notes 也可能引用这些系统文本作为用户约束。 | 系统检查点使用现有隐藏消息通道；目标/约束 notes 的引用还需匹配可见、已提交的用户原文。提取用户背景直接使用 UI 原始消息，避免 SDK 引用副本重复成为用户验收。真实人工审批反馈保持传递。修复前检查点隐藏断言失败，修复后通过。 |
| P2 | 授权目录内的 `..notes.txt` 被 `startsWith('..')` 误判为目录逃逸，来源无法冻结。 | 按真实路径的父目录段判断边界。回归同时确认合法文件可读、`../source.txt` 和向外符号链接仍被拒绝。 |

## 应用的优化

- 交接背景对相同原文建立共享索引，目标、验收、约束、决定、范围、问题与后续步骤均可逐字段完整还原。索引序列保留重复消息的位置：“禁止部署 → 允许部署 → 再次禁止部署”仍以最后一条为准。未截断原文，没有新增资源上限。操作证据用稳定 action 引用指向完整冻结包；原始文件与证据继续保存。
- 捕获每个会话的 SDK 工具参数映射一次，替代每个工具/待完成操作重新扫描整条分支。相关步骤由每次工具调用扫描历史，降为一次分支扫描加映射查询。
- 研究工作者保留已经按角色/研究线构建的冻结上下文，去掉 `buildPrompt` 再次添加的全局研究上下文与重复存储读取。根 Coordinator 仍得到全局研究状态；工作者的用户约束、确认决定、依赖输入与来源路径继续传递。

同一个真实 F7 冻结交接包，旧背景为 **605,492 UTF-8 字节**，新背景为 **310,902 字节**，减少 **48.65%**；全部七个背景字段逐值还原一致。快照 SHA-256 `25dbcbad328b30f3df37c593173ca9d1170107afd5732000da2dc5ec3e5b1c76`，测量前后字节未改变。这是确定性序列化测量，没有据此宣称模型耗时、token 或费用同比下降；历史快照中的旧系统消息未被启发式删除。

## 业务与兼容性复核

- NORM/PRO 根身份、历史归属迁移、worker/reviewer 能力边界与任务权限上限；编辑器 workspace 绑定、定义 ETag、run revision 保护、原子补丁和结果消费；恢复/暂停/审批/最终 PASS 门禁；证据定位、精确版本独立审查、条件研究共享问题与后继复用，结合代码入口与现有回归复核。
- 隐藏 Coordinator 检查点暂停后仍绑定原始用户任务及 answer identity；继续操作不追加用户消息，较新的用户请求不能继续旧检查点。新增两项 SessionManager 进度集成回归通过，无须改变已有进度恢复协议。
- 新生产凭证校验只读重载此前真实 `f7-desktop-research` / `run-1791087470605`：9 条记录可用、交付阻断为空、`cost@2` 与 `b-basis@1` 仍受独立支持；覆盖为成本 1、风险未覆盖 1。旧报告与快照未重写，未把风险缺口解释为已解决。
- 失效节点继续保留带失效状态的历史输出，历史 PASS 与当前可用性分别展示；这属于现有业务合同，未误删其审计记录。

## 验证

- 全量 tracked/untracked 源码测试：**7,597 pass / 0 fail / 11 skip**。其运行过程中随后补充了 3 个回归；最终源码另行完整运行受影响的三份测试：handover **19/19**、TaskRunner research **9/9**、session progress **13/13**，合计 **41 pass / 0 fail**。
- `bun run typecheck:all`：core/shared/server-core/server/session-tools-core/pi-agent-server/electron/ui 全部通过；最终源码复查通过。
- `bun run lint`：0 errors；Electron 86、shared 8 条既有 warning，位置均不在本轮修改路径；未新增 warning。
- Electron 默认完整构建通过；最后源码改动后重建 main 成功。renderer 的既有大 chunk 提示保留。
- `git diff --check` 通过。新增 10 项回归；关键三处缺陷保留修复前失败证据在本次本地验证日志。

运行证据为 `/tmp/selection-v3-review-{tests,types-final,lint,build,main-final,research,handover,progress}.log`；可持久核对的字节测量与真实历史恢复结果见 [selection-3.0-code-review.json](selection-3.0-code-review.json)。本轮没有重跑实际模型或桌面 F7，既有真实验收见 [整体验收记录](selection-3.0-integrated-acceptance.md)。
