# Selection 3.2 Office 对齐基线（dsh 588412b）

对应 [#704](https://github.com/0-CHENAI/Selection/issues/704)，父规划 [#703](https://github.com/0-CHENAI/Selection/issues/703)，里程碑 Selection 3.2。本文取代「dsh 没有可搬 Word/Excel 案例」这一过期判断，作为阶段 02–15 的唯一对照基线。它不改变运行时，也不开始搬代码。

2026-10-30 起，Office 对齐不再沿用 O0 / O5 的 `8dec631`。历史结论保留在原文里，更正见本文，以及 [O5 记录](../qa/selection-3.2-office-o5.md) 和 [O0 基线](selection-3.2-office-baseline.md) 文末。#683、#688 的后续说明应引用这三处，不改原 Issue 正文。

## 冻结范围

| 项 | 值 |
| --- | --- |
| dsh-desktop | `588412b9002fcb3ac88751fab7915e050c965563`（2026-10-28 11:16 +0800，`main` 上的该提交） |
| Selection 开工 | `test` / `office-align-3.2` 均为 `308a52ac408be000a03fd1e2ce62ba21d9c0bbe4` |
| 旧快照 | `8dec631777c34fbbcc7d45af787bdd2c468d2cfb`（2026-09-15）。只用于复现旧结论，不再作为规划依据 |
| 口径 | 只读源码与 git blob。没有运行 dsh，没有模型端到端，没有把资产拷进 Selection |

dsh 仓库只允许克隆到临时目录做对照，不要向 `0-CHENAI/dsh-desktop` 推送。后续阶段引用同一提交。搬入文件时用清单里的 sha256 校验，发现漂移另开 Issue，不悄悄改基线。

发布门槛（PPT、Word、Excel、共享底座各 ≥90%）由 #717 实测，剩余差距需 LinNai 书面确认。本阶段不测对齐百分比。

## 清单怎么再生

```bash
bun scripts/dsh-office-inventory.ts \
  --repo /path/to/dsh-desktop \
  --commit 588412b9002fcb3ac88751fab7915e050c965563 \
  --out docs/plans/dsh-office-inventory.json \
  --markdown docs/plans/dsh-office-inventory.md
```

哈希是 git blob 的 SHA-256，与 `git show 588412b:<path> | sha256sum` 一致。同一提交再跑，JSON 与 Markdown 应与仓库里的文件逐字节相同。`packages/dsh-desktop-office/` 在 `8dec631` 上的条目数为 0。

| 产出 | 位置 | 谁用 |
| --- | --- | --- |
| 本页 | `docs/plans/selection-3.2-office-dsh-parity-baseline.md` | 全部阶段引用同一 dsh 提交 |
| 机器清单 | [dsh-office-inventory.json](dsh-office-inventory.json)（393 条，含 sha256） | #710、#712、#717 校验搬入文件 |
| 人读全表 | [dsh-office-inventory.md](dsh-office-inventory.md) | 按路径查类别、语言、许可、阶段、处理方式 |
| 许可审计与 NOTICE 草案 | [dsh-office-licenses.md](dsh-office-licenses.md) | #710、#712、#713、#718 |

393 条里，`packages/dsh-desktop-office/` 有 73 条。阶段 14（#717）不对应某份 dsh 源文件，它消费本清单做对齐度量。

处理方式合计：不搬 163，决策后再定 143，原样搬 46，改写 41。许可合计：MIT 243，NOASSERTION 99，MPL-2.0 46，Apache-2.0 5。差距标记：1 有 63，2 有 9，3 有 4，4 有 99，5 有 79，对照 139。

## 为什么旧结论不成立

`8dec631` 比 `588412b` 落后 256 个提交。当时 git 里没有 `packages/dsh-desktop-office/`，也没有 `packages/harness-0.2.0-rc.2`（`dsh-skill-office`、`dsh-office-to-pdf`、`libreoffice-kit` 0.1.3）。Word / Excel 是之后才进 dsh 的：10-02 安装级 Python，10-13 统一 PPT / Word / Excel 模板流程，10-14 保留原生 Word 模板版式。

在 `8dec631` 上重跑清单脚本，`dsh-desktop-office` 相关条目为 0，`harness-0.2.0-rc.2` 也为 0。当时能看见的 Office 树主要是 `packages/ppt-runtime/templates`（640 个已跟踪模板文件）。`588412b` 不再把建成的模板页提交进 git：16 套 × 12 页的成品由构建从 `scripts/ppt/base-templates/` 展开，写到被忽略的 `.build/ppt-runtime/`。所以本清单里的模板种子少于旧快照，这不表示产品删了模板。O3 已经从 `8dec631` 转入 Selection 的 16 套原页，本阶段禁止覆盖。

## 七个案例

catalog 在 `packages/dsh-desktop-office/sources/catalog.json`。案例原件只读；以后的工具只写工作区副本。

| 案例 | 模式 | 业务技能 | catalog 来源 | 处理 | 阶段 |
| --- | --- | --- | --- | --- | --- |
| meeting-minutes | Word | meeting-recap | 用户 2026-10-12 认可的成品；底稿来自飞书官方演示后重整理 | 原样搬 | #710 |
| coffee-market | Word | research-writer | 以公开披露为基础的市场研究，不是「模拟数据」 | 原样搬 | #710 |
| equity-research | Word | research-writer | 「示例文稿」 | 原样搬 | #710 |
| government-notice | Word | gov-doc-writing | 「用户提供的样例」 | 不搬 | #710 只作能力参照 |
| annual-business | Excel | saas-metrics-coach | 「模拟数据」 | 原样搬 | #712 |
| port-cargo | Excel | dataset-health-audit、data-viz-gen | 模拟装卸记录 | 原样搬 | #712 |
| bio-assay | Excel | dataset-health-audit、data-viz-gen | 模拟孔位 | 原样搬 | #712 |

`meeting-minutes/example.docx` 的清单 sha256 是 `b301c5e5801c62887a44f26379bc71f6c60cbdd21f45db13d63543f88abe6575`。dsh `docs/office-template-sources.md` 写的 `b6183bbe83637defb3efe220fbfba6ddc9e5070a1e42aacf1168f9040f0deb5a` 与本提交文件不一致，以清单为准。

`government-notice/example.docx` 约 18.5 MB（18,457,553 字节），design.md 写明与用户源文件字节一致并含嵌入字体。不复制其文本。

## 七个业务技能

| 技能 | 许可 | 处理 | 阶段 |
| --- | --- | --- | --- |
| gov-doc-writing | 无 LICENSE（NOASSERTION） | 不搬原文。能力参照后在 Selection 自写 | #710 |
| meeting-recap | MIT | 正文与 LICENSE 原样搬；`validate_minutes.py` 等 #706 | #710 |
| work-report-writer | MIT | 原样搬 | #710 |
| research-writer | Apache-2.0 | 原样搬。版权行仍是未填写模板，见许可审计 | #710 |
| saas-metrics-coach | MIT | 正文原样搬；三个 Python 计算器等 #706 | #712 |
| dataset-health-audit | MIT | 正文原样搬；`data_quality_checker.py` 等 #706 | #712 |
| data-viz-gen | MIT | 正文原样搬；`build_infographic.py` 等 #706 | #712 |

公文写作的 LinNai 决定（2026-10-30 20:41，北京时间，#704 评论）：允许该能力，不照搬 dsh 原文。Selection 自写技能要覆盖文种识别（通知、请示、报告、函、纪要等）、GB/T 9704 版式要素（版头、主体、版记、字体字号、行距、页边距）、行文规范与用语、结构模板、交付前格式自检。验收用例只要求同样的格式与结构，不复制 dsh 文本。来源说明写「能力参照 dsh-desktop gov-doc-writing，未复用其内容」。

## 差距表 v2

评估页把差距收成五项。下表把每一项映射到阶段和清单里的文件。评估页里已经对齐、或 Selection 更强的项（16 套模板、deck 修订环、composition、三分路由、按页修订、防 OCR）标成「对照」，不在本阶段重做，也不删除。

| 差距 | 阶段 | 清单锚点 | 本阶段给出的处理 |
| --- | --- | --- | --- |
| 1. Word/Excel 案例和业务技能没搬 | #710、#712；目录合同给 #709 | `sources/` 七个案例目录、`business-skills/` 七个技能、`sources/catalog.json` | 有 MIT 或 Apache-2.0 且不是用户公文样例的案例与技能正文：原样搬。Python 脚本等 #706。gov-doc-writing 与 government-notice：不搬，能力对齐 |
| 2. 没有 Word/Excel 模式和案例选择器 | #708、#709 | `lib/modes.js`、`lib/business-skills.js`、`lib/templates.js`、`client.js`、`sources/catalog.json` | 按行为改写到 Selection 宿主。不搬 Cordis 插件入口 `index.js` |
| 3. 没有模板保真写入和交付守卫 | #711；运行时交叉 #706 | `lib/template-tool.js`、`lib/template-writer.js`、`lib/docx-workflow.js`、`lib/docx-layout.py` | 前三个用 OfficeCLI paraId 改写。`docx-layout.py` 等 #706 决定 Python 还是改写后再核对字体、样式、节、边框、表格、页脚 |
| 4. 外来稿 / 个人模板不能变成可编辑工程，没有图片槽 | #707、#713、#714、#715 | `core/lib/pptx-converter.js`、`imported-*-export.js`、`personal-template*.js`、`client/personal-template-manager.js`、`template-image-contract.js`、`dsh-image-generation` 的 `provider.js` / `writer.js` / `skills/generate-image` | 导入与 PPTD 承载先由 #707 决策。个人模板和图片槽按合同改写。不承诺动画、多媒体、SmartArt 还原 |
| 5. 没有内置渲染、PDF 和公式真重算 | #705、#706 | 六个 `libreoffice-kit` 0.1.3 包、`dsh-office-to-pdf`、`docs/office-runtime.md`，以及差距 1、3 里的 Python | 引擎与 Python 都是决策项。LibreOffice Kit 为 MPL-2.0。没有 linux 原生包，wasm 包的 os 为 linux |

五项之外、仍要有归属的文件：

| 内容 | 阶段 | 处理 |
| --- | --- | --- |
| `dsh-ppt` 技能、`validation.js`、`pptx-geometry-budget.js`、`text-wrap.js`、`scripts/ppt` 里的组合脚本 | #716 | 与现有 deck check / composition 逐条对照后改写 |
| `office-docx` / `office-pptx` / `office-xlsx`、`check_office.py` | #708、#712、#716 | 不搬。Selection 已有 OfficeCLI 指南和 validate |
| `ppt-runtime` 的 THIRD_PARTY_NOTICES、LICENSE、`excluded-assets.json`、已导入模板种子 | #718 | 声明随资产保留。撤回清单中的 23 套模板和 345 张预览不得重新分发。禁止覆盖 Selection 原模板 |
| 对齐度量本身 | #717 | 读本清单，不新增 dsh 源文件 |

`pptx-converter.js` 一类导入代码的处理方式是「决策后再定」，因为 #707 还没选择 PPTD 还是 deck.json。个人模板 UI 和图片槽合同是「改写」。不要把整包 ppt-runtime 理解成已经决定原样搬入。

## 引擎包体积（#705 的输入，本阶段不采纳）

| 包 | 字节 | 许可 |
| --- | ---: | --- |
| `deepseek-ai-libreoffice-kit-0.1.3.tgz` | 99,056 | MPL-2.0 |
| `deepseek-ai-libreoffice-kit-darwin-arm64-0.1.3.tgz` | 67,259,060 | MPL-2.0 |
| `deepseek-ai-libreoffice-kit-darwin-x64-0.1.3.tgz` | 68,944,127 | MPL-2.0 |
| `deepseek-ai-libreoffice-kit-win32-arm64-0.1.3.tgz` | 67,959,242 | MPL-2.0 |
| `deepseek-ai-libreoffice-kit-win32-x64-0.1.3.tgz` | 71,374,248 | MPL-2.0 |
| `deepseek-ai-libreoffice-kit-wasm-0.1.3.tgz` | 48,080,264 | MPL-2.0 |

六个包合计约 323 MB。没有 linux 原生包。

## 本阶段不做

- 不搬任何 dsh 代码、案例、技能或模板，不改 UI，不升级 OfficeCLI。
- 不覆盖 `ppt-design/styles/` 里的原始模板，不把样例写回原页。
- 不运行 dsh，不评价 dsh 的产品取舍。
- 不开始 #705–#718 的实现。

## 验收

固定样本 B1（10 个 git 路径，含 1 个 `.py`、1 个 `example.xlsx`、1 个 ppt-runtime lib）：

1. `packages/dsh-desktop-office/lib/docx-layout.py`
2. `packages/dsh-desktop-office/sources/legacy/bio-assay/example.xlsx`
3. `packages/ppt-runtime/core/lib/pptx-converter.js`
4. `packages/ppt-runtime/core/lib/validation.js`
5. `packages/ppt-runtime/core/skills/dsh-ppt/SKILL.md`
6. `packages/dsh-desktop-office/sources/catalog.json`
7. `packages/dsh-desktop-office/business-skills/gov-doc-writing/SKILL.md`
8. `packages/dsh-image-generation/lib/provider.js`
9. `packages/dsh-desktop-office/lib/template-tool.js`
10. `packages/dsh-desktop-office/sources/legacy/port-cargo/checks.json`

```bash
# 需要本机只读克隆。DSH_DESKTOP_REPO 指向 dsh-desktop 检出
DSH_DESKTOP_REPO=/path/to/dsh-desktop bun test scripts/dsh-office-inventory.test.ts
```

测试做三件事：清单字段与 #704 点名的路径齐全；上面 10 个文件的 sha256 等于 `git show 588412b:<path>`；在 `8dec631` 上 `dsh-desktop-office` 条目为 0。没有克隆时，字段与路径检查仍会跑，后两项跳过。

本地结果见本页末次更新：2026-10-30 在只读克隆上 B1、B2 与再生比对通过（命令即上式）。没有运行产品 UI、模型或 OfficeCLI。

## 交给下一阶段

#705 使用本清单里阶段 02 的条目：六个 LibreOffice Kit 包、`dsh-office-to-pdf`，以及 ppt-runtime 里预览和字体诊断文件。决策前不要把这些二进制打进安装包。Python 脚本的「决策后再定」留给 #706，不要在 #705 里顺手改写成 TypeScript。
