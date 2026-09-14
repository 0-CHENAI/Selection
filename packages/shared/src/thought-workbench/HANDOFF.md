# 编排工作台交接

本分支基于 `test` 的 `097303e64c5ab0b73a378220fe3f07dd986ffd42`。检查点 `8bad7818` 之后的隔离验收记录见 `docs/qa/thought-workbench-followup-2026-09-14.md`。这些桌面片段**不是**发布全量通过声明。

## 启动

`bun run electron:dev` 默认进入思考工作台：顶部「新建编排」打开思考视图，已有编排编辑打开执行视图。`CRAFT_FEATURE_THOUGHT_WORKBENCH=0` 回到定义表单旧入口，不删除 `thought-workbenches` 文档或已保存 TaskSpec。模型连接在 Selection 内配置；没有加入或测试名为 Fable5 的模型配置，也未提交任何测试密钥。隔离验收请使用独立 `CRAFT_CONFIG_DIR` / `--user-data-dir`，不要用用户真实工作区跑 Agent。

## 当前证据

- 窄屏 800×700：思考分区可滚动，编辑侧栏不再被压到约 24px。真实隔离 Electron 窗口验证，不只是静态断言。
- 真实模型：三轮局部提案、手动编辑后重新提案、提案失效文案、保存后运行、结果回流、Agent 写入工具审批／拒绝／恢复。模拟端点不能代替这些结论。
- 冲突恢复、V1 未静默迁移、V2→V3 确认保存、`cache: pure` → `run-pure`、材料导入／PDF 页码与 0–1272 选区、macOS ARM64 目录包内嵌服务均有隔离窗口证据。
- 已知缺口：画布内键盘环未闭合；PDF `getDocument` 瞬时峰值与持续泄漏未测。

## 数据安全边界

工作台草稿和提案应用不启动任务；运行仍以明确保存的 V3 TaskSpec 为准。保留 TaskRunner、冻结运行版本、审批及 revision 流程。请勿为测试而绕过审批、静默迁移旧任务或重跑中断的 Agent 工具。
