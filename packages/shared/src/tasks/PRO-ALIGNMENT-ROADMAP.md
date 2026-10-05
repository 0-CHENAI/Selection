# PRO 对齐实施路线

父 Issue：[Selection V3.1 九项增强 #449](https://github.com/0-CHENAI/Selection/issues/449)。以下阶段采用 [#448](https://github.com/0-CHENAI/Selection/issues/448) 的方式：先确认可运行框架，再逐项填充功能。V3.0 的正式构建收尾仍归 [#457](https://github.com/0-CHENAI/Selection/issues/457)，V3.1 增强不反向扩大 V3.0 范围。

## 阶段与收尾

| 阶段 | 原生子 Issue | 填充内容 | 本阶段交付 |
| --- | --- | --- | --- |
| 01 | [#459 共用框架](https://github.com/0-CHENAI/Selection/issues/459) | 确认现有聊天、计划、执行与研究入口，归档已完成工作 | 可运行闭环、实际入口与重载证据 G0 |
| 02 | [#460 资料可信度](https://github.com/0-CHENAI/Selection/issues/460) | ①查阅凭据与来源包、③勘误传播 | 原文范围可回查、原线纠错与冻结交接 G1 |
| 03 | [#461 请求并发](https://github.com/0-CHENAI/Selection/issues/461) | ⑧共享配额、自适应准入与公平排队 | 限流 / 取消测试与真实请求计数 G2 |
| 04 | [#462 研究判断](https://github.com/0-CHENAI/Selection/issues/462) | ②证伪、④前提审查与局部阶段门 | 事实修正、替代前提处置与版本复审 G3 |
| 05 | [#463 结构化求助](https://github.com/0-CHENAI/Selection/issues/463) | ⑨协调者优先答复与恢复关联 | 同一有效任务继续、迟到回复隔离 G4 |
| 06 | [#464 长材料](https://github.com/0-CHENAI/Selection/issues/464) | ⑤原生 Skills 的结构定位、索引与原文核验 | 真实定位、来源变更失效及识别限制 G5 |
| 07 | [#465 执行解释](https://github.com/0-CHENAI/Selection/issues/465) | ⑥多视图、⑦预检、影响预览和历史回放 | 同一计划与事件派生、回放无执行 G6 |
| 08 | [#466 联合交付](https://github.com/0-CHENAI/Selection/issues/466) | 九项普通包验收与受控效果对照 | GPT-6-luna 聊天闭环、对照记录及实际交付状态 G7 |

这是推荐实施顺序。实际依赖已记录为 GitHub blocked-by：#457 → #459；#459 → #460 / #461 / #463 / #465；#460 → #462 / #464；#459–#465 → #466。独立能力不因推荐顺序增加虚假前置。

## 推进规则

1. 每阶段先接通完整目标流，再补当前必需字段和阻断缺陷。满足对应 Issue 的完成条件后进入下一阶段。
2. 交付只需可运行流程、实际入口说明和固定案例证据。非阻塞优化记入所属 Issue 的后续清单，不无限扩大当前阶段。
3. 已有实现与通过证据直接复用，失败与未完成项如实保留。提交前检查仓库格式，完成相关测试、类型、lint、构建和差异审查；仅在新修改、失败或未解决风险出现时重复检查。
4. 普通安装包的九项联验和相同模型 / 资料 / 权限的效果对照集中在 #466。阶段测试通过、本地提交和远端交付分别记录。
5. 当前先核对 #457 的既有证据，由 #459 归档实际共用入口；#460 / #461 / #463 复用已有功能成果，#462 只收尾其当前阻断。之后才开始 #464 / #465 的实现。

## 现有框架入口

- 聊天与规范计划：`packages/server-core/src/sessions/SessionManager.ts`、`packages/server-core/src/tasks/chat-plan.ts`。创建、绑定与异步启动沿用现有宿主路径，编辑器保存仍只保存。
- 执行、修订与恢复：`packages/server-core/src/tasks/TaskRunner.ts`、`packages/shared/src/tasks/plan.ts`、`storage.ts`。既有 run / node / attempt / revision、人工锁、状态和成果保持同一权威来源。
- 研究记录与派生结果：`packages/shared/src/tasks/research.ts`、`research-storage.ts`；界面使用 `ResearchResults.tsx`。查阅、勘误、判断和求助只填充其所属阶段当前使用的记录。
- 配额与原生能力：`packages/server-core/src/tasks/connection-pool.ts` 及现有 OfficeCLI / PDF / 文档 Skills。继续复用宿主配额和原生文档能力。

仅增加当前阶段实际消费的契约。模型判断语义，宿主验证身份、引用、权限与状态；旧记录缺少凭据显示未记录，交接快照保持冻结。简单 PRO 与 NORM 保持轻量，不新增工作流编译器、调度器或第二份图状态。

## 迁入已有成果（2026-10-05）

| 阶段 | 本地状态 | 已有证据 / 缺口 |
| --- | --- | --- |
| V3.0 / 01 | 正式包闭环已有证据 | GPT-6-luna 五节点审查、修正、重载；#457 的整体收尾仍需核对 |
| 02 | 本地提交 `798ba9b83`、`f21bc7539` | A1 / A3 真实闭环与 fixtures；A1 普通包来源展示通过，A3 最终整包待联验 |
| 03 | 本地提交 `9e8b533f4` | 真实请求授权 / 释放归零，确定性限流测试；未声称真实上游 429 已验收 |
| 04 | 工作区已有实现，未判定交付完成 | 定向检查已通过，真实模型验收收尾；此前失败记录保留 |
| 05 | 本地提交 `498bd25b3` | GPT-6-luna 同任务求助继续，停止 / 重启 / 迟到回复测试 |
| 06 / 07 | 尚未实现 | 长材料仅原生能力探索，多视图 / 回放复用入口已识别 |
| 08 | 待联合验收 | 九项完整普通包及三方受控对照尚未完成 |

具体运行、模型、来源与构建证据见 [PRO-ALIGNMENT-ACCEPTANCE.md](./PRO-ALIGNMENT-ACCEPTANCE.md) 和 `scripts/fixtures/selection-3.0/`。这些本地提交尚未推送；Issue 保持开放，不将框架建立视为九项完成。
