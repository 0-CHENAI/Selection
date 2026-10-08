# #320 多轮编排编辑验收

多轮编辑沿用 `tasks:generate` 的安全提案路径。编辑器保存本次打开期间的对话轮次与应用/放弃状态，每轮携带最新草稿。尚未应用的提案可继续修改；若人工改了草稿，则下一轮改用人工草稿。历史提案只作为上下文。

预览按稳定节点 id 展示新增、删除、提示词、模型、配置和依赖的字段差异，另提供图和 YAML。应用前重新走宿主校验，并在异步校验前后检查草稿身份；无效或过时提案不能应用。应用仅更新未保存草稿。关闭编辑器结束本次对话，临时模型会话每轮清理，不成为执行根或已保存编排。

## 验收结果

- 真实宿主和 `gpt-6-luna` 四轮：创建 collect→analyze→report；插入 dedup；手动设置 collect 的 `gpt-6-sol`、连接与 `timeout: 1234` 后仅改 report 中文输出；删除 dedup 并修复 analyze 引用。未涉及节点深度比较相同，最终图有效，没有新建或运行任务。
- 实际 TaskEditor + 固定传输：已有定义两轮应用，人工 YAML 模型修改保留；切换图/YAML不丢对话；放弃删除提案保留当前四节点及中文报告。
- 实际 TaskEditor + 固定传输：新建场景先生成、继续修改未应用提案，再一次应用四节点；保存/创建/运行均为 0。
- 提案生成后人工改标题，应用拒绝旧提案；无效 `missing` 依赖显示错误，未提供应用按钮。
- 事件早于 RPC 确认时仍准确关联；宿主拒绝畸形历史，自动修复模型更改已有任务 id 的结果。

本轮真实模型初次验收脚本误把仅任务级支持的 `token_budget` 加在节点上，比较失败；改用有效的节点 `timeout`，并增加生成前草稿有效性检查后四轮通过。该初次失败没有作为产品通过证据。

## 证据与验证

- 可复跑脚本：`bun scripts/selection-3.0-conversation.ts`；本次结果 `/tmp/selection-version-3.0/320-conversation-real.json`。
- 48 tests / 0 failures / 141 assertions（提案 RPC、可信提交、字段差异、表单往返）。
- 八包类型检查通过；lint 0 errors（既有 Electron 86、shared 8 warnings）；i18n 2308 keys 一致且排序正确；Electron 完整构建通过，diff check 通过。
- 实际 UI 截图：`/tmp/selection-version-3.0/320-proposal-diff.png`、`320-manual-yaml.png`、`320-stale.png`、`320-invalid.png`。固定传输图只证明真实组件交互，真实模型另由宿主脚本证明。

#321 会进一步整理编辑器整体布局、窄窗口及各子对话框；#453 会统一依赖语义、冻结约束和修订冲突。
