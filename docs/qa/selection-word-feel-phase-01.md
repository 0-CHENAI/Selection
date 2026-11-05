# Word 体感 Phase 0 / Phase 1 验收

日期：2026-11-05。基线：`test`。产品选择：S1a / S2a / S3a / S4a。

对照：`office_template` → 一次 `office_template_write` → `submit_answer`（宿主 7 项版式守卫）。有原生 `sampleFile` 的 Word 案例不再每轮注入完整 ~43KB `officecli-docx`。

## Phase 0 夹具

```bash
bun test packages/server-core/src/services/office-catalog.test.ts
bun test apps/electron/src/renderer/components/office/office-home.test.tsx
```

单测 `Word injection shape` 固定看 `meeting-minutes`、`coffee-market`（有 `sampleFile`）和 `selection-meeting-minutes`（无 `sampleFile`）。本 PR 在实现后测到的注入字符数（完整 `officecli-docx` 原文 43 199 B；精简指南 2 741 B）：

| 会话 | 注入字符数 | 说明 |
| --- | --- | --- |
| `meeting-minutes` | 6 313 | 精简指南 + 案例 + meeting-recap |
| `coffee-market` | 10 501 | 精简指南 + 案例 + research-writer |
| `government-notice` | 6 602 | 精简指南 + 案例 + gov-doc 入口 |
| `selection-meeting-minutes` | 43 209 | 仍注入完整 officecli-docx |
| Word 无案例 | 42 758 | 仍注入完整 officecli-docx |

| 路径 | 注入 foundation | 禁止出现 | 工具顺序文案 |
| --- | --- | --- | --- |
| Word + 案例 + 非空 `sampleFile` | `guides/office-docx-template.md`（≤ 8KB） | Incremental execution / Visual delivery floor / Delivery Gate | `office_template` → `office_template_write` → 交付 |
| Word 无案例，或案例无 `sampleFile` | 完整 `officecli-docx` | — | 无 `sampleFile` 时写明不能 `office_template`、走配方（较慢） |
| Excel | 不变，仍是 `officecli-xlsx` | — | 不变 |

改注入文案会触发旧会话的 `OFFICE_FORMAT_UPDATED` 替换（指纹仍是 `mode:templateId@revision`）。允许守卫失败后的**一轮**修复，不要把一次 `needs_revision` 判成失败。

本阶段不测墙钟秒数，只数注入形状和工具轨迹。

## Phase 1 自动验收

- 精简指南写清：模板顺序、版式来自原件、write 成功后默认不做 `office_render` / screenshot、业务自检（如 `validate-minutes`）仍可在交付前调用。
- 无模板 / 无 `sampleFile` 的 Word 仍含 OfficeCLI Incremental / Visual delivery floor / Delivery Gate。
- `OFFICE_FILE_DELIVERY_SUFFIX` 与模板路径方法要点不再把 `view screenshot` 写成交付前置。
- 业务技能不再写「阶段 08 尚未接入 / 先用 set/batch」。`test` 上这句在实现前已经不在技能正文里；本轮清的是「先 load_skill / 默认视觉环」的残留。
- Selection 样例：catalog 与首页/已附卡片标明「无原生样例 → 配方路径」；不补 `example.docx`，不改生成行为。

## 人工 / agent 轨迹（建议 `meeting-minutes`）

1. Office 首页选会议纪要，做同款。
2. 期望：`office_template` → 一次 `office_template_write` →（按需 `validate-minutes`）→ 交付。
3. write 成功且守卫通过后，默认不应再出现 OfficeCLI 编辑命令、`officecli view screenshot` 或 `office_render`。
4. 用户说「再检查排版」，或故意弄坏 layout 触发 `needs_revision` 后，允许一轮视觉 / 重写。
5. 抽看 coffee-market、government-notice 成品观感，不要求好于改前，但不能明显变差。
6. 7 项宿主守卫与 `needs_revision` 行为与阶段 08 相同，见 [selection-3.2-office-stage-08.md](selection-3.2-office-stage-08.md)。

## 明确不做（本 PR）

Phase 2 硬拦 OfficeCLI 写入、Phase 2.3 从零写覆盖层、Phase 3 给 Selection 样例补 `sampleFile`、Excel / PPT 体感、删除 OfficeCLI、引入 LibreOffice Kit、放宽 7 项守卫。
