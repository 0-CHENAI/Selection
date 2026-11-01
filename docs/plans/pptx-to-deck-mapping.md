# PPTX → deck.json 字段映射

对应 [#707](https://github.com/0-CHENAI/Selection/issues/707)。路线选择和迁移规则在 [ADR](../adr/ppt-pptd-features-on-deck.md)。本文是阶段 10 转换器的直接输入。

单位：deck.json 用磅。OOXML 的 EMU 除以 12700 得到磅，与 `ppt-library.ts` 相同。960×540 磅就是 16:9（13.333×7.5 英寸）。dsh 的覆盖脚本把 EMU 除以 9525，得到的是 96 dpi 下的像素；对照时先换回磅，不要混用。

四档的意思：

| 档 | 阶段 10 要做成什么样 | 和 dsh 诊断的对应 |
| --- | --- | --- |
| 保真 | 导出后几何、文字、颜色和源对象一致，并且能在工程里改 | dsh 能原样留下的对象 |
| 近似 | 对象还在，而且能改；样式被收成 deck 现有能力，诊断说明收了什么 | `normalized` |
| 保留不可编辑 | 导出时按原位置留着，工程里不能改版式，也不能跟着换主题 | `placeholder`，以及我们不解码的 EMF/WMF |
| 不支持 | 不进工程，也不在导出里假装还在。诊断用 ADR 附录 B 的句子 | `unsupported`，以及 SmartArt、音视频、OLE、动画 |

阶段 04 的 `importSimplePptx` 只实现表里写明「证明已做」的行。阶段 10 的 `importPptx` 补上表里的保真和近似项，并把保留项写进 `retained.json`，导出时按原位置贴回。

## 对象对照

| 对象 | 源 | 现行 deck.json | 归类 | 证明 |
| --- | --- | --- | --- | --- |
| 页面尺寸 | `p:sldSz` 的 `cx`/`cy` | `canvas.width/height` | 在 200–2000 磅内为保真，否则不支持 | 已做 |
| 纯色背景 | `p:bg` 的 `srgbClr` / `schemeClr` | `page.background`。与纸色相同写成 `$paper` | 保真 | 已做 |
| 背景图片 | `blipFill` | 无页级图片背景 | 保留不可编辑 | 只诊断，本页改用纸色 |
| 平铺背景 | `a:tile` | 无 | 近似：阶段 10 按页面边界铺满，并说明 | 只诊断 |
| 占位符文字 | `p:sp` + `p:ph` + `txBody` | `type: text` | 近似：使用本页直接格式，不展开母版样式 | 已写入文字，并诊断 |
| 母版和版式装饰 | 幻灯片 XML 里没有、由版式继承的形状 | 抄成 `role: decoration` 的元素；名字放进草案 `layoutRef` | 近似。抄进来之后不再跟着母版更新 | 只发现版式关系，不抄形状，不写 `layoutRef` |
| 单一样式文本 | `a:t`、`a:rPr` | `text` + `font`。含中文用 `$cjk` | 保真 | 已做 |
| 多种样式的 run | 多个 `a:r` | 草案 `runs`。接入前收成第一段样式 | 近似 | 已拼接文字，并诊断 |
| 项目符号 | `buChar` / `buAutoNum` | 无独立字段 | 近似：阶段 10 把符号写进正文并诊断 | 只诊断 |
| 自适应字号 | `spAutoFit` / `normAutofit` | `textCapacity` 是检查预算，不是自动缩小 | 近似：按文本框计算容量，不改字号 | 已按文本框算容量 |
| 矩形、圆角、椭圆、直线 | `prstGeom` 的 `rect` / `roundRect` / `ellipse` / `line` / `straightConnector1` | `shape` | 保真。圆角在证明里固定 8 磅，阶段 10 再读 `adj` | 已做 |
| 其他预设形状 | 其余 `prst` | 能转成 `path` 的走近似，否则保留 | 保留，直到有路径 | 只诊断，不写入 |
| 自定义几何 | `custGeom` | 现有 `path` + `pathRule`。不新增 `customGeometry` | 近似 | 只诊断 |
| 箭头 | `headEnd` / `tailEnd` | `arrow` 为 `start` / `end` / `both` | 三角形、stealth、arrow 为保真；其他箭头收成线段，近似 | 已做已知三种 |
| 纯色和主题色 | `srgbClr` / `schemeClr` | `fill` 或 `font.color`。与 theme 相同则用 token | 保真 | 已做。对不上的色值走 `direct-color` |
| 渐变 | `gradFill` | 现有 `gradient` | 线性、径向为保真；其他收成近似 | 只诊断 |
| 图案 | `pattFill` | 现有 `pattern` | 已知预设为保真 | 只诊断 |
| 形状上的图片填充 | `blipFill` | 无直接字段 | 保留，或阶段 10 拆成图片加 `mask` | 只诊断 |
| 组合 | `grpSp` | 展开后的元素加草案 `group.id` | 近似。dsh 把组合展开并标 `normalized` | 整组只诊断，子对象不读 |
| 表格 | `graphicFrame` + table | 现有 `table`。没有合并单元格 | 规则表格为保真；有合并则保留，直到草案能写 `rowSpan` | 只诊断 |
| 图表 | `graphicFrame` + chart | 现有 `chart.kind` | 种类能对上且缓存里有数据时为近似（样式收进主题，与 dsh 的 `chart-style` 相同）；否则保留 | 只诊断 |
| PNG / JPEG | `a:blip` | `type: image`，`fit: fill` | 保真 | 已抽出字节。给出目录才落盘 |
| 裁剪和遮罩 | `srcRect`、图片上的几何 | 草案 `crop`、`mask` | 裁剪在字段接入后为保真；遮罩为近似 | 整图留下，裁剪只诊断 |
| EMF / WMF | 图片部件扩展名或 ContentType | 不解码 | 保留不可编辑。不移植 dsh 的 EMF 解码 | 只诊断，导出里还没有这张图 |
| 层级 | `spTree` 子节点顺序 | `elements` 顺序 | 保真 | 已按这个顺序。同一形状又有填充又有文字时，形状在前 |
| 主题色和字体 | `theme1.xml` | `theme.colors` / `theme.fonts` | 近似：`dk1/lt1/dk2/lt2/accent1` 映到 ink/paper/muted/surface/accent；一种字体写到 mac、win、linux | 已做，并有 `theme-font` 诊断 |
| 备注 | notesSlide 里 `ph type=body` | `page.notes` | 保真 | 已做 |
| 图片槽 | 备注 JSON `dsh.template-images/v1` | 现在放在 `notes`。草案为页级 `imageSlots` | 保真（字段语义一致） | 备注原样保留。`liftImageSlots` 才复制到页级字段 |
| 超链接 | `hlinkClick` | 草案 `link.href` | 近似 | 文字保留，链接只诊断 |
| SmartArt | graphicData 含 `diagram` | 无 | 不支持 | 只诊断 |
| OLE | graphicData 含 `ole` | 无 | 不支持 | 只诊断 |
| 音频、视频 | 媒体扩展名 | 无 | 不支持 | 只诊断 |
| 动画 | `p:timing` | 无 | 不支持 | 只诊断 |
| 兼容分支 | `AlternateContent` | 读 Fallback，没有则读 Choice | 近似 | 已做 |
| 发光、三维、变形 | `effectLst` / `scene3d` / `prstTxWarp` | 现有 `shadow` 可表达外阴影 | 近似：几何留下，效果先丢掉。阶段 10 再接外阴影 | 已诊断。证明未写 `shadow` |

层级、检查和导出都认元素 id。导入时优先用 `cNvPr` 的 `name`，和今天导出写进形状名、OfficeCLI 用 `/slide[n]/shape[@name=<id>]` 寻址的方式一致。空名字或重名会改成 `s页-e序号`。

## E1. 三份结构样例的纸面推演

仓库里没有客户 PPTX。下面三份是测试里生成的 OOXML 包，各自带上 #707 点名的对象：占位符和版式关系、组合和表格、图表和 EMF。没有运行 dsh 的导入函数。对照依据是 `588412b` 上 `pptx-object-coverage.js` 的对象种类、`pptd-convert.d.ts` 的诊断分级，以及 `pptx-converter.js` 里已经写明的诊断（组合展开为 normalized，图表样式为 normalized，无二维边界为 unsupported）。

### 1. 带占位符的标题页

源：一页 960×540，版式关系指向 `slideLayout1.xml`，标题占位符文字「经营回顾」，字号 24、粗体、`#111111`，并带一个空的 `effectLst`。

| 对象 | dsh 的处理（从诊断用语归纳，未跑导入） | 本路线 | 证明的实际结果 |
| --- | --- | --- | --- |
| 页面尺寸 | 读入工程宽高 | 保真，写入 `canvas` | `960×540` |
| 标题文字 | 占位符样式从母版展开后写入文本 | 近似：本页直接格式写入 `text` | 元素 `title-el`，文字「经营回顾」，颜色收成 `$ink` |
| 母版装饰 | 继承的装饰会进页面 | 近似：阶段 10 抄成装饰元素，并写 `layoutRef` | 只有 `layout-inheritance` 诊断，页面 `layout` 仍是 `free` |
| 发光等效果 | normalized，几何保留、效果简化 | 近似 | `effects` 诊断，文字仍在 |

差异归类：文字这一类两边都有。dsh 会展开母版样式，我们在阶段 10 之前只保留本页格式，所以这一项是近似，不是缺类。

### 2. 组合加表格

源：一个 `grpSp`（里面有「组内标题」）和一个 table `graphicFrame`。

| 对象 | dsh | 本路线 | 证明 |
| --- | --- | --- | --- |
| 组合 | normalized，展开成页面对象 | 近似：展开并写 `group.id` | `group` 诊断，子对象不进 `elements` |
| 表格 | 写成表格元素 | 规则表保真；本证明尚未读单元格 | `table` 诊断，工程里没有「组内标题」 |

差异归类：两类对象都有归类。证明比目标少做了展开和单元格重建，这是阶段 10 的实现，不是路线改选。

### 3. 图表加 EMF

源：chart `graphicFrame`，以及一张 `image1.emf`。

| 对象 | dsh | 本路线 | 证明 |
| --- | --- | --- | --- |
| 图表 | 数据和类型保留，复杂样式 normalized；读不出则 placeholder | 种类对得上为近似，否则保留 | `chart` 诊断，级别 retained |
| EMF | 仓库里有 EMF 解码，具体像素未在本阶段实测 | 保留不可编辑。不移植解码器 | `emf` 诊断用附录 B 的句子。导出文件里还没有这张图 |

差异归类：图表一类两边都覆盖，保真度我们定为近似或保留，不承诺 OOXML 图表样式。EMF 我们明确不解码，用路线 B 留原图；证明还没有把原图挂上，所以现在导出会缺这张图。阶段 10 必须补上保留层，不能把这句诊断理解成「可以丢掉」。

这三份样例都没有产生 version 2 字段。`parseDeckDocument` 仍会拒绝 `imageSlots`。

## E2. 改版式和换风格

以一份已经导入的 960×540 工程为例。第 5 页是 `pages[4]`。

### 第 5 页改成左右对比

路线 A：保持该页元素 id 不变，把 `layout` 设成现有论证版式里的对比版式；如果那个 id 不在 `argumentLayouts` 里，就用 `free`，只重排 `bounds`。然后 `checkDeck`，再 `exportDeck`。按页修订仍提交原来的 `{page, elementId}`。图片槽如果引用的还是这些 id，合同不用改。

路线 B：可编辑对象同上。`retained` 对象不进这次重排，导出时 OfficeCLI 仍把源形状画在原坐标。界面向用户显示附录 B 的保留文案。

路线 C：没有页对象。只能对每个形状 `set` 坐标。不能一次换成另一套版式，也没有 theme token。

所以「改版式」只在 A（加上 B 对保留对象的提示）上成立。

### 整套换风格

路线 A：替换 `theme.colors` 和 `theme.fonts`，不改元素 id。写成 `$ink`、`$accent` 的颜色跟着新主题走。证明里的做法是：导入后把 `ink` 改成 `#0033AA`、`accent` 改成 `#00AA88`，导出 XML 里出现这两个色值，形状名仍是 `title-el` 和 `swatch`。对不上主题的 `#RRGGBB` 保持原值，并有 `direct-color` 诊断，换风格时不会跟着变。

路线 B：token 同上。保留层仍是源文件的颜色和字体。

路线 C：没有 theme，每个形状单独改色。

## 和证明的边界

`importSimplePptx` 返回 version 1 的 `Deck`，外加诊断、图片字节和源文件 sha256。只有调用方传入 `assetDir` 时才把图片写到那个目录。它不接收模板目录，测试用 `styles/dsh-cartesian/deck.json` 的 sha256 和 mtime 确认原模板没被写入。

阶段 10 应把本文件表里「证明」列不是「已做」的保真和近似项补进转换器，并把保留项真正挂进导出，而不是继续只打印诊断。
