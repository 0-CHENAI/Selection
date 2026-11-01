# 阶段 07 验收记录（#710）

日期：2026-10-30。基线：dsh-desktop `588412b9002fcb3ac88751fab7915e050c965563`，集成分支 `office-align-3.2`。实现按功能对齐：OfficeCLI + TypeScript / Bun。不打包 LibreOffice Kit，不内置 Python。渲染路径仍以 #705 未拍板为准，本阶段不调用 PDF 后端。

## 代码入口

| 用途 | 位置 |
| --- | --- |
| 案例与目录 | `apps/electron/resources/skills/office-business/catalog.json` |
| 四个 Word 案例原件 | `apps/electron/resources/skills/office-business/cases/<id>/` |
| 业务技能 | `apps/electron/resources/skills/office-business/business-skills/` |
| 许可与来源 | 同目录 `NOTICE`、`ATTRIBUTION.md` |
| 纪要结构校验 | `packages/office-business-runtime/src/validate-minutes.ts` |
| 校验命令 | `bun packages/office-business-runtime/src/cli/validate-minutes.ts 会议纪要.md` |
| 案例草稿 | `packages/office-business-runtime/src/word-drafts.ts` |
| 结构签名 | `packages/office-business-runtime/src/case-signatures.json` |
| golden | `scripts/fixtures/office-parity/validate-minutes/` |

Selection 自编小样改到 `cases/selection-samples/`，id 为 `selection-meeting-minutes`、`selection-work-notice`，分类是「Selection 样例」。执行台账仍在 `cases/execution-tracker.json`。`scripts/selection-3.2-office-cases.ts` 改为读这些 recipe。小样是否最终删除，等 LinNai 确认；本阶段没有删。

## 公共约定

- catalog 保留 dsh 的 id、title、titleEn、description、prompt（咖啡案例本来就没有 prompt）、mode、sampleFile、revision、category、businessSkill、previewPages、source。Selection 字段放在 `selection.namespace = selection.office.v1`。
- 案例原件只读。草稿写到新的 DOCX，测试核对原件 sha256 不变。
- 技能里的「Desktop 文件交付」改为 Selection 文件交付：OfficeCLI `load_skill word`，未知项写待确认或待补充。`office_template` / `office_template_write` 与版式守卫写明属于阶段 08，当前用 `set` / `batch`。
- 公文技能自写，分册在 `volumes/`，入口写明何时读哪一册。来源句：「能力参照 dsh-desktop gov-doc-writing，未复用其内容」。
- `government-notice` 按 2026-10-30 22:52 的决定原样搬入。清单脚本仍会把它标成「不搬」，因为那是阶段 01 的再生结果；以 `docs/plans/dsh-office-licenses.md` 文末补充和本目录 NOTICE 为准。
- `office-business-runtime` 仍不进 `electron-builder.yml`，安装包不含这份 Bun 代码，也不含 Python。

## 验收命令与结果

```bash
bun test packages/office-business-runtime/src/validate-minutes.test.ts \
  packages/office-business-runtime/src/word-cases.test.ts \
  packages/office-business-runtime/src/word-assets.test.ts \
  packages/office-business-runtime/src/no-python.test.ts \
  packages/office-business-runtime/src/quick-ratio.test.ts
cd packages/office-business-runtime && bun run tsc --noEmit
```

2026-10-30 在本分支：上述测试 49 pass / 0 fail；`tsc --noEmit` 通过。

- 四个案例目录共 19 个文件，以及 meeting-recap、work-report-writer 的 LICENSE 和 research-writer 的 LICENSE.txt，sha256 与 #719 清单一致。
- research-writer 的 SKILL.md 在 `<!-- selection-delivery:start -->` 之前的字节与清单哈希一致。
- gov-doc-writing 下没有与 dsh 原文相同的 sha256，也不含其分册文件名和抽查用语。
- 业务技能目录没有 `.py`。`validate_minutes.py` 未搬入。18 个 golden 的报告 stdout 与退出码逐条一致，并用 Bun 进程复跑了通过样例。
- W1：新会议「园区门禁改造」产出纪要，含议题、讨论、已定、待确认和行动项表；`validateMinutes` 退出码 0。标题层级和三列表的样式序列与 example 一致，正文不含发布会样例里的人名。原件哈希仍是 `b301c5e5…`。
- W2：用 `coffee.json` 和 4 张 PNG 生成的 DOCX，标题、表格列数和图片顺序与 example 的结构签名一致；五条来源标题和固定成本 52000 来自输入；example 里的门店数 22340 没有写入。四张图的 sha256 与输入 PNG 一致。
- W3：按 `report-content.json` 重放时，章节、表格和 3 张图的位置与 example 一致，并带出来源标题与「41.11」。换成「北辰智行」后，结构签名不变，图仍在原位，正文不再出现小米汽车、小米集团和 41.11，缺事实处为待确认。
- W4：发文机关为「滨江市城市管理局」，版头使用该名称，页边距为 GB/T 9704 的 2098/1474/1984/1587 twip，保留待补充，不生成未提供的发文字号，不含中国中车与质量安全月。原件哈希仍是 `c763f627…`（18,457,553 字节）。

## 延后

- `preview-checks.json` 只做了解析。墨迹覆盖要读渲染后的页图。#705 未选定渲染路径，本阶段不调用 PDF，也不把这项记为通过。
- 固定验收里的「渲染成 PNG 后由模型读图」和「用 WPS / Word 打开截图」同样等待渲染路径，本环境也没有 Word / WPS。
- 阶段 08 的 `office_template` / `office_template_write` 与版式守卫没有实现。技能只写了接入后的用法。
- 阶段 05 的自动注入没有做。当前由 `office-business/SKILL.md` 指向业务技能，模型需要按索引去读。
- 纪要校验命令在仓库里可用，还没有打进桌面安装包。
- 确定性草稿证明了结构和事实边界。没有在真实模型会话里再跑一遍四个案例。
- 新公文稿的版头是可替换的红色文字。样例原件里的嵌入字体图片只留在未被修改的 example.docx 中。
