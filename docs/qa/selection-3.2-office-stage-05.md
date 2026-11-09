# 阶段 05：Word / Excel 模式与案例 / 技能注入

对应 [#708](https://github.com/0-CHENAI/Selection/issues/708)，父规划 [#703](https://github.com/0-CHENAI/Selection/issues/703)。实现落在 OfficeCLI + TypeScript 上。不打包 LibreOffice Kit，不内置 Python，不移植 PPTD。

阶段 02（#705 / #722）、阶段 03（#706 / #720）和阶段 04（#707 / #721）已合并。渲染入口按 `native-plan` 的原生优先顺序选步骤：PDF 先 exporter、再 Word、再 Electron `printToPDF`；预览在 Windows 且有 Word 或 PowerPoint 时用 OfficeCLI `--render native`，否则用 `capturePage`；公式先写回 OfficeCLI 的 `computedValue`，探测到 Excel 时再 `CalculateFull` 复核。当前进程没有接上这些宿主，所以不会真的去调用 Word 或 Excel。

## 代码入口

| 能力 | 入口 |
| --- | --- |
| 协议 | `packages/shared/src/protocol/office.ts`。`OfficeRequest` 是一轮里的选择；`OfficeDocumentState` 写在会话元数据，和 NORM / PRO 分开 |
| 案例目录 | `apps/electron/resources/skills/office-business/catalog.json` 的 `templates`。`cases` 里的三份虚构小样没有改 |
| 目录、revision、预览路径、选择 | `packages/server-core/src/services/office-catalog.ts` |
| 会话命令 | `SessionCommand` 的 `officeTemplates`，请求体超过 16 KB 拒绝 |
| 注入 | 发送消息时，和 `pptSendOptions` 同一层。指纹是 `word` / `excel` 加上 `id@revision` |
| 业务技能 | `apps/electron/resources/skills/<slug>/SKILL.md`。模型目录和用户显式调用都能看到。正文是入口，完整方法留到阶段 07 / 09 |
| 渲染 | `packages/server-core/src/services/office-render.ts`，顺序来自 `office-render-poc/native-plan.ts` |

同一会话同一时刻只有一种文档模式。切到 PPT 时，Word / Excel 注入换成「输出格式已按当前会话选择更新。」PPT 成稿技能仍是 `ppt-design`，不把 `officecli-pptx` 当成模式技能。中途上传的文件记作用户材料，不改 `templateId`。

侧边栏只有一个「Office」入口，不再展开 PPT / Word / Excel。中间的历史列表把这三类会话放在一起，每行有一个小的类型图标。主区域空白页在输入框上方切换 PPT、Word、Excel；`ppt`、`office`、`office/ppt` 打开 PPT，`office/word` 和 `office/excel` 打开对应分区。只提供旧 id `nav:ppt` 的侧边栏定义仍会落到 Office 这一项。

## 验收

```bash
bun test packages/server-core/src/services/office-catalog.test.ts \
  packages/shared/src/sessions/__tests__/office-persistence.test.ts
```

固定案例：

| 案例 | 预期 |
| --- | --- |
| M1 | Word + `meeting-minutes@20261012.1` 的第一轮含 office-docx 指南、该 revision 和 `meeting-recap`；连续五轮只有一条注入 |
| M2 | 切到 Excel + `annual-business` 后，旧注入换成更新提示，新注入含 `saas-metrics-coach` |
| M3 | Word 模式中途上传 `会议记录.txt` 仍是用户材料，案例 id 和 revision 不变 |
| M4 | 伪造 revision 被拒绝；请求体超过 16 KB 被拒绝；目录 revision 变了之后，旧会话得到「需要重新选择」 |

刷新和重启后，会话里的模式、revision 和注入指纹一致。压缩若丢掉注入消息，会按同一个指纹补回一条，不会把它当成切换。

## 留给后面的阶段

- 把 Electron `printToPDF` / `capturePage` 和本机 Word / Excel 接到 `setOfficeRenderHosts`。顺序已经定了，这一步只接宿主。
- 阶段 06：选择器界面。本阶段没有界面。
- 阶段 07 / 09：搬入案例文件和业务技能正文。现在的技能文件只是入口，文件交付后缀已经按 OfficeCLI、Bun CLI 和可插拔 `officeRender` 写好。
- 阶段 08：`office_template` / `office_template_write`。注入里写了这个顺序，并说明接入前用 OfficeCLI 改工作区副本。
