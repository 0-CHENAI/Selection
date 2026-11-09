# 阶段 11 验收记录：个人模板变成可编辑工程

对应 [#714](https://github.com/0-CHENAI/Selection/issues/714)，父规划 [#703](https://github.com/0-CHENAI/Selection/issues/703)。对照 dsh-desktop `588412b` 的个人模板规则，产出仍是 deck.json。不移植演示引擎，不打包 LibreOffice Kit，不内置 Python。

## 代码入口

| 能力 | 入口 |
| --- | --- |
| 上传时保留原件，并在需要时生成 `project/` | `packages/server-core/src/services/ppt-library.ts` 的 `materializeTemplateProject` |
| 复制到工作区、逐文件 sha256、样例扩展 | `packages/server-core/src/services/ppt-template-project.ts` 的 `createTemplateTaskProject` |
| 会话工具 | `ppt_template_create_project` |
| 卡片上的保真 / 近似 / 不支持 | `PptTemplate.diagnostics`，只显示中文计数，不显示英文 id |
| 草稿 | `ppt-templates/drafts/`，超过 24 小时由 `cleanupTemplateDrafts` 删除 |
| 页数 | 工程最多 40 页 |

源 PPTX 或 deck.json 不改写。删除模板不影响已经复制出去的任务工程。旧记录没有 `project/` 时，下一次打开目录或调用工具会补上，原件仍在。

转换诊断有「不支持」时，卡片写「有对象需要人工复核」。母版连续同一版式只走阶段 13 的提醒，不拦截。

## 验收命令

```bash
bun test packages/server-core/src/services/ppt-template-project.test.ts \
  packages/server-core/src/services/ppt-library.test.ts \
  apps/electron/src/renderer/components/ppt/TemplateGallery.test.tsx
```

| 案例 | 结果 |
| --- | --- |
| PT1 方向 | 3 页公司模板复制后，原件 sha256 不变，副本带页面清单。逐页看图用 `office_render`，最多 3 轮，本阶段没有真实客户稿，所以没有声称看过母版 logo。 |
| PT2 | 同一字节再次上传复用同一 id。删除模板后，已复制的工程还能打开。 |
| PT3 | 模板写在用户数据目录 `ppt-templates/`，重启和新会话读的是同一目录。 |
| 样例 | `writeSampleExtension` 只写 `sample-extension/`，拒绝逃出工程。 |

## 本阶段明确不做

- 不跨设备同步个人模板。
- 不把中途上传的 PPTX 登记成个人模板。
- 不覆盖十六套随包 `deck.json`。
