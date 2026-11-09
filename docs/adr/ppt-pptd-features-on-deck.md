# 在 deck.json 上承接 dsh 的 PPT 功能

状态：LinNai 已拍板（2026-10-30）。对应 [#707](https://github.com/0-CHENAI/Selection/issues/707)，父规划 [#703](https://github.com/0-CHENAI/Selection/issues/703)。路线 A 为主，路线 B 兜底，路线 C 只做定点修改。阶段 10（[#713](https://github.com/0-CHENAI/Selection/issues/713)）按此把外来稿导入接到 deck.json。现有模板仍然不改写。

对照基线是阶段 01（[#719](https://github.com/0-CHENAI/Selection/pull/719)）冻结的 dsh-desktop `588412b9002fcb3ac88751fab7915e050c965563`。Selection 侧工程格式仍是 `selection-deck` version 1。dsh 的打包 JS 只用来核对它覆盖哪些对象、诊断怎么分级，不搬进本仓库。

## 结论

采用路线 A 为主、路线 B 兜底。

deck.json 是唯一工程真相。能映射的对象进工程，沿用现有 `checkDeck`、导出和按页修订。暂时写不进 schema 的对象用路线 B 标成「保留不可编辑」，导出时再由 OfficeCLI 按原位置合并，并在诊断里说明。路线 C（只对 PPTX 做定点修改）继续服务「外来稿改几个字」，不承担改版式和整套换风格。

不移植 dsh 的演示引擎，不引入第二份工程格式，技能和工具名不使用那套 `pptd_` 前缀。

## 三条路线

评估时用的保真度，对齐 dsh `pptx-object-coverage.js` 的页面对象（`sp`、`pic`、`cxnSp`、`grpSp`、`graphicFrame`、`contentPart`）和 `PptxToPptdDiagnostic` 的三级（`normalized` / `placeholder` / `unsupported`）。Selection 侧收成四档：保真、近似、保留不可编辑、不支持。字段怎么落，见 [PPTX → deck.json 映射](../plans/pptx-to-deck-mapping.md)。

| 维度 | A. 扩展 deck.json，单引擎 | B. deck.json + OfficeCLI 保留层 | C. 只做 OfficeCLI 定点改 |
| --- | --- | --- | --- |
| 导入保真 | 能表达的对象写成工程；表达不了的要删掉或降成别的形状 | 能表达的进工程；其余以源 PPTX 片段原样带上，诊断写明不能改 | 不建工程。保真等于「文件还在」，没有对象模型 |
| 改版式 | 改这一页的 `layout` 和元素 `bounds`，元素 id 不变，按页修订面板仍用 `{page, elementId}` | 可编辑对象跟 A 一样。保留层停在原坐标，改版式时不会跟着动，必须另有提示 | 没有页级版式。只能逐个形状改坐标 |
| 整套换风格 | 换 `theme` 的颜色和字体。写成 token 的颜色跟着变 | 工程里的 token 跟着变。保留层仍是源文件的颜色和字体 | 没有 theme。每个形状单独改色 |
| 现有修订环 | 直接沿用 `check.ts`、导出、`PptIssueRevisionPanel` 的 `{page, elementId}` | 修订环只覆盖可编辑对象。保留层不进元素 id，避免被当成能改的形状 | 现有修订环用不上。改完以 PPTX 为准，和今天的外来稿路径一样 |
| 16 套模板、ppt-master 14 套、样例扩展 | 零改写。它们继续是 version 1。新字段等到阶段 10 再进解析器 | 同 A。保留层不写进这些模板 | 同今天，模板文件不动 |
| schema 成本 | 要加一版可选字段，并保证 version 1 原样可读、可导出 | 在 A 的字段之外再加 `retained`，以及导出时的合并规则 | 不加字段 |
| 代码和维护 | 转换器集中在 deck 导入和现有导出。一套状态 | 多一条合并路径：导出时把保留片段贴回。要防止保留层和可编辑对象叠在一起还没人知道 | 最短，但补不上「理解任意 PPT → 改成可编辑工程」 |

路线 A 单独用，会在复杂母版、合并单元格、未知图表、EMF/WMF 上丢东西。路线 B 单独用，工程不再是唯一真相，按页修订要分两套对象。路线 C 是今天 `ppt-brief.ts` 加 OfficeCLI 定点改的延伸，只能摘要和改字，不能换版式。所以主路径是 A，B 只兜那些 A 的 schema 还写不下的对象，C 留在原路由里。

不采用的做法：

| 做法 | 原因 |
| --- | --- |
| 把 dsh 演示引擎引进来当导入专用格式 | 两套工程会有两份状态。LinNai 要求复刻功能，不复刻这套技术栈 |
| 整包改用该引擎，并迁走现有修订环 | 会丢掉 Selection 已经更完整的 check → 导出 → 按页修订 |
| 把 dsh 的打包 JS 放进仓库 | 没有完整 TS 源码，也进不了 Selection 的构建。只作对照 |
| 继续只做 `ppt-brief.ts` 的有损摘要 | 摘要不能改版式，这正是 #703 要补的缺口 |

## 推荐落地时的四条规则

1. 导入、个人模板复制、图片槽，最后都得到 deck.json 工程。检查和导出仍走现有 `checkDeck` / `exportDeck`。
2. 映射规格里标成「保留不可编辑」的对象，阶段 10 用 OfficeCLI 在导出时按原位置合并，诊断里用下面的固定文案。本阶段的证明只登记诊断，不写保留层，所以现在导出不会带上这些对象。
3. 路线 C 保留为外来稿定点修改。技能里现有的「先读 brief、再定点改、不要伪造保真导入」继续有效，直到这条 ADR 被接受并且阶段 10 把 `ppt_import` 接上。
4. 图片槽继续读写备注里的 `dsh.template-images/v1` JSON，字段语义与 dsh 一致。version 2 草案把它再放到页级 `imageSlots`，备注原文保留，这样旧备注和新字段是同一份合同。

导入结果以后用 dsh 的覆盖类别做对照，由 #717 按功能和产出对齐度衡量。本阶段没有运行 dsh 的导入函数。

## 工具名

Selection 侧用自己的名字：

| 能力 | 名字 | 阶段 |
| --- | --- | --- |
| 外来 PPTX → deck.json | `ppt_import` | 10 |
| 个人模板复制成任务工程 | `ppt_template_create_project` | 11 |
| 检查 / 导出 | 现有的 deck check、deck export | 已有 |

本阶段的函数叫 `importSimplePptx`，只在测试里调用。不要把它写进 `SKILL.md`。

## 本阶段证明

入口：`apps/electron/resources/skills/ppt-design/engine/pptx-import-poc.ts`。它没有从 `index.ts` 导出，也没有 CLI。

它做的事：读一份简单 PPTX（页面尺寸、纯色背景、文本框、矩形、PNG/JPEG、备注里的图片槽合同），写成现行 version 1 工程，再经 `exportDeck` 写回。和主题色相同的颜色收成 `$ink` / `$accent` / `$paper` 等 token。测试把墨色改成 `#0033AA`、强调色改成 `#00AA88` 后，导出的页面 XML 里是这两个色值，形状名仍是元素 id。这个名字就是现有 OfficeCLI 路径 `/slide[n]/shape[@name=<id>]` 用的名字；管理的 OfficeCLI 二进制存在时，测试会再 `get` 一次。

它故意不做的事：不展开组合，不重建表格和图表，不把 EMF/WMF 挂进保留层，不把母版装饰抄进页面，不写 `layoutRef` / `imageSlots` / `crop`。这些在诊断里有归类，归类锁在测试里。证明文件不写 `ppt-design/styles/`。

验收：

```bash
bun test apps/electron/resources/skills/ppt-design/engine/pptx-import-poc.test.ts
```

## 交给后面的阶段

| 阶段 | 直接用什么 |
| --- | --- |
| #713 外来稿导入 | 映射规格里的四档归类，以及 `importSimplePptx` 已经走通的文本、矩形、图片、token 颜色 |
| #714 个人模板 → 任务工程 | 产出仍是 deck.json。不要另做一套工程文件 |
| #715 图片槽 | `parseImageContract` / `liftImageSlots`。备注 JSON 与页级字段双写规则见附录 A |
| #716 校验与工作流 | 用户提示文案用附录 B。检查规则仍写在 `check.ts` |

## LinNai 需要拍板的问题

是否同意以 deck.json 作为唯一工程真相：可映射的对象走路线 A，暂时表达不了的对象用路线 B 标成保留不可编辑并在诊断里说明，路线 C 只继续做定点修改、不用于改版式和整套换风格？version 仍保持 1，草案字段等到阶段 10 再接入。图片槽继续沿用备注里的 `dsh.template-images/v1` 字段语义，接入后再提升到页级 `imageSlots`。

## 附录 A. schema 草案和迁移

生产解析器仍是 `schema.ts` 的 version 1。`rejectUnknown` 照旧拒绝不认识的字段。16 套模板和 ppt-master 样例都不要改写，也不要升 version。

草案版本号是 2，类型和迁移函数在 `schema-v2-draft.ts`。这个文件不被 `schema.ts` 或 `index.ts` 引用。

| 位置 | 草案字段 | 说明 |
| --- | --- | --- |
| 工程 | `source` | `{ kind: import \| template-project \| authored, fileName?, sha256? }`。来源说明，不参与绘制 |
| 页 | `layoutRef` | `{ master?, layout? }`。母版和版式的名字。不另加 `master` 字段 |
| 页 | `imageSlots` | 与备注里的 `dsh.template-images/v1` 同一份结构 |
| 元素 | `group` | `{ id }`。组合展开后，子对象仍记得自己属于哪一组 |
| 元素 | `crop` | `{ l, t, r, b }`，各边裁掉的比例，0 到 1，对应 OOXML `srcRect` |
| 元素 | `mask` | `{ shape, path? }`。图片遮罩 |
| 元素 | `link` | `{ href }`。超链接 |
| 元素 | `runs` | 同一文本框里字号、粗体、颜色不同的几段 |
| 元素 | `retained` | `{ feature, message }`。路线 B 的保留对象。没有这个字段的元素就是可编辑对象 |

不新增 `customGeometry`。自定义几何复用已经存在的 `shape: path` 和 `path` / `pathRule`。渐变、图案、阴影、箭头、备注也沿用现有字段。

迁移规则：

1. version 1 文件原样可读、可导出。本阶段不批量改写任何 deck.json。
2. `liftImageSlots` 复制出 version 2 视图，不改入参。备注全文是一份合法图片槽合同时，复制到 `imageSlots`，备注原文留着。
3. 只有下面几条都成立，才允许降回 version 1：没有 `source`；`layoutRef` 为空；元素上没有 `group`、`crop`、`mask`、`link`、`runs`、`retained`；`imageSlots` 要么没有，要么和备注里的合同 JSON 一致。
4. 降级结果必须能被现行 `parseDeckDocument` 接受。会丢掉裁剪、分组、保留层或来源信息的降级直接拒绝。
5. 阶段 10 才让解析器接受这些字段，并让导入器开始写入。在那之前，产品路径上的工程保持 version 1。
6. 和主题色相同的颜色写成 token，换 `theme.colors` 时跟着变。对不上的颜色保持 `#RRGGBB`，并给出 `direct-color` 诊断。

## 附录 B. 用户提示文案

下面这些句子是阶段 10 界面和诊断要用的原文。权威副本在 `IMPORT_USER_MESSAGES`。本阶段没有界面对用户显示。

| 对象 | 档 | 文案 |
| --- | --- | --- |
| SmartArt | 不支持 | 这是 SmartArt。当前不能改里面的文字和结构。请在源文件里拆成形状后再导入。 |
| 嵌入对象 | 不支持 | 这里嵌着一个外部对象。工程里不能编辑它。 |
| 音频 | 不支持 | 音频不会进入可编辑工程。 |
| 视频 | 不支持 | 视频不会进入可编辑工程。 |
| 动画 | 不支持 | 动画不会保留。 |
| EMF | 保留不可编辑 | 这张图是 EMF 图元。不能改成可编辑图片。以后导出会把它留在原位，改版式时它不会跟着动。 |
| WMF | 保留不可编辑 | 这张图是 WMF 图元。不能改成可编辑图片。以后导出会把它留在原位，改版式时它不会跟着动。 |
| 组合 | 保留不可编辑，直到阶段 10 展开 | 这一组还没有拆开。组里的形状暂时不能单独改。 |
| 表格 | 保留不可编辑，直到阶段 10 重建单元格 | 表格还没有拆进工程。单元格暂时不能改。 |
| 图表 | 保留不可编辑，直到阶段 10 能重建的图表改成近似 | 图表还没有拆成可编辑数据。 |
| 超链接 | 近似，文字保留 | 超链接没有写入工程。文字还在。 |
| 自定义几何 | 保留不可编辑，直到写成 `path` | 自定义形状还没有转成路径。 |
| 图片裁剪 | 近似，整图先留下 | 图片裁剪还没有写入工程。阶段 10 会用 crop 字段保住裁剪。 |
| 其他保留对象 | 保留不可编辑 | 这个对象按原位置保留，但不能在工程里改版式。改版式或换风格时它不会跟着动。 |
