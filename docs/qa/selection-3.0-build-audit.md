# Selection 3.0 按 GitHub Issue 复核

日期：2026-10-05。源码基线：本地 `version-3.0` 的 `5bbf393e3`，上游 test 仍为 `9308ef00ed9801cddfec7ae7ec1f848a3d1f4f10`。在线读取 #448、#450—#457，以及用户明确纳入的 #337/#320/#321；本轮没有推送、PR、Issue 评论或关闭操作。

## 结论与待完成的交付工作

实现主体与阶段证据齐全，但当前普通构建尚未完整开放 3.0 功能，不能据此标记正式版本已交付。

| 核对项 | 当前事实 | 对交付的影响 |
| --- | --- | --- |
| 动态编排构建开关 | `feature-flags.ts` 默认关闭；`TaskEditor` 的研究模板及动态 runner 入口依赖该开关；普通完整构建中的宿主与 renderer 均关闭 | #454—#456 的能力需要显式开启构建开关。普通 PRO 标签不能证明这些能力可用；正式 V3 构建应明确配置 |
| 实际补丁校验 | 用已完成 F7 的 revision 4 规范计划做只读校验：默认返回 `orchestrate is disabled`；设置 `CRAFT_FEATURE_TASKS_ORCHESTRATE=1` 后相同补丁校验通过 | 差异已通过生产校验器复现，没有保存新 revision 或启动任务 |
| 产品版本 | 根、Electron 和共享包仍为 `2.3.0` | 功能分支名不等于安装包版本；版本号和发布产物尚未收尾 |
| GitHub 交付 | #448 与 #450—#457 仍 OPEN、无验收评论；远端无 `version-3.0`，无对应运行或 V3 PR；最新列出的 release 为 `v2.3.0-beta26` | 本地交付尚未进入远端验证与发布流程。Issue 状态本身不作为实现缺失的证据 |

工作模式、操作权限与全局 DAG/Swarm 可用性继续分开。构建开关修正也不应替用户更改操作权限或启动任务。3.1 的九项增强仍不列入本次放行范围。

## 源码与阶段证据

| 阶段 | 复核方式与结果 |
| --- | --- |
| #450 框架 | 根会话、TaskSpec、run/revision/attempt、已提交成果同源；单节点及恢复记录见 `selection-3.0-stage-01.md`，运行回归本轮完整覆盖 |
| #451 / #337 模式与清单 | 宿主模式/角色拒绝、迁移、原生委派、草稿导航和原生清单入口存在；相关源码测试通过 |
| #452 交接 | 独立来源关系、等待一致点、幂等、原始调用结果与未知操作复核、防重放和目标权限配置有宿主实现；交接回归通过 |
| #453 / #320 / #321 计划与编辑 | 统一有效依赖、草稿版本、手工锁、ETag、规范原子 patch 与编辑器布局已接通；相关回归通过。实际界面证据沿用各阶段记录 |
| #454 动态执行 | planner 结果消费、actor 身份与串行复用、后继及安全点使用同一 TaskRunner；回归通过，普通构建开关仍是上述交付缺口 |
| #455 单线研究 | 当前代码只读重载真实 F5：completed、revision 1、cost@2、wrong-cost resolved、blockers=[]；成本覆盖 1/2，风险未覆盖 |
| #456 多线研究 | 当前代码只读重载真实 F6 后继：completed、两条成本 covered、两条风险 uncovered、blockers=[]；竞争前提和限定异议保留 |
| #457 整体场景 | 当前只读检查器重载真实 F7：completed、revision 4、cost@2 / b-basis@1、独立 reviewer、锁定条件、局部重试和新 NORM 交接均通过；覆盖 1/2，blockers=[] |

本轮没有新增真实模型调用或重跑完整桌面 F7。实际模型/桌面证据来自先前阶段，并用当前代码重新读取上述研究成果；不把历史重载称为当前版本从头自动完成。此前 F7 中存在人工恢复、局部重试和资料限制，仍见 `selection-3.0-integrated-acceptance.md`。

## 验收工具漂移与修复

首轮全量检查在 OfficeCLI 原生烟测出现 `System.Text.Json, Version=10.0.0.0` 加载失败。单项及整文件复跑通过，但 `officecli:check` 随后明确发现二进制为 1.0.153，与仓库审查的 1.0.152/schemaCRC/SHA256 不一致。

原生测试直接调用二进制，未传生产封装已有的 `OFFICECLI_SKIP_UPDATE=1`。上游 [v1.0.152 Program.cs](https://github.com/iOfficeAI/OfficeCLI/blob/v1.0.152/src/officecli/Program.cs) 和 [UpdateChecker.cs](https://github.com/iOfficeAI/OfficeCLI/blob/v1.0.152/src/officecli/Core/UpdateChecker.cs) 确认默认会后台更新并替换程序。不能仅凭这次日志把每一次 .NET 加载错误都归因于更新；版本漂移及测试环境缺口已得到确认。

本轮在两份原生测试中统一禁止自更新和自动驻留，保留全部真实文件写入、回读及错误断言。完整构建重新下载审查版本；最终未设置外部禁用变量的定向测试通过，并检查二进制仍匹配清单。没有放宽版本或哈希门禁。

## 本轮验证

- 源码测试覆盖全部 710 个文件：首轮 5896 pass / 1 fail 后中断；剩余 99 文件 1719 pass / 0 fail / 11 skip；失败文件修复后 27 pass / 0 fail。按唯一测试计为 7616 pass、11 skip，没有未解决失败，不能表述为首轮单次全绿。
- 全仓八包类型检查沿用本次会话同源码基线的通过记录；两份测试修改后 shared 类型检查与文件 ESLint 另行通过。
- 全仓 lint：0 errors，Electron 86 / shared 8 条既有 warnings；i18n parity/sorted/coverage 通过，2419 keys。
- 默认 `bun run electron:build` 完整 main/preload/renderer/resources/assets 构建通过；它验证默认产物可编译，不能替代开启动态编排的 V3 发布验收。
- 重建后 `officecli:check` 通过；deep-research Skill 源与打包副本 hash 一致；`git diff --check` 通过。
- 本轮未构建 Windows/Linux 安装包或生成正式 macOS 安装包，也未运行远端 CI。

原始本地日志：`/tmp/selection-v3-issue-audit-{tests,tests-remaining,office-fixed,office-manifest-final,lint,i18n,build,types-shared-final}.log`。当前 F7 重载结果：`/tmp/selection-v3-issue-audit-f7-reloaded.json`。
