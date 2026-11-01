# 阶段 13 验收记录：PPT 工作流、预检和流式交付守卫

对应 [#716](https://github.com/0-CHENAI/Selection/issues/716)，并补上 [#711](https://github.com/0-CHENAI/Selection/issues/711) 留下的缺口：流式最终答复也要走 Office 交付守卫。对照表在 `apps/electron/resources/skills/ppt-design/references/dsh-ppt-parity.md`。

## 代码入口

| 能力 | 入口 |
| --- | --- |
| 连续同版式提醒 | `engine/check.ts` 的 `layout_repetition`，连续 3 页，warning |
| 其余预检 | `cover_focus`、`chart_data`、`chart_series_color`、`image_fit`、`image_crop`、`remote_image`、`missing_asset`、`text_drift`、`text_occlusion` |
| 导出硬门 | `exportDeck` 和增量导出：有 error 则 `needs_revision`，不把文件标成就绪。warning 仍导出 |
| 模型看图 | `office_render`。轮次和 PNG sha256 记在 `data/visual-qa.json`，第 3 轮起提示停止 |
| 路由 | design-plan 的 `路由:`。`office_edit` 下再整套导入，宿主返回「路由提醒」，不是会话失败 |
| 选模板 | `references/template-picking.md`。系统提示没有加字 |
| 流式守卫 | `SessionManager.commitDraftAnswer`。未通过时把 `needs_revision` 送回模型，修正后才提交 |

`profile: example` 的已出版参考页不跑新增提醒，避免把历史成稿判成未通过。error 仍然生效。Selection 原有的对比度、孤字和瀑布不轧平保留。

## 验收命令

```bash
bun test apps/electron/resources/skills/ppt-design/engine/preflight.test.ts \
  apps/electron/resources/skills/ppt-design/engine/argument-layouts.test.ts \
  apps/electron/resources/skills/ppt-design/engine/deck.test.ts \
  packages/server-core/src/services/ppt-route.test.ts \
  packages/server-core/src/sessions/answer-delivery.test.ts -t "holds a streamed answer"
```

| 案例 | 结果 |
| --- | --- |
| U2 方向 | 路由测试：`office_edit` 时 `deck-cli import` 得到提醒；`check` 不提醒 |
| U4 | 连续 3 页 `trend` 出现 `layout_repetition` warning，导出状态仍是 ok。改掉一页后提醒消失。14 个论证版式仍能识别 |
| U5 | 图表序列比类别短时 `chart_data` 为 error，不写出 PPTX。补齐列后导出 |
| 流式守卫 | 自然流式答复在 Word 文件读不出来时不提交，下一轮提示含 `needs_revision`。文件不再算作改动后，修正稿才提交 |
| U1 / U3 | 理解步骤写在技能里。OCR 拦截沿用 `ppt-visual-qa-policy` 和 `office-tool-policy`，并覆盖 `office_render` 的结果说明。本阶段没有真实模型跑外来稿 |

## 本阶段明确不做

- 不把 dsh 的 YAML 工程码逐个搬进 Selection。语法问题仍由 deck.json 的 `schema` 一次报完。
- 不在 `system.ts` 里加 PPT 说明。那里只剩约 7 个 token。
- 不改个人办公文档类型（合同、简历、报价单、预算表）。
- `answer-delivery.test.ts` 里「linked OfficeCLI outputs」是已知偶发失败，本阶段没有改那个用例。
