# 底座决策 A：渲染预览 / PDF 导出 / 公式重算

对应 [#705](https://github.com/0-CHENAI/Selection/issues/705)，父规划 [#703](https://github.com/0-CHENAI/Selection/issues/703)。对照基线是阶段 01 冻结的 dsh-desktop `588412b`（见 [基线](../plans/selection-3.2-office-dsh-parity-baseline.md)）。

**状态：已批准（2026-10-30）。** LinNai 在 #705 补充里同意下文「原生优先、没有原生再回退」的顺序。#709 已接入用户路径的第一步：`office_render` 工具（`services/office-page-render.ts`）按 `native-plan.ts` 的 preview 步骤 `officecli-html-electron-capturePage`，用与「Office 协同」面板同源的 OfficeCLI HTML 在离屏 Electron 窗口里按页截图，交给模型原生读图。系统提示改为写明「没有 PDF 导出，看页面用 office_render」。PDF 导出和 macOS / Windows 原生高保真（Word / Excel / PowerPoint 导出）还没接入用户路径。PoC 本身仍不从 `services/index.ts` 导出，环境变量不是 `SELECTION_OFFICE_RENDER_POC=1` 时调用会直接拒绝。

实测数字在 [office-render-recalc-evidence.json](office-render-recalc-evidence.json)。测量环境是 Linux x64，OfficeCLI 1.0.157 / 1.0.159 的官方 linux-x64 二进制，系统 Chrome（HeadlessChrome/156）。没有把这些二进制放进仓库。

## 推荐（原生优先，没有原生再回退）

不打包 LibreOffice Kit。不把未发布的 PDF 插件打进安装包。不把「用户必须安装 Office」写成默认前提。选择顺序由 `native-plan.ts` 固定，单测覆盖三种快照。

| 功能 | 有原生时 | 没有原生时 |
| --- | --- | --- |
| PDF | 已安装的 OfficeCLI exporter 插件；否则在装了 Word 的 Windows / macOS 上用 Word 导出 PDF | OfficeCLI 自带 HTML 引擎 + Electron `printToPDF`。再不行才用 TypeScript 分页替身（只适合测试） |
| 预览 | Windows 且装了 Word 或 PowerPoint：OfficeCLI `view screenshot --render native` | Electron `capturePage` 截同一份 HTML。不依赖系统里另装的 Chrome，也不把 Quick Look / 缩略图接口当默认 |
| 公式 | OfficeCLI 自带求值器，把 `computedValue` 写回 `cachedValue`。装了 Excel 时可以再跑一次 `CalculateFull` 作复核 | 只有 OfficeCLI 标成未求值的格子才用 TypeScript 求值器补算 |

上一版把 A1 / B2 / C3 写成默认。对照原生入口之后，A1 和 B2 仍是**不装 Office 时**的那一层，而且这一层本身就是 OfficeCLI 的 HTML 引擎加上 Electron 自带的打印和截图。C3 从「对拍主路径」改成「未求值才补算」。C1 就是 OfficeCLI 自己的公式引擎，不是另写一套。

体积仍是接入前增量 0。LibreOffice Kit 的 win32-x64 单包是 71,374,248 字节，继续不采用。

## 要 LinNai 决定的问题

是否同意下面这条「原生优先、没有就回退」，并接受两件做不到的事：macOS / Windows 的 Word 与 Excel COM 这次没有在 Linux 上执行；Quick Look 和 Windows 缩略图接口不进入默认链路？

> 1. PDF：先用已经装上的 OfficeCLI exporter 插件；没有插件但本机有 Word 时，用 Word 导出 PDF；两者都没有时，用 OfficeCLI 的 HTML 加上 Electron `printToPDF`。不下载、不内置 PDF 插件，也不打包 LibreOffice。
> 2. 预览：Windows 且装了 Word 或 PowerPoint 时用 OfficeCLI `--render native`；否则用 Electron `capturePage`。不用 Quick Look，也不用 Windows 缩略图接口做正稿预览。
> 3. 公式：默认只用 OfficeCLI 自带求值器写回缓存。TypeScript 只补它没求出的格子。Excel `CalculateFull` 仅在探测到 Excel 时作复核。

同意之后才接入用户路径。若只想要其中一条走原生、其余维持上一版，请按 PDF / 预览 / 公式分开说。

## #673 / OfficeCLI 1.0.159 核验

[#673](https://github.com/0-CHENAI/Selection/pull/673) 仍是指向 `test` 的 draft，本阶段不合并。

| 项 | 1.0.157（当前随包） | 1.0.159 |
| --- | --- | --- |
| linux-x64 体积 | 35,448,677 字节 | 35,502,949 字节 |
| sha256 | `f8eefe88…c8245c94`，与 manifest 一致 | `92d9aeed…beac50ea`，与 #673 一致 |
| 根命令 | 无 PDF、无整簿 recalc | 相同 |
| `view` 的模式 | 含 `pdf`、`screenshot`、`html` | 帮助文本与 1.0.157 相同 |
| `view file pdf` | `No exporter plugin found for .docx/.xlsx/.pptx → .pdf` | 同样的错误 |
| 实际差量 | — | `batch` / `help` 增加 `--compact`。外部渲染依赖仍是空数组 |

`refresh` 只重算 Word 域（TOC、PAGE），并且帮助写明需要 Windows + Word。它不是 Excel 整簿重算。

所以 **A2 和 C2 都不成立**。升级 1.0.159 解决不了这三项功能。

## 怎么测的

1. 用 OfficeCLI 1.0.157 建一份两段探测 docx（一段中文、一段英文），再对 1.0.159 复跑 `view pdf`。
2. `view html` 得到 49,594 字节 HTML。页盒是 `width:595.3pt; min-height:841.9pt; padding:72pt 90pt 72pt 90pt`，字体声明指向本机 `Calibri`，并有一段会请求 `fonts.googleapis.com` / `d.officecli.ai` 的脚本。
3. 系统 Chrome headless 直接打印这份 HTML，以及打印 PoC 注入 `@page`、去掉外网字体脚本之后的 HTML。
4. 同一份 HTML 做截图；再跑一次没有浏览器时的 `officecli view screenshot`。
5. 公式：先在 OfficeCLI 里对一组函数和一条跨表链路读 `cachedValue` / `computedValue`。再把 dsh `588412b` 的 `port-cargo`、`bio-assay` 工作簿（只在临时目录，不入库）交给 C3，与每个公式单元格的缓存值比较，容差 `1e-6`。`checks.json` 用的是清单里的原件。

## F1 PDF 导出

| 选项 | 实测 | 决定 |
| --- | --- | --- |
| A1 OfficeCLI HTML → Electron `printToPDF` | HTML 能出。不注入页盒时，Chrome 打出 **2 页 Letter**（MediaBox 612×792，25,059 字节），不是文档上的 A4。注入 `@page{size:595.3pt 841.9pt}` 并去掉外网字体脚本后，打出 **1 页**，MediaBox 594.96×841.92，15,987 字节。页宽换算 210,009 µm，与 ISO A4 的 210,000 µm 差 9 µm，来自 OfficeCLI 写出的 595.3 pt。 | **无 Office 时的回退**。Electron `printToPDF` 是应用自带的 |
| A2 OfficeCLI `view pdf` | 模式名在，插件不在。1.0.157 同样失败。1.0.160 的源码和发布资产里也没有插件二进制。 | 只有用户已经装了插件才排第一。我们不提供这个插件 |
| A3 PPT 工程自有 HTML → 同一条打印合同 | 合同已在 PoC 里（页盒、边距、宿主接口）。本阶段不改 deck 导出。 | 接入时与 A1 共用 |
| A4 探测到系统 Office / LibreOffice 再用 | PoC 只按命令名探测 `winword` / `powerpnt` / `excel` / `soffice` / `libreoffice`，不调用。默认渲染器名称不变。 | 只作增强 |

CI 里没有 Electron 窗口。单测注入一个 `PrintHost`，断言它收到的是带中文的 HTML 和 A4 微米尺寸；默认替身用 TypeScript 分页写出真正的 `%PDF`，再用仓库里的 pdfjs 读回英文句子。替身不是 Chromium，不能拿来声称版式保真。保真证据是上面的 Chrome 打印。

## F2 渲染预览

| 选项 | 实测 | 决定 |
| --- | --- | --- |
| B1 `view screenshot` | 本机没有 Chrome/Edge/Firefox 被 OfficeCLI 找到时，命令等满约 120 秒，退出码仍是 0，得到 1600×1200、8,672 字节的图。页心是空白，没有探测文段。 | 仅当 `--render native` 且系统里真有 Word/PowerPoint 时作为增强 |
| B2 HTML → 离屏截图 | 同一份 HTML 的 Chrome 截图是 1200×1600、19,945 字节，中文「阶段02探测：会议纪要。」和英文句子都看得见。 | **无 Word 时的回退**。生产用 Electron `capturePage`，这样不依赖系统 PATH 上的 Chrome |
| B3 PDF → pdfjs 取页 | pdfjs-dist 已在 server-core，没有为它加依赖。PoC 能读页数和文本。Node 里没有 canvas，所以这一步不把 PDF 栅格成 PNG；要像素时直接用 B2 的截图。空白检测看的是页面像素方差，纯白缓冲会报 `blank-page` 并停止。 | 与 B2 一起用 |
| B4 系统 Office / LibreOffice 高保真渲染 | 同 A4，不调用。 | 只作增强 |

整张截图的灰度方差不能直接当空白阈值：OfficeCLI 那张「空白页」和 Chrome 那张有字的图都带着灰边，方差分别是 55.96 和 108.63。空白判断要裁到页心，或使用 B2 在白页上画出的像素。

16 套模板首页与 dsh 预览的逐张读图（验收 R3）留到接入之后。阶段 01 已经说明 `588412b` 不再把建成的模板页提交进 git，本阶段也不复制模板。

## F3 Excel 公式重算

OfficeCLI 1.0.157 在这份 Linux 二进制上，下列函数的 `computedValue` 与手算一致：`SUM`、`AVERAGE`、`IF`、`ROUND`、`SUMIF`、`SUMIFS`、`IFERROR`、`INDEX`、`MATCH`、`VLOOKUP`、`SUMPRODUCT`（数组条件形式）、`COUNTIF`、`MIN`、`MAX`、`ABS`、`AND`、`OR`、`ROUNDUP`、`INT`、`MOD`、`POWER`、`SQRT`、`LEN`、`TRIM`、`CONCAT`、`TEXT`、`NPV`、`COUNTA`、`COUNT`。全为正数的 `IRR` 返回 `#NUM!`，这是预期。技能文档里「`SUMPRODUCT` 数组条件的缓存永远是 0」对这次 1.0.157 实测不成立，缓存是 5。

跨表才是 C1 要补的洞。探测簿里 `港口总览!B6 = Sheet1!A1`，`J6 = B6*F6`，`N6 = SUM(J6)`。把 `A1` 从 100 改成 150、不重写公式时：

| 单元格 | cachedValue | computedValue |
| --- | ---: | ---: |
| B6 | 100 | 150 |
| J6 | 200 | 300 |

按依赖顺序把同一条公式再 `set` 一次之后，三者的缓存变成 150、300、300。也就是说引擎算对了，写进文件的缓存是旧的。不重算就能用双读发现过期。这就是 C1：拓扑排序后重写公式，把 `computedValue` 写回 `cachedValue`。

| 选项 | 实测 | 决定 |
| --- | --- | --- |
| C1 OfficeCLI 求值 + 写回缓存 | 上面的跨表双读。函数覆盖对案例够用。整簿 4,877 个公式逐个重写的耗时这次没有在 OfficeCLI 上跑，避免改案例原件。 | **原生主路径**。这就是 OfficeCLI 自带的求值器 |
| C2 1.0.159 整簿 recalc | 没有这条命令。1.0.160 的提交说明里也没有整簿 recalc。 | 不采用 |
| C3 TypeScript 独立求值 | 无新依赖。覆盖案例里出现的函数，含 `DATE` 的月进位（`DATE(2025,13,1)` = 2026-01-01）。 | **只补未求值的格子**，不再当作第二套主引擎 |
| C4 系统 Excel / LibreOffice 复核 | 不调用。 | 只作增强 |

C3 对临时目录里的原件（不入库）：

| 工作簿 | 公式单元格 | 与缓存一致 | 耗时 | checks.json |
| --- | ---: | ---: | ---: | --- |
| port-cargo | 4,877 | 4,877 | 6.8 s | `港口总览!B6/F6/J6/N6` 四项都在 `1e-6` 内 |
| bio-assay | 397 | 397 | 12 ms | 五项都在 `1e-6` 内 |
| annual-business | 0 | — | — | `588412b` 清单里没有 `checks.json`，工作表 XML 也没有 `<f>` |

`port-cargo` 的四项检查正好是验收 R1 点名的单元格，期望值是 2516.8532、0.6504859719271668、2.6991141552511415、2190。C3 与这些缓存一致。另有一个缩小的 R1：源单元格从 100 改到 150 后，旧缓存被标成过期，重算结果按新数据通过检查，输入对象本身不被改写。

HyperFormula 仍排除（GPL-3.0 / 商业双许可）。`@formulajs/formulajs` 不必引入：案例实际用到的函数已经在这约 60 KB 的实现里。

## 原生方法调研（2026-10-30 追问）

「原生」在这里分成三层，不要混在一个词里：OfficeCLI 二进制里已经有的能力、操作系统要本机装了 Office 才有的能力、Electron 进程里 Chromium 自带的能力。

### 1. OfficeCLI 自己的入口

对照了随包 1.0.157、本机下载的 1.0.159，以及上游 tag `v1.0.160`（2026-10-30 发布，发布说明只有 compare 链接）。1.0.160 的发布资产只有六个平台二进制和 `SHA256SUMS`，没有插件包。`plugins/` 目录里只有 `plugin-protocol.md`。组织下没有第二个 exporter 仓库。

| 入口 | 实际做什么 | 能不能当默认 |
| --- | --- | --- |
| `view html` | 自带排版引擎，不需要 Office。README 把它写成核心能力。这次 49,594 字节的探测稿带有 A4 页盒。 | 能。PDF 和预览都从这里拿版面 |
| `view screenshot` | 把上面的 HTML 交给系统里的 Chrome / Edge / Firefox。`--render native` 只在 Windows 且装了 Word 或 PowerPoint 时走 COM，其他平台仍是 HTML。 | 不能当默认。本机没有被它找到的浏览器时，页心是空白 |
| `view pdf` | `ExporterInvoker` 找 exporter 插件。找不到就抛 `exporter_not_found`，原文是 `No exporter plugin found`。 | 插件槽是原生的，插件本身没有发布 |
| `plugins list` | 1.0.157 输出 `No plugins installed`，并指向协议文档。协议写明 PDF 是 exporter，正是因为渲染库的体积和许可不适合打进主二进制。 | 发现顺序：环境变量 `OFFICECLI_PLUGIN_EXPORTER_PDF`，然后 `~/.officecli/plugins/exporter/pdf/plugin`，然后二进制旁边的同名路径，然后 PATH 上的 `officecli-exporter-pdf` |
| `refresh` | 只更新 Word 域。Windows 上调用 `WordPdfBackend.RefreshFields`（要真的 Microsoft Word）；别处用 HTML。 | 不是 Excel 重算 |
| 公式引擎 | README 写 350 多个内置函数，写入时求值，不经过 Office。跨表实测：`computedValue` 已更新，`cachedValue` 仍是旧的。 | 能。缺的是写回缓存，不是再造一个引擎 |
| `WordPdfBackend.DocxToPdf` | 仅 Windows。`Word.SaveAs2(path, 17)` 写出临时 PDF，再用 `Windows.Data.Pdf` 栅格成 PNG，然后删掉 PDF。PowerPoint 侧是 `Slide.Export` 成 PNG。 | 这是截图的内部步骤，CLI 不把 PDF 交给调用方。Selection 不在自己的进程里重写这套 COM |

导出插件能不能单独安装：协议允许，而且主程序会调它。今天没有可下载的插件，因此没有许可文本，也没有体积数字。Selection 不自己写一个、也不把 LibreOffice 填进这个槽。以后若上游发布了插件，选择器会把它放在 PDF 的第一步，仍然不随安装包分发。

### 2. 操作系统原生

这一节的 macOS / Windows API 没有在本机执行。这台机器是 Linux x64，没有 `qlmanage`、没有 Word、没有 Excel、没有「Microsoft Print to PDF」。硬调这些接口只会得到「命令不存在」，不能当成保真度数据。

| 方法 | Electron 里怎么碰 | 要不要装 Office | 保真 | 中文 | 速度 | CI |
| --- | --- | --- | --- | --- | --- | --- |
| macOS `qlmanage -t` | 可以 `spawn`。不需要原生扩展 | 要有对应的 Quick Look 生成器。没装 Office 时，docx / xlsx / pptx 通常不是 Word 那种分页 | 缩略图，不是逐页正稿 | 看生成器和系统字体 | 一次进程，通常一两秒 | macOS runner 上有 `qlmanage`，没有 Office。只能证明命令在，不能证明 Office 版式 |
| macOS `QLThumbnailGenerator` | Swift / Objective-C。Electron 的 JS 不能直接调，要小工具或原生扩展 | 同上 | 同上 | 同上 | 同上 | 同上，还多一个要编译的小工具 |
| macOS PDFKit | 只渲染已经是 PDF 的文件，不读 docx。要原生扩展。仓库里的 pdfjs 已经能读页 | 不要 | 对 PDF 高，对 Office 不适用 | 字体嵌在 PDF 里才稳 | 毫秒到一两秒 | 能，但和 pdfjs 重复 |
| macOS `NSPrintOperation` / WebKit 打印 | 要原生 WebKit 视图，不是 `webContents`。打的是 HTML | 不要 | 等于另一套 HTML 引擎，不会比 Chromium 更接近 Word | 系统字体 | 与 `printToPDF` 同一量级 | 能写 Swift 小工具，本阶段不值得为同一份 HTML 再维护一套 |
| Windows 预览处理程序 / `IThumbnailProvider` | COM。要原生扩展或 PowerShell。资源管理器用来出图标 | 要装 Office 才有 Office 版式的处理程序 | 缩略图 | 看处理程序 | 冷启动慢 | 托管的 Windows runner 不带 Office，现在的 `artifact-windows` 测不到 |
| Windows「Microsoft Print to PDF」 | `webContents.print({ silent, deviceName })` 可以指向这台打印机。保存路径经常还要对话框 | 不要。打印机是系统自带的 | 等于把已经排好的 HTML 再送去打印，不比 `printToPDF` 更接近 Word | Chromium 的字体回退 | 多一次假脱机 | Windows runner 上多半有这台打印机。静默路径不稳定，不采用 |
| Word `ExportAsFixedFormat` / `SaveAs2(..., 17)` | OfficeCLI 在 Windows 截图里已经这么做，但 PDF 是临时文件。Selection 若再写一遍 COM，就是第二份 Word 自动化 | 要装正版 Word。OfficeCLI 还会核对进程名里有 `Microsoft Word` | 最高，就是 Word 的分页 | Word 的字体，缺字按 Word 的替换 | 冷启动数秒，之后一页很快 | 托管 runner 没有 Office，本阶段不能验证 |
| Excel `CalculateFull` | COM `Application.CalculateFull`。macOS 上对应的是 AppleScript，不是同一套接口 | 要装 Excel | 和用户打开 Excel 按 F9 相同，图表缓存也会动 | 无关字体 | 大表可能数十秒 | 同样没有 Excel，不能验证 |
| PowerPoint `Slide.Export` | OfficeCLI 的 Windows 原生截图已经调用 | 要装 PowerPoint | 幻灯片位图，不是 PDF | PowerPoint 的字体 | 冷启动数秒 | 不能在当前 CI 验证 |

所以：操作系统里真正能打出 Word 分页的，只有装了 Office 的 COM / AppleScript。Quick Look 和缩略图接口解决不了「没装 Office 也要逐页正稿」。它们不进默认链路。

### 3. Electron / Chromium 还剩什么

Selection 的 Electron 是 `^39.2.7`。和这次有关、而且进程里已经有的只有两件：

- `webContents.printToPDF`：不弹对话框，能指定页宽页高（微米）和 `preferCSSPageSize`。Chrome 156 对同一份 HTML 的测量就是这一族引擎。应用不需要再装浏览器。
- `webContents.capturePage`：浏览器窗已经在用。拿来截 OfficeCLI 的 HTML，就不必再找 PATH 上的 Chrome。上次空白图就是因为 OfficeCLI 在外面找不到浏览器。

`webContents.print` 会进系统打印对话框或指定打印机。它不比 `printToPDF` 多出 Office 版式。Chromium 里没有 Excel 公式引擎，也没有 docx 分页器。中文取决于 HTML 里的 `font-family` 和系统字体；探测稿的截图里中文是可见的，`Calibri` 仍不内嵌。

### 这次没测到的，以后怎么验

1. 装了 Word 的 Windows：`view screenshot --render native` 的页心必须有字；同一文档用 Word 导出的 PDF 页数与 Electron `printToPDF` 对照，差在哪一页写进记录。
2. 装了 Excel 的 Windows：对 `port-cargo` 的副本执行 `CalculateFull`，再读缓存，与 OfficeCLI `computedValue` 和 `checks.json` 用 `1e-6` 比较。不改原件。
3. macOS runner：只确认 `qlmanage -t` 能给一张 PDF 出缩略图。docx 的缩略图不算数，除非那台机器装了 Word。
4. 接入 PR 在 Electron 隐藏窗口里对同一份探测 HTML 调用 `printToPDF` 和 `capturePage`，页盒应仍是约 595×842 pt。

这些都不在本 PR 里改 CI。Linux 上能验的是选择器：没有 Office、没有插件时，PDF 和预览落在 Electron，公式落在 OfficeCLI 写回；Windows 且有 Word 时，PDF 和预览把 Office 步放在前面，并且那一步标成 CI 不能在无 Office 的 runner 上跑。

## 放弃项

| 选择 | 原因 |
| --- | --- |
| 随包 LibreOffice Kit 或 wasm | 与「复刻功能、不复刻技术栈」冲突。单平台约 67–71 MB，六包合计约 323 MB，MPL-2.0。 |
| 把 `view pdf` 当成已经能导出 | 两个版本都缺导出插件。 |
| 为了 PDF / 重算升级到 1.0.159 | 差量是 `--compact`，二进制只多约 54 KB，功能缺口还在。 |
| 要求用户安装 LibreOffice 或 Office | 只能是探测到之后的增强。 |
| 云端转换 | 文件离开本机。 |
| HyperFormula | 许可与 Selection 的分发方式不合。 |

## PoC 在哪里

| 文件 | 作用 |
| --- | --- |
| `packages/server-core/src/services/office-render-poc/gate.ts` | 门闩、50 MB、60 s、取消、源版本不一致 |
| `formula.ts` | C3 解析、依赖序、双读、checks、xlsx 读取 |
| `print.ts` | 打印 HTML、PDF 替身、pdfjs 读页、空白检测、区域裁剪 |
| `native-plan.ts` | 原生优先的选择顺序。不调用本机没有的 API |
| `service.ts` | `exportPdf` / `renderPreview` / `recalculate` / `detectOfficeRenderers`，并发 2 |
| `office-render-poc.test.ts` | 上述合同。设置了 `DSH_PORT_CARGO_XLSX` 等变量时才跑两个原件，CI 不设置 |

调用例：

```bash
SELECTION_OFFICE_RENDER_POC=1
```

不设置时错误码是 `disabled`。并发上限、超时、超过 50 MB、源版本变化、取消、空白页都有对应错误码：`too-large`、`source-changed`、`cancelled`、`timeout`、`blank-page`。

## 已知保真限制（同意推荐就等于接受这些，直到 #717）

- HTML 版式还不是 Word 分页。复杂表格、浮动对象、域、页眉页脚的跨页，这次只用了两段正文，没有拿 `meeting-minutes` 原件去对 dsh 的 PDF 页数。
- `Calibri` / `Calibri Light` 只声明了 `local()`，安装包不内嵌。外网字体脚本在打印前去掉。中文能否显示取决于系统字体；这次 Chrome 截图里中文是可见的。
- 分页替身把非 Latin 字符换成 `?`。它只证明 PDF 容器和页数，不证明中文嵌入。中文留在交给 Electron 的 HTML 里。
- C3 不重算图表缓存。`annual-business` 没有单元格公式，图表是另一件事。
- C1 在整本 `port-cargo` 上逐格重写公式的时间还没测。C3 全簿对拍是 6.8 秒。2,190 行的 `SUMIFS` 若走 OfficeCLI 逐条 `set`，会比这慢，接入时要批处理。
- B1 在没有 Word 的机器上会给出没有文字的图，不能当默认。
- 这次没有在 macOS 或 Windows 的 Electron 里调用 `printToPDF`。宿主接口和页盒数字已经固定，接入 PR 再接到 `webContents`。
- 验收 R3（16 套模板首页对照）和 R5（装上又卸掉系统 Office 的完整探测）不在本 PoC。R4 的三种拒绝在单测里，没有拉起真实窗口。

## 本阶段明确不做

- 不把 LibreOffice、Python、PPTD 打进安装包或依赖。
- 不改案例、技能正文、截图回退和系统提示。
- 不合并 #673。
- 不开始 #706 及以后。Python 脚本仍留给 #706。

拍板并接入之后，下一步才是 #706：把 dsh 的 Python 脚本功能映射到 TypeScript / OfficeCLI。
