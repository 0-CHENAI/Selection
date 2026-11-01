# Selection 3.2 Office 对齐报告

对应 [#717](https://github.com/0-CHENAI/Selection/issues/717)，父规划 [#703](https://github.com/0-CHENAI/Selection/issues/703)。对照 dsh-desktop `588412b9002fcb3ac88751fab7915e050c965563`。Selection 侧是集成分支 `office-align-3.2` 加上 #742。

对齐看用户能做的事和产物，不看是不是同一套技术栈。LibreOffice Kit、内置 Python、PPTD 按 #705–#707 不打包，不因此扣分。排除项不进分母，部分对齐记 0.5。度量脚本是 `scripts/selection-3.2-office-parity.ts`，行定义在 `scripts/office-parity/matrix.ts`。每一行都要有仓库里的证据文件，脚本会检查文件和关键字还在。

## 百分比

| 领域 | 对齐 | 部分 | 未对齐 | 排除 | 计入 | 得分 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| PPT | 12 | 1 | 0 | 3 | 13 | 96.2% |
| Word | 19 | 0 | 0 | 2 | 19 | 100% |
| Excel | 11 | 1 | 0 | 2 | 12 | 95.8% |
| 共享底座 | 9 | 1 | 0 | 1 | 10 | 95% |
| 总体 | 51 | 3 | 0 | 8 | 54 | 97.2% |

总分是 52 / 54。四个领域都不低于 90%。这是能力行的分数，不是把 dsh 的 393 个文件逐个算进去，也不是模型成稿的审美分。文件清单仍以 [dsh-office-inventory.md](../plans/dsh-office-inventory.md) 为准。

#741 合入后，PPT-IMAGE 转为对齐，PPT 升到 96.2%，总体升到 97.2%。

## 这次从严改了什么

第一版矩阵给了 PPT 100%、总体 98%。复核时对着 dsh 588412b 的代码和实际产物重看了一遍，改了下面几处：

- **PPT-IMAGE 从对齐改为部分。** dsh 的 `dsh-image-generation` 能接 bytedance Ark Seedream 和 OpenAI Images，设置页保存前会校验密钥。Selection 这边只有配图槽和占位图。真出图在 #741。
- **新增 PPT-TEMPLATE-READY，记部分。** 用 `deck-cli check --platform mac` 把 16 套 dsh 风格模板原样跑了一遍。dsh-signal、blue-professional、cartesian、editorial-notebook、soft-editorial 通过。其余 11 套被孤字、对比度、色块相交或文本框容量判成 needs_revision，在 Selection 里要模型先改一轮才能导出。dsh 用同一批模板直接出稿。
- **PPT-TEMPLATE-READY 改为对齐（逐套修模板，不放宽检查）。** 复查发现上面那次跑的是 `styles/<id>/` 下按字节冻结的原导入页。其中 9 套 catalog 早已指向 `styles/examples/imported/` 或 `styles/_archive/imported/` 下修过的参考页，预检本来就干净。真正还会被交给模型的只剩两处：默认套 `dsh-course-workshop` 第 3 页 `t7`「从引导练习走向独立完成」和 `dsh-engineering-blueprint` 第 3 页 `t101`「明确每一层边界」，末行只剩一个字。现在这两套也走同一个适配脚本，参考页另存到 `styles/examples/imported/<id>/`，只改断行（「从引导练习／走向独立完成」「明确／每一层边界」），字号和框都不变，catalog 改指向新参考页。复测：16 套 32 份 catalog 参考页 `deck_check` 全部 0 问题，`render --platform mac` 和 `--platform win` 64 次全部 ok。
- **SHR-CHART-HTML 仍是部分，但原因换了。** 原来的问题是 OfficeCLI 只认 `xdr:twoCellAnchor`。dsh 案例是 openpyxl 写的 `oneCellAnchor`，于是三张图都叠在 A1，按 400×250pt 画，盖住了指标。#742 按工作簿锚点改写浮动层，再按实际行高和列宽对齐。港口、荧光酶、家庭预算已经不挡指标。剩下的问题是 HTML 列宽比 Excel 窄，年度经营总览的日新增图会压住右侧季度表的两列。
- **新增 XLS-AUDIT-XLSX。** dsh 的 `data_quality_checker.py` 用 `pandas.read_excel` 直接读 xlsx，Selection 原来只收 CSV。现在 `office_business` 的 data-quality 可以直接读 xlsx，并能指定 sheet 和 range。
- **新增 XLS-EDIT-RECALC。** 跑质量对比时发现一个真问题：OfficeCLI 1.0.157 每条命令都会自动起常驻进程，`set` 的改动几秒后才落盘。模型改完输入格马上调 `xlsx_recalculate`，读到的还是旧文件，重算结果没变，却报「已重算并通过核对」。现在重算前先 `officecli close` 落盘。复测：把年度经营 1 月基础版新增 MRR 从 10,560 改成 52,800，全年订阅收入从 1,404.71 万变成 1,406.82 万。
- **新增 WORD-DRAFT-LAYOUT 和 WORD-GOV-FLOW。** 前者是下面质量对比里修好的草稿版式。后者是公文分册 14–18：起草、风险关、分维复核、统稿、交付门槛，定调句，指标写法，敏感提法，修改请求。正文都是 Selection 自写，测试禁止出现 dsh 技能里的专有栏目名。

## 计分口径

一行是一件用户或模型能感知的事：选案例、写入、守卫、重算、预检、路由。dsh 用 Python 或 LibreOffice 做到的，Selection 用 OfficeCLI 和 TypeScript 做到，记为对齐。dsh 的内部限制（动画、SmartArt、OLE、EMF 不还原）按 Epic 的决定记为排除。无许可证的公文范文和口号库按 #704 记为排除，不靠复制原文去凑体积。

dsh 的公文目录约 320KB，其中大部分是不能搬的范文、金句和素材库。Selection 自写的公文目录约 71KB。覆盖点按上表计，不按字节计。

## 能力矩阵

### PPT

| 编号 | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| PPT-GALLERY | 内置模板库、按页预览，并在输入框附上所选模板 | 对齐 | `SKILL.md`、`selection-3.2-office-o3.md` |
| PPT-UNDERSTAND | 先定受众、结论、材料和页数，再动手改 | 对齐 | `workflow.md` |
| PPT-ROUTE | 定点修改、改版式、整套换风格三条路由，导入与定点冲突时只提醒 | 对齐 | `ppt-routing.ts`、`ppt-route.ts` |
| PPT-BRIEF | 外来 PPTX 先读结构摘要再编辑，原件不被覆盖 | 对齐 | `selection-3.2-office-o4.md`、`ppt-routing.ts` |
| PPT-IMPORT | PPTX 导入为可编辑 deck.json；写不进的对象按原位置保留并诊断 | 对齐 | `pptx-to-deck.ts`、`pptx-import.test.ts` |
| PPT-PERSONAL | 个人模板登记、预览，并用 ppt_template_create_project 复制成任务工程 | 对齐 | `ppt-template-project.ts`、`ppt-template-project.test.ts` |
| PPT-IMAGE | 模板配图槽合同、复用组；接上 Seedream / OpenAI 真出图，设置里可配可校验；图内不写文字 | 部分 | `selection-3.2-office-stage-12.md`、`ppt-tools.ts` |
| PPT-TEMPLATE-READY | 从 dsh 搬来的 16 套风格模板，catalog 指向的参考页都能通过 Selection 自己的预检，直接导出 | 对齐 | `deck.test.ts`、`dsh-import-diagnostics.json` |
| PPT-PREFLIGHT | 预检：连续同版式、封面焦点、图表数据与颜色、图片适配裁切、远程图、缺素材、文字遮挡 | 对齐 | `preflight.test.ts`、`dsh-ppt-parity.md` |
| PPT-GATE | 预检 error 不把 PPTX 标成就绪；warning 仍可导出 | 对齐 | `selection-3.2-office-stage-13.md` |
| PPT-VISUAL | 生成后 office_render 读图再改，同一文件最多三轮，禁止 OCR | 对齐 | `office-render.ts`、`office-tool-policy.ts` |
| PPT-FONT | 中西文字体按主题记号回退，不把缺字当成已验收 | 对齐 | `dsh-ppt-parity.md` |
| PPT-MIDUPLOAD | PPT 会话中途仍可附加图片和文件 | 对齐 | `next.md` |
| PPT-ANIM | 动画、SmartArt、OLE、EMF 解码成可编辑对象 | 排除 | `pptx-to-deck-mapping.md` |
| PPT-ENGINE | 把 PPTD 引擎或 YAML 工程码搬进安装包 | 排除 | `selection-3.2-office-stage-13.md` |
| PPT-SYNC | 个人模板跨设备同步 | 排除 | `selection-3.2-office-stage-11.md` |

### Word

| 编号 | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| WORD-CASES | 会议纪要、咖啡调研、公司研报、公文通知四个案例可预览并附到输入框 | 对齐 | `catalog.json`、`OfficeCaseGallery.tsx` |
| WORD-PREVIEW | 案例样例在 Office 协同面板只读打开，原件 sha256 被改动能恢复 | 对齐 | `office-case-preview.ts`、`selection-3.2-office-stage-06.md` |
| WORD-INJECT | Word 模式按案例 revision 注入指南和业务技能，重复轮次不叠加 | 对齐 | `office-catalog.ts`、`office-catalog.test.ts` |
| WORD-TEMPLATE | office_template 复制案例并返回可编辑段落，不改原件 | 对齐 | `office-template.ts`、`service.ts` |
| WORD-WRITE | office_template_write 按段落替换、追加并继承样式，受保护段落不能删 | 对齐 | `office-template.ts` |
| WORD-GUARD | 交付前七项版式核对：字体、样式、页面几何、边框、段落样式、可编辑版头 | 对齐 | `docx-layout.ts`、`docx-layout.test.ts` |
| WORD-STREAM | 流式最终答复也走交付守卫，未通过则退回模型 | 对齐 | `SessionManager.ts`、`selection-3.2-office-stage-13.md` |
| WORD-MINUTES | 会议纪要结构校验与 dsh 脚本同输入同退出码，安装后的会话用 office_business 调用 | 对齐 | `validate-minutes.ts`、`office-business.ts` |
| WORD-SKILLS | meeting-recap、work-report-writer、research-writer 三份业务技能可被注入 | 对齐 | `office-business-skills.ts` |
| WORD-GOV15 | 十五个法定文种各自的用途、标题、主送、结尾和易错点 | 对齐 | `03-structures.md` |
| WORD-TXN | 讲话稿、述职、方案、简报、通报材料、对照检查的骨架和事实索取清单 | 对齐 | `09-transactions.md` |
| WORD-PARAMS | 六个参数（含单位性质和角色）以及「你看着写」时的追问 | 对齐 | `08-parameters.md`、`SKILL.md` |
| WORD-SIX | 六维质检和随单位性质变化的权重，真实性不过不能交付 | 对齐 | `10-quality.md` |
| WORD-SAFE | S1–S6 安全红线、脱敏和公开度分级 | 对齐 | `11-safety.md` |
| WORD-STD | GB/T 15834 标点和 GB/T 15835 数字的公文操作口径 | 对齐 | `12-standards.md` |
| WORD-FIX | 病文按真实性、合法性、逻辑、实效、表达、政治和安全改稿 | 对齐 | `13-corrections.md` |
| WORD-ROUTE | 口语能路由到法定文种，也能路由到讲话稿、述职、方案、简报和对照检查 | 对齐 | `office-document-routing.ts`、`office-document-routing.test.ts` |
| WORD-DRAFT-LAYOUT | 确定性草稿的版式：公文标题按词回行、红色分隔线、署名与成文日期右空、版记上下线；纪要行动表定宽、表头、单元格分行 | 对齐 | `word-drafts.ts`、`docx-package.ts` |
| WORD-GOV-FLOW | 公文起草—风险—分维复核—统稿—交付的流程，定调句、指标写法、敏感提法和修改请求分册 | 对齐 | `14-workflow.md`、`17-sensitive-wording.md` |
| WORD-CORPUS | 范文样本、金句库、政治口号库和国标原文照录 | 排除 | `NOTICE` |
| WORD-EMBED | 把 government-notice 样例里的嵌入商用字体复制进每一份新稿 | 排除 | `selection-3.2-office-stage-07.md` |

### Excel

| 编号 | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| XLS-CASES | 年度经营、港口货运、荧光酶三个案例和预览区域 | 对齐 | `catalog.json` |
| XLS-METRICS | SaaS 指标、Quick Ratio、单位经济与 dsh 脚本同输入同输出，会话用 office_business | 对齐 | `stage09-parity.test.ts`、`office-business.ts` |
| XLS-AUDIT | 数据体检 12 个维度、加权总分和等级 | 对齐 | `stage09-parity.test.ts`、`SKILL.md` |
| XLS-VIZ | 指名调色板的信息图与 OfficeCLI 原生图表命令，不把图写成图片 | 对齐 | `SKILL.md`、`selection-3.2-office-stage-09.md` |
| XLS-RECALC | 公式写回缓存，未重算或 checks 不一致不能交付 | 对齐 | `xlsx-tool.ts`、`office-template.ts` |
| XLS-CHECKS | 港口与荧光酶 checks.json 在容差内核对 | 对齐 | `selection-3.2-office-stage-09.md` |
| XLS-VISUAL | 纯数据或公式任务不做视觉检查；格式、图表、打印必须读图 | 对齐 | `office-template.ts` |
| XLS-PAGE | 年度经营副本使用 A3、宽度一页；另外两个案例不改打印区域 | 对齐 | `selection-3.2-office-stage-08.md` |
| XLS-PERSONAL | 报价、预算、对账、项目计划和目标考核五类个人表，含公式或图表 | 对齐 | `selection-3.2-office-personal-728.md`、`office-document-routing.ts` |
| XLS-AUDIT-XLSX | 数据体检直接读 .xlsx（可指定工作表和区域），不必先另存 CSV | 对齐 | `office-business-tool.ts` |
| XLS-EDIT-RECALC | 用 OfficeCLI 改完输入格后马上 xlsx_recalculate，重算看到的是改后的值 | 对齐 | `service.ts` |
| XLS-CHART-CACHE | 原生图表缓存与 Excel CalculateFull 一致 | 部分 | `selection-3.2-office-stage-09.md` |
| XLS-HASH | palette=auto 与 Python 进程哈希逐字节一致 | 排除 | `office-python-features-in-ts.md` |
| XLS-SAMPLE | 数据体检 --sample 与 pandas RandomState 同序列 | 排除 | `selection-3.2-office-stage-09.md` |

### 共享底座

| 编号 | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| SHR-MODE | 同一会话在 PPT、Word、Excel 之间切换，并与 NORM / PRO 分开 | 对齐 | `selection-3.2-office-stage-05.md`、`office.ts` |
| SHR-GALLERY | 首页统一选择器：模板或案例卡片、预览、再次点击取消 | 对齐 | `OfficeCaseGallery.tsx`、`selection-3.2-office-stage-06.md` |
| SHR-PANEL | Office 协同面板打开案例样例，修订期间不把预览当可写编辑器 | 对齐 | `selection-3.2-office-stage-06.md` |
| SHR-LOOP | 生成、office_render、读图、返工；修订期间拦截 OCR 和裸截图 | 对齐 | `office-tool-policy.ts`、`office-tool-policy.test.ts` |
| SHR-RECALC | 公式重算不依赖 LibreOffice Kit，离线用 OfficeCLI 求值器 | 对齐 | `office-render-recalc-path.md` |
| SHR-FONT | 缺字体时列出文档用到而本机没有的字体 | 对齐 | `selection-3.2-office-stage-08.md` |
| SHR-HASH | 案例和模板原件在全流程后 sha256 不变 | 对齐 | `word-cases.test.ts` |
| SHR-PERSONAL | 十一类个人办公文档的路由和技能注入 | 对齐 | `office-document-routing.test.ts`、`selection-3.2-office-personal-728.md` |
| SHR-PACK | 安装包不含 LibreOffice Kit、Python 办公运行时和 PPTD | 对齐 | `no-python.test.ts`、`electron-builder.yml` |
| SHR-CHART-HTML | Excel 浮动图表在 HTML 预览里的位置与 Excel 自身一致 | 部分 | `xlsx-float-anchors.ts`、`office-page-render-script.ts` |
| SHR-PDF | 用户路径上的 PDF 导出 | 排除 | `system.ts`、`selection-3.2-office-stage-06.md` |

导入入口是 `deck-cli import`，不是单独的会话工具名。dsh 的 `pptd_check` 还有一批工程语法码，Selection 用 deck.json 的 schema 一次报完，记在排除项 PPT-ENGINE。dsh 的案例画廊有单独的「做同款」和按工作表翻页。LinNai 定的是点卡片附上案例，预览进协同面板。功能在，交互不同，不扣分。

## 排除项

1. 不把动画、SmartArt、OLE、EMF 解成可编辑对象。导入时诊断并保留。#707。
2. 不移植 PPTD，不把 YAML 工程码搬进安装包。
3. 个人模板不同步到别的设备。
4. 不复制无许可证的公文范文、金句和口号，也不照录国标全文。
5. 不把 `government-notice` 里的嵌入字体扩散到其他单位的新稿。样例原件仍保留。
6. 信息图的 `palette=auto` 不用 Python 的进程哈希。指名调色板时结构要对上。
7. 数据体检的 `--sample` 不对拍 pandas 的随机序列。
8. 用户路径上的 PDF 导出仍按阶段 06 延后。`system.ts` 只剩约 7 个 token，这次不加字。

## 质量对比

全部在 LinNai 的 box 上跑。没有调用模型，也没有调用付费的出图接口。页图用 OfficeCLI 1.0.157 出 HTML，再用本机 Chrome 截图。看图是人工读图，不用 OCR。并排图在 box 的 `/workspace/sw717-shots/`，不进仓库。

Word 和 Excel 的 dsh 案例样例与 Selection 案例是同一批字节（sha256 一致）。所以对比的是：左边 dsh 样例，右边 Selection 用自己的工具链按样例做出的新稿。

### PPT（3 套）

左边是 dsh 588412b 的 ppt-runtime 按模板出的 12 页，右边是 Selection 从同名 deck.json 用 `deck-cli render --platform mac` 导出、OfficeCLI 截的 12 页。

- `ppt-dsh-signal.png`：深蓝底、金色强调、页码和页脚位置一致。树状分支、折线加 +42%、对比表格的版式都对得上。Selection 的标题字重偏重一档，副标题是金色，dsh 是灰蓝。
- `ppt-dsh-blue-professional.png`：米黄底和蓝色强调一致。+18%、$240m、67% 这些大数都在，堆叠条和柱状图位置一致。dsh 标题是衬线体，Selection 回退成粗黑体，观感更硬。
- `ppt-dsh-cartesian.png`：封面的细圆和「理性简报」、3/8 的大数、树状分支都一致。同样是标题字体从衬线体回退。

这三套都能直接导出。其余 13 套的 catalog 参考页现在也都能过预检、直接导出（见 PPT-TEMPLATE-READY），这次没有逐套和 dsh 并排出对比图。

### Word（4 类）

- `word-minutes.png`，从左到右：dsh 纪要样例；Selection 用 `office_template_write` 写的新纪要「年度客户大会筹备会议纪要」；草稿生成器修复前；修复后。用 `office_template_write` 写的那份标题、会议信息、议题、行动表都继承了样例样式，七项版式核对全过，原文人名没有带进来。草稿生成器修复前，行动表没有框线和列宽，「任务、交付、来源」挤在一格里。修复后有定宽三列、灰底表头，单元格内分行。
- `word-gov.png`，从左到右：dsh 公文样例首页；Selection 用 `office_template_write` 写的「某某集团关于开展2026年冬季消防安全检查的通知」；城管通知生成器修复前；修复后。模板写入的那份保住了红头、红线、二号标题和三号仿宋正文，没有出现中国中车。生成器修复前标题在「通」字后折行，版记挤在左下。修复后标题在「关于」后回行，上下对称；版头下有红色分隔线；正文首行缩进两字、固定 28 磅行距；署名和成文日期右空四字；版记有上下线。剩下一点：HTML 预览不认右对齐制表位，「印发」日期没有靠右。Word 里会靠右。
- `word-personal.png`：房屋租赁合同和个人简历是 Selection 的个人办公样例，dsh 没有这两类。合同的条款、租金表、待补充都在一页里。简历版式干净，内容短，下半页留白。第三张是咖啡市场报告样例（与 dsh 同字节）作参照。

### Excel（4 张）

- `excel-annual-business.png`：左边 dsh 样例的原始 OfficeCLI HTML，图叠在左上，挡住标题和全年订阅收入。右边是 Selection 改了一个输入格、`xlsx_recalculate` 双读通过后的副本，浮动图已按锚点放好。四个 KPI 都看得见：1,406.8、80.7%、843、2,100.3。日新增图仍压住右侧季度表的左两列。
- `excel-port-cargo.png`：重算后 checks 四项通过。右边三张图各回各位：日吞吐折线在 01 段，月度结构和货类两张柱图在 02 段。2,516.9、65.0%、2.7、2,190 都露出来了。左边原始 HTML 只看得到一张图，另两张叠在下面。
- `excel-bio-assay.png`：checks 五项通过。剂量响应折线和两张 CV 柱图分开，288、3、8、10 四个指标都在。
- `excel-household-budget.png`：修复前图例写着 Series 1，图从第 16 行起盖住了餐饮、交通两行。修复后系列名取「本期实际」，单系列不再显示图例，图从第 20 行开始，类别轴是房租、餐饮、交通。

### 没跑的

- 没有真实模型轨迹。box 上没有 LLM 和出图密钥，所以不能报 token、耗时，也不能证明模型在真实回合里会调用守卫。
- 没有启动 dsh 应用。Word / Excel 对照用的是冻结提交里的样例文件，PPT 用的是之前在 box 上用 dsh ppt-runtime 出的图。
- 没有在装了 Word、Excel、PowerPoint 或 WPS 的机器上打开。字体回退只看了 HTML 页。
- 图表缓存没有跟 Excel `CalculateFull` 比。
- 其余 13 套 PPT 模板没有和 dsh 并排出对比图，只看了修过的两页截图。

## 还没对齐的

计入分数的三项部分对齐：

- PPT-IMAGE：真出图的提供方和设置页在 #741，合入后转为对齐。
- XLS-CHART-CACHE：原生图表缓存还没跟装了 Excel 的机器核对。
- SHR-CHART-HTML：HTML 列宽比 Excel 窄，宽图仍可能压住右侧的表。协同面板实时编辑时，OfficeCLI watch 推送的增量更新不经过这次的锚点改写，刷新后才对齐。

另外记下、但不进百分比的：

- PDF 导出仍不在用户路径上。
- 真机打开和真实模型回合留给装了 Office 的 macOS / Windows，以及有密钥的夜间运行。
- `office-business-runtime` 不进 electron-builder 的 files，但 `office_business` 让它被打进了主进程的 JS 包。仍然没有 Python。

## 怎么复跑

```bash
bun scripts/selection-3.2-office-parity.ts
bun test scripts/selection-3.2-office-parity.test.ts \
  packages/office-business-runtime/src/gov-doc-depth.test.ts \
  packages/office-business-runtime/src/word-cases.test.ts \
  packages/server-core/src/services/office-business-tool.test.ts \
  packages/server-core/src/services/xlsx-float-anchors.test.ts \
  packages/server-core/src/services/office-template/officecli-resident.test.ts \
  packages/shared/src/skills/__tests__/office-document-routing.test.ts
```

页图脚本 `scripts/selection-3.2-office-quality-render.ts` 需要本机 OfficeCLI 和 Chrome，不进 CI。
