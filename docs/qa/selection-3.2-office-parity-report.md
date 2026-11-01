# Selection 3.2 Office 对齐报告

对应 [#717](https://github.com/0-CHENAI/Selection/issues/717)，父规划 [#703](https://github.com/0-CHENAI/Selection/issues/703)。对照 dsh-desktop `588412b9002fcb3ac88751fab7915e050c965563`。Selection 侧是集成分支 `office-align-3.2` 加上本报告所在改动。

对齐看用户能做的事和产物，不看是不是同一套技术栈。LibreOffice Kit、内置 Python、PPTD 按 #705–#707 不打包，不因此扣分。排除项不进分母。部分对齐记 0.5。度量脚本是 `scripts/selection-3.2-office-parity.ts`，行定义在 `scripts/office-parity/matrix.ts`。

## 百分比

| 领域 | 对齐 | 部分 | 未对齐 | 排除 | 计入 | 得分 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| PPT | 12 | 0 | 0 | 3 | 12 | 100% |
| Word | 17 | 0 | 0 | 2 | 17 | 100% |
| Excel | 9 | 1 | 0 | 2 | 10 | 95% |
| 共享底座 | 9 | 1 | 0 | 1 | 10 | 95% |
| 总体 | 47 | 2 | 0 | 8 | 49 | 98% |

总体是 48 / 49。两个「部分」各记半分。四个领域都不低于 90%。这是能力行的分数，不是把 dsh 的 393 个文件逐个算进去，也不是模型成稿的审美分。文件清单仍以 [dsh-office-inventory.md](../plans/dsh-office-inventory.md) 为准。

## 计分口径

一行是一件用户或模型能感知的事：选案例、写入、守卫、重算、预检、路由。dsh 用 Python 或 LibreOffice 做到的，Selection 用 OfficeCLI 和 TypeScript 做到，记为对齐。dsh 的内部限制（动画、SmartArt、OLE、EMF 不还原）按 Epic 的决定记为排除。无许可证的公文范文和口号库按 #704 记为排除，不靠复制原文去凑体积。

本轮补上的缺口：

- 公文技能补了六个参数、事务文种骨架和事实清单、六维与权重、S1–S6、脱敏和公开度、GB/T 15834 / 15835 的操作口径、病文改法。「你看着写」会先追问，不编事实。正文是 Selection 自写，测试禁止出现对方技能里的专有栏目名。
- 讲话稿、述职、方案、简报、对照检查会路由到公文技能。
- 会话工具 `office_business` 在应用进程里做纪要校验、SaaS 指标、Quick Ratio、单位经济、数据体检和信息图。安装包仍然不带 Python，也不把 `office-business-runtime` 目录打进 electron-builder。
- 注入文案不再写「阶段 08 尚未接入」。Word 指向 `office_template_write`，Excel 指向 `xlsx_recalculate`。

## 能力矩阵

### PPT

| 编号 | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| PPT-GALLERY | 内置模板库、按页预览，并在输入框附上所选模板 | 对齐 | `ppt-design/SKILL.md` |
| PPT-UNDERSTAND | 先定受众、结论、材料和页数，再动手改 | 对齐 | `references/workflow.md` |
| PPT-ROUTE | 定点修改、改版式、整套换风格；与导入冲突时只提醒 | 对齐 | `ppt-routing.ts`、`ppt-route.ts` |
| PPT-BRIEF | 外来 PPTX 先读结构摘要，原件不覆盖 | 对齐 | `selection-3.2-office-o4.md` |
| PPT-IMPORT | 导入为 deck.json，写不进的对象保留并诊断 | 对齐 | `import/pptx-to-deck.ts` |
| PPT-PERSONAL | 个人模板登记，并用 `ppt_template_create_project` 复制成任务工程 | 对齐 | `ppt-template-project.ts` |
| PPT-IMAGE | 配图槽合同、复用组、无提供方时的占位图，图内不写字 | 对齐 | 阶段 12 记录、`ppt-tools.ts` |
| PPT-PREFLIGHT | 连续同版式、封面焦点、图表、图片、缺素材、遮挡 | 对齐 | `preflight.test.ts` |
| PPT-GATE | error 不把 PPTX 标成就绪，warning 仍可导出 | 对齐 | 阶段 13 记录 |
| PPT-VISUAL | `office_render` 读图再改，同一文件最多三轮，禁止 OCR | 对齐 | `office-render.ts`、`office-tool-policy.ts` |
| PPT-FONT | 中西文字体按主题记号回退 | 对齐 | `dsh-ppt-parity.md` |
| PPT-MIDUPLOAD | PPT 会话中途仍可附加图片和文件 | 对齐 | `release-notes/next.md` |
| PPT-ANIM | 动画、SmartArt、OLE、EMF 解成可编辑对象 | 排除 | `pptx-to-deck-mapping.md` |
| PPT-ENGINE | 把 PPTD 或 YAML 工程码打进安装包 | 排除 | 阶段 13 记录 |
| PPT-SYNC | 个人模板跨设备同步 | 排除 | 阶段 11 记录 |

导入入口是 `deck-cli import`，不是单独的会话工具名。路由说明里写了这条命令，所以不另算缺失。dsh 的 `pptd_check` 还有一批工程语法码，Selection 用 deck.json 的 schema 一次报完，记在排除项 PPT-ENGINE。

### Word

| 编号 | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| WORD-CASES | 四个 Word 案例可预览并附到输入框 | 对齐 | `catalog.json` |
| WORD-PREVIEW | 协同面板只读打开样例，改动的副本按 sha256 恢复 | 对齐 | `office-case-preview.ts` |
| WORD-INJECT | 按案例 revision 注入，重复轮次不叠加 | 对齐 | `office-catalog.ts` |
| WORD-TEMPLATE | `office_template` 复制案例并返回段落，不改原件 | 对齐 | `office-template.ts` |
| WORD-WRITE | 按段落替换、追加并继承样式，受保护段落不能删 | 对齐 | `office-template.ts` |
| WORD-GUARD | 七项版式核对 | 对齐 | `docx-layout.ts` |
| WORD-STREAM | 流式最终答复也走交付守卫 | 对齐 | `SessionManager.ts` |
| WORD-MINUTES | 纪要结构校验，会话里用 `office_business` | 对齐 | `validate-minutes.ts` |
| WORD-SKILLS | 纪要、工作汇报、研究写作三份技能可注入 | 对齐 | `office-business-skills.ts` |
| WORD-GOV15 | 十五个法定文种的骨架 | 对齐 | `volumes/03-structures.md` |
| WORD-TXN | 讲话稿、述职、方案、简报、对照检查和事实清单 | 对齐 | `volumes/09-transactions.md` |
| WORD-PARAMS | 六个参数，以及「你看着写」时的追问 | 对齐 | `volumes/08-parameters.md` |
| WORD-SIX | 六维质检和权重 | 对齐 | `volumes/10-quality.md` |
| WORD-SAFE | S1–S6、脱敏、公开度 | 对齐 | `volumes/11-safety.md` |
| WORD-STD | GB/T 15834 与 GB/T 15835 的操作口径 | 对齐 | `volumes/12-standards.md` |
| WORD-FIX | 病文改法 | 对齐 | `volumes/13-corrections.md` |
| WORD-ROUTE | 口语路由到法定文种和上述事务材料 | 对齐 | `office-document-routing.ts` |
| WORD-CORPUS | 范文、金句、口号库和国标原文照录 | 排除 | `office-business/NOTICE` |
| WORD-EMBED | 把公文样例里的嵌入商用字体复制进每份新稿 | 排除 | 阶段 07 记录 |

dsh 的公文目录约 348KB。Selection 自写分册短得多。多出来的体积主要是不能搬的范文和口号。覆盖点按上表计，不按字节计。

### Excel

| 编号 | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| XLS-CASES | 三个 Excel 案例和预览区域 | 对齐 | `catalog.json` |
| XLS-METRICS | SaaS 指标、Quick Ratio、单位经济与脚本输出一致 | 对齐 | `stage09-parity.test.ts` |
| XLS-AUDIT | 数据体检 12 维 | 对齐 | 同上 |
| XLS-VIZ | 指名调色板的信息图，以及原生图表命令 | 对齐 | `data-viz-gen/SKILL.md` |
| XLS-RECALC | 公式写回缓存，未通过不能交付 | 对齐 | `xlsx-tool.ts` |
| XLS-CHECKS | 港口和荧光酶 checks 在容差内 | 对齐 | 阶段 09 记录；本报告又用 OfficeCLI 读过 |
| XLS-VISUAL | 纯公式不做视觉检查；格式、图表、打印要读图 | 对齐 | `office-template.ts` |
| XLS-PAGE | 年度经营副本用 A3；另两个案例不改打印区域 | 对齐 | 阶段 08 记录 |
| XLS-PERSONAL | 报价、预算、对账、项目计划、目标考核 | 对齐 | 个人办公记录 |
| XLS-CHART-CACHE | 图表缓存与 Excel CalculateFull 一致 | 部分 | 阶段 09：不重算图表缓存 |
| XLS-HASH | `palette=auto` 与 Python `hash()` 逐字节一致 | 排除 | Python 哈希带进程盐 |
| XLS-SAMPLE | `--sample` 与 pandas RandomState 同序列 | 排除 | 对拍不用这个参数 |

### 共享底座

| 编号 | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| SHR-MODE | PPT / Word / Excel 切换，与 NORM / PRO 分开 | 对齐 | 阶段 05 记录 |
| SHR-GALLERY | 首页卡片、预览、再点取消 | 对齐 | `OfficeCaseGallery.tsx` |
| SHR-PANEL | 协同面板只读打开样例 | 对齐 | 阶段 06 记录 |
| SHR-LOOP | 生成、读图、返工；修订期拦截 OCR | 对齐 | `office-tool-policy.ts` |
| SHR-RECALC | 公式重算不依赖 LibreOffice Kit | 对齐 | `office-render-recalc-path.md` |
| SHR-FONT | 列出本机没有的字体 | 对齐 | 阶段 08 记录 |
| SHR-HASH | 原件 sha256 不变 | 对齐 | `word-cases.test.ts` |
| SHR-PERSONAL | 十一类个人办公的路由 | 对齐 | `office-document-routing.test.ts` |
| SHR-PACK | 安装包不含 LibreOffice Kit、Python 办公运行时、PPTD | 对齐 | `no-python.test.ts` |
| SHR-CHART-HTML | Excel 浮动图表在 HTML 预览里的位置与 Excel 一致 | 部分 | 阶段 06 已写明差异；本报告的港口、荧光酶截图能看见 |
| SHR-PDF | 用户路径上的 PDF 导出 | 排除 | 系统提示仍写没有 PDF；阶段 06 记为延后。`system.ts` 只剩约 7 个 token，这次不加字 |

dsh 的案例画廊有单独的「做同款」和按工作表翻页。LinNai 定的是点卡片附上案例，预览进协同面板。功能在，交互不同，不扣分。

## 排除项

1. 不把动画、SmartArt、OLE、EMF 解成可编辑对象。导入时诊断并保留。#707。
2. 不移植 PPTD，不把 YAML 工程码搬进安装包。
3. 个人模板不同步到别的设备。
4. 不复制无许可证的公文范文、金句和口号，也不照录国标全文。
5. 不把 `government-notice` 里的嵌入字体扩散到其他单位的新稿。样例原件仍保留。
6. 信息图的 `palette=auto` 不用 Python 的进程哈希。指名调色板时结构要对上。
7. 数据体检的 `--sample` 不对拍 pandas 的随机序列。
8. 用户路径上的 PDF 导出仍按阶段 06 延后。PoC 的 `printToPDF` 没有接到用户操作上。

## 质量对比

没有调用模型。这台机器没有 dsh 的运行时，也没有 Word、Excel、PowerPoint。dsh `588412b` 不提交建成的 PPTX，所以 PPT 没有 dsh 成稿可并排。页图用 OfficeCLI 1.0.157 的 HTML，再用本机 Chrome 截图。看图不用 OCR。并排图在运行产物里：`word-minutes.png`、`word-gov.png`、`word-lease.png`、`excel-port.png`、`excel-bio.png`、`excel-personal.png`、`ppt-blue.png`、`ppt-cartesian.png`、`ppt-economy.png`。

公式用 OfficeCLI `get` 读 `computedValue`，对照案例里的 `checks.json`，容差 `1e-6`。港口四项和荧光酶五项都通过。例如港口总览 B6 的公式是 `SUM('日度汇总'!D8:D372)/10000`，值为 2516.8532。

### Word

- 会议纪要。左边是 dsh 样例「发布会筹备对齐会议纪要」，信息密、层次清楚。右边是 Selection 的确定性草稿「园区门禁改造会议纪要」：会议信息、工作安排、议题、行动项和待确认都在，原文人名没有写进来。行动表比样例疏，列在这一张 HTML 页里挤在一起。这是草稿生成器的样子，不是 `office_template_write` 按样例段落重写的样子。保真写入的七项核对另有测试，这次没有把整份样例再跑一遍写入后截图。
- 公文。左边样例有红色机关名、红色分隔线和居中的标题。右边城管通知也有红色机关名，事项分成主题、重点工作、组织和报送，空项写成待补充，没有把中国中车写进去。标题在「通」字后折行，版记挤在左下角，不如样例稳。这是新稿生成器的缺口，不是样例原件被改坏。
- 房屋租赁合同。dsh 没有这类。六条、租金表、待补充和免责声明都在一页里，页脚有页码。表头和金额完整。

### Excel

- 港口总览和荧光酶总览的文件与 dsh 案例是同一批字节，所以没有第二份「Selection 另画的一张」。HTML 预览里柱形图盖住了左侧部分指标，能看见的大数（港口 2.7 和 2,190，荧光酶图上的 8 和 10）没有缺字。被挡住的格子用 `get` 核对过，不靠这张图。这就是 SHR-CHART-HTML 记为部分对齐的原因。
- 家庭预算和设备报价是 Selection 的个人办公样例。报价表的价税合计是 170,856.00，列对齐。预算表有收入和支出，柱形图的类别轴是空的，图例仍是 Series 1。图表能画出来，标注没有做好。

### PPT

三份都是 Selection 从 deck.json 导出后再截第 1 页。dsh 成稿没有跑。

- `dsh-blue-professional`：标题「市场展望与战略优先级」完整，有短蓝线、副题和页码 01，右侧留白。克制，没有挤出页面。
- `dsh-cartesian`：标题「理性简报」和副题完整，右侧圆圈没有压住文字，页码 01。
- 中国经济数据简报：主标题、1401879 亿元和 5.0% 都完整，来源写在页脚，右侧装饰没有挡住数字。

截图底部的 NOTES 条是 OfficeCLI HTML 外壳，不是幻灯片内容。

### 没跑的

- 没有真实模型轨迹，也没有 API 密钥，所以不能报 token、耗时或模型是否真的调用了守卫。
- 没有启动 dsh 应用。Word / Excel 的对照用的是冻结提交里的样例文件。
- 没有用本机的 Word、Excel、PowerPoint 或 WPS 再打开。缺字替换只看了 HTML 页，这三份 PPT 和合同页上的中文没有方框字。港口单元格字体声明是 Noto Sans CJK SC。
- 图表缓存没有跟 Excel `CalculateFull` 比。

## 还没对齐的

计入分数的只剩两项，都是部分对齐：

- 原生图表缓存还没有跟装了 Excel 的机器核对。
- OfficeCLI HTML 里，Excel 浮动图表会挡住旁边的指标。协同面板和 `office_render` 是同一条 HTML，所以模型看到的图也有这个问题。原生高保真渲染按阶段 06 延后。

另外记下、但不进上面百分比的观感：

- 公文新稿生成器的标题折行和版记重叠。套用案例时应走 `office_template_write`，不要把这个生成器当成版式验收。
- 家庭预算样例的柱形图没有类别名。
- 纪要确定性草稿比样例疏，表格在 HTML 页里偏挤。
- PDF 导出仍不在用户路径上。
- 真机打开和真实模型回合留给装了 Office 的 macOS / Windows，以及有密钥的夜间运行。

## 怎么复跑

```bash
bun scripts/selection-3.2-office-parity.ts
bun test scripts/selection-3.2-office-parity.test.ts \
  packages/office-business-runtime/src/gov-doc-depth.test.ts \
  packages/server-core/src/services/office-business-tool.test.ts \
  packages/shared/src/skills/__tests__/office-document-routing.test.ts
```

页图脚本是 `scripts/selection-3.2-office-quality-render.ts`。它需要本机 OfficeCLI 和 Chrome，不进 CI。
