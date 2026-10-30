# Selection 3.2 O1 三分路由

对应 #684，基于 `origin/test` 的 `3718d32687e7944d1862046e0616c080f4f258ed`。O0 基线见 PR #691 的 `docs/plans/selection-3.2-office-baseline.md`，该文档已合入专用 `v3.2` 集成分支。

## 行为与入口

已有 PPT 工程或输出记录的跟进消息，经 `services/ppt-catalog.ts/buildPptPrompt` 进入独立 follow-up context，不重复注入“Create an editable PPT”和继承模板的完整 design。新附件、品牌标志和用户点名的图表技能仍保留；工程损坏/缺失不成为静默重建授权。

`services/ppt-live.ts/buildPptTurnPrompt` 是 SessionManager 的统一拼接入口：显式 revision 优先，不叠加 generation context。普通非 PPT 消息不要求加载 PPT 资源。`buildPptRevisionPrompt` 保留目标页/元素边界，取消无条件“写 deck”，根据路由决定 CLI 或 deck 操作。显式 restyle/recolor 分别限定整套换皮/仅 token 修改。

稳定语义标签由 `packages/shared/src/prompts/ppt-routing.ts` 与内置技能共同约定：

| 标签 | 意图 | 边界 |
| --- | --- | --- |
| office_edit | 改标题/文字/数据、保母版 | OfficeCLI 修改真实 PPTX；禁止 deck 重生成、重锁 style |
| deck_revision | 版式、叙事、重排 | 读现有工程，仅改请求范围，保留主题，check 后导出 |
| restyle | 显式整套换风格 | 才能重锁 style；保留事实来源 |

标签由模型按语义选择并记入会话计划，不是关键词分类器或已持久化的宿主路由枚举；O2 可沿用这些名称。外来稿无匹配工程时仍先 CLI 检查，不声称保真导入。CLI 改后的 PPTX 为权威，后续 deck 修订必须先对账，不能覆盖为旧内容。

## 验证与实际限度

- `bun test packages/server-core/src/services/ppt-routing.test.ts packages/server-core/src/services/ppt-catalog.test.ts packages/server-core/src/services/ppt-live.test.ts packages/server-core/src/services/ppt-library.test.ts`：29 pass / 0 fail，2862 assertions。覆盖三种意图的上下文合同、修订优先级、普通消息、新建保留、缺项目的跟进与新标志保留，以及既有模板/导出测试。
- `bun test packages/shared/src/prompts/__tests__/system.test.ts packages/shared/src/agent/__tests__/ppt-visual-qa-policy.test.ts`：43 pass / 0 fail，273 assertions。原生读图、防 OCR 和全局提示长度门保持。
- 全仓 `bun run typecheck:all` 通过；之后对新增统一入口重跑 server-core 类型检查。shared 新文件 ESLint 通过。
- 本阶段没有真实模型执行三案的工具轨迹，没有生成或视觉验收最终 PPT。上述测试证明宿主不再叠加生成指令及提示合同，不证明任意模型必然选择正确工具；真实模型和产物回归仍属于 Ship 必须完成的证据。
- G4 全页范围、相邻布局限制、实时预览 `enforceCheck: false` 保持原样，交 O2 处理。本阶段没有提前宣称 O2 完成。

## 集成与后续

用户后续授权以 `v3.2` 为集成分支，因此 O0 已集成后推进 O1；保留独立 draft PR → test，不直接合入 test。后续各阶段继续独立验证与 PR，在满足集成条件后合入 v3.2。所有 CI 与真实验收状态必须按当前结果回读，不能以本文替代。
