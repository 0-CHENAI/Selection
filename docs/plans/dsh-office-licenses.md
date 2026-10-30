# dsh Office 许可审计（588412b）

对照提交 `588412b9002fcb3ac88751fab7915e050c965563`。本页是 #704 的许可结论和将来 `NOTICE` / `ATTRIBUTION` 的增量草案。本阶段不改 `ppt-design` 的 NOTICE、ATTRIBUTION 或任何模板原页。逐文件证据在 [dsh-office-inventory.json](dsh-office-inventory.json) 的 `license` 与 `licenseEvidence`。

## 总结

| 结论 | 数量 | 含义 |
| --- | ---: | --- |
| MIT | 243 | 技能 LICENSE、ppt-runtime core/adapter、dsh-image-generation、dsh-skill-office、dsh-office-to-pdf，以及 `dsh-desktop-office` 包级声明覆盖的代码和多数案例 |
| MPL-2.0 | 46 | LibreOffice Kit 0.1.3 的六个包，以及小于 2 MB 的元包内部文件 |
| Apache-2.0 | 5 | `research-writer` 的两个文件，加上 `upstream/html-anything` |
| NOASSERTION | 99 | 没有许可证文件，或不能把仓库根 MIT 当成内容许可。包括 gov-doc-writing 全部 11 个文件、government-notice 全部 3 个文件、PPT 模板种子和若干说明文档 |

「准备搬入」只表示以后阶段可以搬，而且必须带上本页的条件。本阶段一个文件都没搬。

## 业务技能

| 技能 | 许可证文件 | SPDX | 版权行 | 可否随 Selection 分发 |
| --- | --- | --- | --- | --- |
| meeting-recap | `LICENSE` | MIT | meeting-minutes contributors（2026） | 可以。原样保留许可文件。该文件以 Markdown 代码围栏开头，搬入时不要「整理」掉围栏 |
| work-report-writer | `LICENSE` | MIT | weekly-report-generator contributors（2026） | 可以，原样保留 |
| saas-metrics-coach | `LICENSE` | MIT | Abbas Mir（2026） | 可以，原样保留。三个 `.py` 是否原样执行由 #706 决定 |
| dataset-health-audit | `LICENSE` | MIT | data-quality-checker contributors（2026） | 可以，原样保留。Python 同上 |
| data-viz-gen | `LICENSE` | MIT | infographic-builder contributors（2025） | 可以，原样保留。Python 同上 |
| research-writer | `LICENSE.txt` | Apache-2.0 | 仍是模板句 “Copyright [yyyy] [name of copyright owner]”，没有填版权人 | 可以按 Apache-2.0 分发并保留 LICENSE.txt 与 SKILL.md 里的来源说明。SKILL.md 写明原文是 ComposioHQ/awesome-claude-skills 的 content-research-writer，正文有中文翻译 |
| gov-doc-writing | 无 | NOASSERTION | 无 | 不可以复用其技能正文、模板文本或示例。见下一节 |

dsh `docs/office-template-sources.md` 还写到：meeting-recap、work-report-writer、saas-metrics-coach、dataset-health-audit、data-viz-gen 来自用户提供的技能归档；research-writer 来自上述 Apache-2.0 仓库；gov-doc-writing 是用户提供的 WorkBuddy 技能 2.0.4。归档压缩包本身不在本提交里。Kimi 官方发布身份，dsh 自己的来源说明也写成仍待核实，本审计不补这个身份。

`dsh-desktop-office/package.json` 的 `license` 是 MIT，包根没有 LICENSE 文件。仓库根 LICENSE 是 MIT，版权 DataElement（2026）。包级 MIT 覆盖该包里没有单独许可证、也没有被 catalog 标成用户样例的代码和案例。它不覆盖 gov-doc-writing，也不把 government-notice 的公文原文变成可分发材料。

## 公文写作：LinNai 已答复

2026-10-30 20:41（北京时间），LinNai 在 #704 评论中决定：**允许公文写作能力，不照搬原文。**

dsh 的 `gov-doc-writing` 没有许可证文件。Selection 不复制技能正文、七册 Markdown、配套素材库或 government-notice 的 DOCX 文本。阶段 #710 在 Selection 里自写技能，能力范围对齐到：

- 文种识别：通知、请示、报告、函、纪要等
- GB/T 9704 版式要素：版头、主体、版记、字体字号、行距、页边距
- 行文规范与用语、结构模板、交付前格式自检

验收用 dsh 案例做能力参照：输出要满足同样的格式和结构，不使用同样的句子。来源说明固定为「能力参照 dsh-desktop gov-doc-writing，未复用其内容」。

这不是「仅本地使用、不得分发技能」，也不是「同意原样再分发 dsh 文本」。自写技能可以随 Selection 分发；dsh 原文不可以。

`government-notice` 的 catalog 文案是「用户提供的 2025 年公文生成样例」。`example.docx` 为 18,457,553 字节。design.md 写明它与用户源文件字节一致，并含嵌入字体。处理方式是不搬。阶段 #710 若需要公文样例，另写不含该原文的结构夹具。

## 七个案例里其余五项

