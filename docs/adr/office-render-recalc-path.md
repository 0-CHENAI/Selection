# 底座决策 A：渲染预览 / PDF 导出 / 公式重算

对应 [#705](https://github.com/0-CHENAI/Selection/issues/705)，父规划 [#703](https://github.com/0-CHENAI/Selection/issues/703)。对照基线是阶段 01 冻结的 dsh-desktop `588412b`（见 [基线](../plans/selection-3.2-office-dsh-parity-baseline.md)）。

**状态：待 LinNai 拍板。** 本文和旁边的 PoC 都不改变用户能看到的路径。`screenshot.ts` 的 LibreOffice 回退、系统提示里「PDF export is not included」都还在。PoC 不从 `services/index.ts` 导出，环境变量不是 `SELECTION_OFFICE_RENDER_POC=1` 时调用会直接拒绝。

实测数字在 [office-render-recalc-evidence.json](office-render-recalc-evidence.json)。测量环境是 Linux x64，OfficeCLI 1.0.157 / 1.0.159 的官方 linux-x64 二进制，系统 Chrome（HeadlessChrome/156）。没有把这些二进制放进仓库。

## 推荐

| 功能 | 推荐 | 一句话 |
| --- | --- | --- |
| PDF 导出 | **A1** | OfficeCLI `view html`，注入文档自己的页盒，再交给 Electron `printToPDF`。PPT 工程以后走同一条 HTML 合同（A3）。 |
| 渲染预览 | **B2** | 同一份 HTML 做离屏截图。Windows 上若有 Word / PowerPoint，B1 只作为增强。PDF 页用仓库里已有的 pdfjs 读取（B3）。 |
| 公式重算 | **C1 + C3** | OfficeCLI 负责求值并把新结果写回 `cachedValue`。本 PoC 的 TypeScript 求值器做独立对拍，不引入新依赖。 |

不打包 LibreOffice Kit，不内置 Python，不移植 PPTD。不把 #673（OfficeCLI 1.0.159）并进来：它没有 PDF 插件，也没有整簿重算命令。

体积：实现源码 56,441 字节，无新依赖，未接入打包入口，**安装包增量为 0**。5 MB / 平台的预算还没动用。LibreOffice Kit 的 win32-x64 单包是 71,374,248 字节。

## 要 LinNai 决定的问题

是否同意把 Selection 3.2 的默认实现定为下面这一条，并接受文末列出的保真限制：

> PDF 用 A1（HTML → 注入 `@page` → Electron `printToPDF`），预览用 B2（同一 HTML 离屏截图），公式用 C1 写回缓存、C3 独立对拍。不打包 LibreOffice Kit，不把系统 Office / LibreOffice 当默认前提。拍板前不接入用户路径。

同意之后，下一份实现 PR 才把 `officeRender` 接到预览、导出和技能说明。若不同意，请指出要改的选项（A/B/C 的编号）。

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
| A1 OfficeCLI HTML → Electron `printToPDF` | HTML 能出。不注入页盒时，Chrome 打出 **2 页 Letter**（MediaBox 612×792，25,059 字节），不是文档上的 A4。注入 `@page{size:595.3pt 841.9pt}` 并去掉外网字体脚本后，打出 **1 页**，MediaBox 594.96×841.92，15,987 字节。页宽换算 210,009 µm，与 ISO A4 的 210,000 µm 差 9 µm，来自 OfficeCLI 写出的 595.3 pt。 | **默认** |
| A2 OfficeCLI 1.0.159 原生 PDF | 模式名在，插件不在。1.0.157 同样失败。 | 不采用 |
| A3 PPT 工程自有 HTML → 同一条打印合同 | 合同已在 PoC 里（页盒、边距、宿主接口）。本阶段不改 deck 导出。 | 接入时与 A1 共用 |
| A4 探测到系统 Office / LibreOffice 再用 | PoC 只按命令名探测 `winword` / `powerpnt` / `excel` / `soffice` / `libreoffice`，不调用。默认渲染器名称不变。 | 只作增强 |

CI 里没有 Electron 窗口。单测注入一个 `PrintHost`，断言它收到的是带中文的 HTML 和 A4 微米尺寸；默认替身用 TypeScript 分页写出真正的 `%PDF`，再用仓库里的 pdfjs 读回英文句子。替身不是 Chromium，不能拿来声称版式保真。保真证据是上面的 Chrome 打印。

## F2 渲染预览

| 选项 | 实测 | 决定 |
| --- | --- | --- |
| B1 `view screenshot` | 本机没有 Chrome/Edge/Firefox 被 OfficeCLI 找到时，命令等满约 120 秒，退出码仍是 0，得到 1600×1200、8,672 字节的图。页心是空白，没有探测文段。 | 仅当 `--render native` 且系统里真有 Word/PowerPoint 时作为增强 |
| B2 HTML → 离屏截图 | 同一份 HTML 的 Chrome 截图是 1200×1600、19,945 字节，中文「阶段02探测：会议纪要。」和英文句子都看得见。 | **默认**。生产宿主是 Electron `capturePage`，与这次 Chrome 是同一族排版引擎 |
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
| C1 OfficeCLI 求值 + 写回缓存 | 上面的跨表双读。函数覆盖对案例够用。整簿 4,877 个公式逐个重写的耗时这次没有在 OfficeCLI 上跑，避免改案例原件。 | **主路径** |
| C2 1.0.159 整簿 recalc | 没有这条命令。 | 不采用 |
| C3 TypeScript 独立求值 | 无新依赖。覆盖案例里出现的函数，含 `DATE` 的月进位（`DATE(2025,13,1)` = 2026-01-01）。 | **对拍** |
| C4 系统 Excel / LibreOffice 复核 | 不调用。 | 只作增强 |

C3 对临时目录里的原件（不入库）：

| 工作簿 | 公式单元格 | 与缓存一致 | 耗时 | checks.json |
| --- | ---: | ---: | ---: | --- |
| port-cargo | 4,877 | 4,877 | 6.8 s | `港口总览!B6/F6/J6/N6` 四项都在 `1e-6` 内 |
| bio-assay | 397 | 397 | 12 ms | 五项都在 `1e-6` 内 |
| annual-business | 0 | — | — | `588412b` 清单里没有 `checks.json`，工作表 XML 也没有 `<f>` |

`port-cargo` 的四项检查正好是验收 R1 点名的单元格，期望值是 2516.8532、0.6504859719271668、2.6991141552511415、2190。C3 与这些缓存一致。另有一个缩小的 R1：源单元格从 100 改到 150 后，旧缓存被标成过期，重算结果按新数据通过检查，输入对象本身不被改写。

HyperFormula 仍排除（GPL-3.0 / 商业双许可）。`@formulajs/formulajs` 不必引入：案例实际用到的函数已经在这 56 KB 里。

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
| `print.ts` | A1 打印 HTML、PDF 替身、pdfjs 读页、空白检测、区域裁剪 |
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