| 案例 | 包级许可 | catalog 用语 | 搬入条件 |
| --- | --- | --- | --- |
| meeting-minutes | MIT | 未使用「模拟数据 / 示例文稿 / 用户提供的样例」。用户 2026-10-12 认可的成品，底稿来自飞书官方演示后重整理 | 原样搬 `example.docx`、`design.md`、`preview-checks.json`。清单 sha256 以 `b301c5e5…` 为准，不要用 dsh 文档里过期的 `b6183bbe…` |
| coffee-market | MIT | 以公开披露为基础。四张 PNG 是随包图表 | 原样搬。公开披露不等于这些 PNG 和正文可以脱离案例许可再授权 |
| equity-research | MIT | 「示例文稿」 | 原样搬案例文件。示例公司材料仍按案例资产使用，不抽成通用素材 |
| annual-business | MIT | 「模拟数据」 | 原样搬，含 `example.xlsx` 与 `design.md` |
| port-cargo | MIT | 模拟装卸记录 | 原样搬，含 `checks.json` 与 `inputs/port.json` |
| bio-assay | MIT | 模拟孔位 | 原样搬，含 `checks.json` 与 `inputs/bio.json` |

搬入后的工具只写工作区副本。案例原件的 sha256 必须保持清单中的值。

## 引擎、运行时和 PPT

| 资产 | 许可 | 分发注意 |
| --- | --- | --- |
| `packages/ppt-runtime/core` 与 `adapter` 的 LICENSE | MIT，版权 DeepSeek and WorkBuddy PPT contributors（2026） | README 写明：手头是提取后的 JavaScript，重命名不改变来源，也不构成法律清理。任何搬运必须连同 `THIRD_PARTY_NOTICES.md` |
| `upstream/zara` | MIT，版权 Zara Zhang（2026），`beautiful-html-templates@e5e204fb` | O3 已转入 Selection。本阶段不覆盖原模板 |
| `upstream/html-anything` | Apache-2.0，THIRD_PARTY_NOTICES 指向 `nexu-io/html-anything@c312045` | 同上 |
| `scripts/ppt/base-templates` 与建成前的页文件 | NOASSERTION | 仓库根 MIT 不能写成全部模板的许可。retained-native、Zara、HTML Anything、DSH 自写的区分以 THIRD_PARTY_NOTICES 和 Selection 现有 ATTRIBUTION 为准 |
| `excluded-assets.json` | 随 ppt-runtime | 23 套撤回模板和 345 张预览的哈希清单。这些作品不得重新分发 |
| `dsh-image-generation` | MIT，版权 DataElement（2026） | 生图改写落地时保留 LICENSE。Cordis 壳不搬 |
| `dsh-skill-office`、`dsh-office-to-pdf` | MIT，版权 DeepSeek（2026） | 不 vendoring。格式指南用 Selection 已有 OfficeCLI 技能 |
| LibreOffice Kit 0.1.3 六个包 | MPL-2.0 | 元包 LICENSE 是 Mozilla Public License 2.0。原生包内有 `licenses/LibreOffice-MPL-2.0.txt` 和 `licenses/DeepSeek-Harness-MIT.txt`。NOTICE 说明字体名数据来自 LibreOffice Core `unotools/source/misc/fontdefs.cxx`（`bce0998afefdbc355585ca324285661a2170ba77`），该文件同时带 MPL-2.0 和 Apache-2.0 声明。没有 linux 原生包；wasm 包声明 `os: linux`。是否打进安装包、源码提供义务和体积由 #705 决定。决定之前不分发 |

ppt-runtime 的第三方声明还区分：三套 retained-native 来自 DSH 贡献 `de281a1`；Engineering Blueprint 与 Course Workshop 改编 HTML Anything；Editorial Notebook 为 DSH 自写；十套改编 Zara。这些事实 O3 的 ATTRIBUTION 已经记录。本阶段不改那份 ATTRIBUTION。

## 将来 NOTICE / ATTRIBUTION 增量草案

下面这段给 #710、#712、#715 和 #718 用。本阶段不写入 `apps/electron/resources/skills/ppt-design/NOTICE` 或 `ATTRIBUTION.md`。

```text
Office 案例与业务技能（dsh-desktop 588412b9002fcb3ac88751fab7915e050c965563）

- meeting-recap：MIT，Copyright (c) 2026 meeting-minutes contributors。保留 LICENSE 原文。
- work-report-writer：MIT，Copyright (c) 2026 weekly-report-generator contributors。
- saas-metrics-coach：MIT，Copyright (c) 2026 Abbas Mir。
- dataset-health-audit：MIT，Copyright (c) 2026 data-quality-checker contributors。
- data-viz-gen：MIT，Copyright (c) 2025 infographic-builder contributors。
- research-writer：Apache-2.0。保留 LICENSE.txt。原文为 ComposioHQ/awesome-claude-skills content-research-writer；Selection 使用的是 dsh 中的中文译本。LICENSE.txt 的版权行在上游仍未填写。
- 公文写作：能力参照 dsh-desktop gov-doc-writing，未复用其内容。不包含该目录下的技能正文、分册、素材库或 government-notice 示例文本。
- Word 案例 meeting-minutes、coffee-market、equity-research 与 Excel 案例 annual-business、port-cargo、bio-assay：随 dsh-desktop-office 的包级 MIT（仓库根版权 DataElement，2026）搬入。原件 sha256 见 docs/plans/dsh-office-inventory.json。government-notice 不在搬入之列。
- 若 #705 采纳 LibreOffice Kit：以 MPL-2.0 分发，保留各包 LICENSE、NOTICE 与 licenses/ 下的 LibreOffice 与 DeepSeek 声明，并履行 MPL 对可执行文件的源码提供义务。字体名数据的 Apache-2.0 部分一并保留。
- 若再搬运 ppt-runtime 的代码或模板：保留 core/THIRD_PARTY_NOTICES.md。重命名不构成法律清理。excluded-assets.json 列出的撤回作品不得重新加入。
```

草案里的项目在对应阶段落地时改成当时的真实路径。没被搬入的项目不要写进已发布的 NOTICE。
