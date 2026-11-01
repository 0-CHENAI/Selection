# 阶段 06 验收记录（第一部分）：模型侧页图 `office_render`

对应 [#709](https://github.com/0-CHENAI/Selection/issues/709) 的「2026-10-31 核查补充」G1 / G14，父规划 [#703](https://github.com/0-CHENAI/Selection/issues/703)。对照基线是 dsh-desktop `588412b`：dsh 生成后用 LibreOffice 渲染、模型看图再修。Selection 对齐的是这条「生成 → 渲染 → 看图 → 修」的闭环，不复刻 dsh 的技术栈：不打包 LibreOffice Kit，不内置 Python，不用 OCR。

## 代码入口

| 能力 | 入口 |
| --- | --- |
| 工具定义与返回（文本 + 原生图片块） | `packages/session-tools-core/src/handlers/office-render.ts`，在 `tool-defs.ts` 注册为 `office_render` |
| 渲染服务（页码解析、OfficeCLI HTML、净化、排队、超时 / 取消、存 PNG） | `packages/server-core/src/services/office-page-render.ts` |
| 页内脚本（按页 / 按幻灯片 / 按 sheet+range 定位，缺字体检测） | `packages/server-core/src/services/office-page-render-script.ts` |
| 桌面宿主（离屏 Electron 窗口 + `capturePage`，断网，用完即销毁） | `apps/electron/src/main/office-render-host.ts`，在 `main/index.ts` 启动时注册 |
| 会话接线、与右侧面板共用 HTML | `SessionManager` 的 `officeRenderFn`；`OfficePreviewService.htmlFor(path, sha256)` |
| 修订期策略 | `reliability/office-tool-policy.ts`（放行 `office_render`；拦截浏览器、裸 `officecli … screenshot/render`、OCR）；`isolated-workspace.ts` 放行 `office_render` |
| 系统提示 | `packages/shared/src/prompts/system.ts`：原「PDF export is not included」改为「没有 PDF 导出，看页面调 office_render，禁止 OCR」 |

## 同源说明

右侧「Office 协同」面板显示的是 OfficeCLI `watch` 输出的 HTML。`office_render` 用同一引擎的 `officecli view html`。如果同一份字节（sha256 相同）正在面板里打开，直接复用面板手上那份 HTML，结果里标 `sharedWithPreviewPanel: true`。净化规则与面板一致：去掉外链脚本和网络字体脚本，加无网络 CSP。渲染顺序取自已批准的 `native-plan.ts` preview 步骤 `officecli-html-electron-capturePage`。

Word：OfficeCLI 只在显式分页 / 分节处起新的 `.page`。没有分页符的长页按页面高度切成多张，结果附说明「页码可能与 Word 略有出入」。Excel：按 `sheet` + `range` 取区域，不给 range 时从表顶截到 2400 CSS 像素并标 `truncated`。

## 验收命令

```bash
bun test packages/session-tools-core/src/handlers/office-render.test.ts \
  packages/server-core/src/services/office-page-render.test.ts \
  packages/server-core/src/reliability/office-tool-policy.test.ts \
  packages/server-core/src/reliability/isolated-workspace.test.ts \
  packages/server-core/src/services/office-render-poc/office-render-poc.test.ts \
  packages/shared/src/agent/__tests__/session-self-management-bindings.test.ts \
  packages/shared/src/prompts/__tests__/system.test.ts
bun run typecheck:all
```

## 实机渲染（Linux x64，Electron 39.2.7 离屏窗口，OfficeCLI 1.0.158）

| 文件 | 请求 | 结果 |
| --- | --- | --- |
| coffee-market `example.docx` | `pages: "1,last"` | 共 7 页，取第 1、7 页，1191×1684，约 2.8 秒；缺字体 `Noto Sans CJK SC` |
| government-notice `example.docx` | `pages: "all"` | 无分页符，按页高切成 3 页；缺字体 `FangS-SC`、`HYKaiTiJ`、`HYZhongJianHeiJ`、`ShuS-SC` |
| annual-business `example.xlsx` | `sheet: 经营总览, range: A1:P51` | 1254×2106，约 5.4 秒；6 个 sheet 名一并返回 |
| port-cargo `example.xlsx` | 默认 | 第一个 sheet「港口总览」1323×1770 |
| PPT 样例 `.pptx` | `pages: "1,3"` | 共 6 页，1395×785 |

C5（模型取 Word 案例第 1 页和最后 1 页并看图）：上表第一行即这个调用；图片与面板同源。修订期策略单测覆盖「放行 office_render」和「仍拦截浏览器 / 裸 screenshot / OCR」。

## 还没做

- 原生高保真增强：macOS 用 AppleScript 让 Word / Excel / PowerPoint 导出、Windows 用 OfficeCLI `--render native`。这条与「模型看到的图和面板同源」有取舍，留作后续，由 LinNai 定先后。
- PDF 导出仍未进入用户路径。
- OfficeCLI HTML 对 Excel 浮动图表的定位与 Excel 本身有差异（面板里也一样），这是 HTML 引擎的限制。

## 案例样例预览（#709 补充，LinNai 2026-11-01 决定）

- 入口：首页 Word / Excel 案例卡片悬停或键盘聚焦时出现「预览」；从案例开始的会话在输入框上方显示案例名和「预览」。
- 行为：宿主按案例 id（不接受客户端路径）把样例复制到系统临时目录下按「工作区 + 会话（首页为 `@office-case`）」哈希隔离的只读文件，文件名为案例标题；在右侧 Office 协同面板打开。打开前按 catalog 的 `exampleSha256` 校验，被改动的副本会从内置样例恢复。
- 只读：面板显示「案例样例 · 只读」，不显示选择计数，宿主拒绝选择与提交修改；首页面板不显示「切换文件」，首页范围只能打开案例样例。
- 不做：构建期预览图、新的预览组件、PDF 导出与原生 Office 高保真渲染（后两项按 LinNai 决定延期）。
- 代码：`packages/server-core/src/services/office-case-preview.ts`、`SessionManager.officeCasePreview / officeHomePreview`、`useOfficePreview` 的 `selection-office-open-case` 事件、`OfficeCaseGallery`、`OfficeSessionCase`，playground「Office 案例样例预览」。
- 截图：`/workspace/sw709-shots/preview/`（浅色 / 深色 / PRO，首页 Word、首页 Excel、会话内）。

## 点卡片附上案例（#709 收尾，LinNai 2026-11-01 决定）

- 去掉 #731 的「做同款」按钮和预填提示词。卡片本身就是参考模板：点卡片（或聚焦后按 Enter / 空格）把案例附到输入框，显示为与 PPT 模板相同的倾斜封面卡片；再点一次或点卡片右上角的 × 取消。输入框里已写的文字不变，不预填任何提示词。
- 「预览」仍在卡片右上角，点击只在协同面板打开样例，`stopPropagation`，不附上案例。
- 发送时案例随草稿作为会话的 Office 案例（`office.templateId` + `revision`）传给宿主，宿主按指纹注入案例上下文、`office_template` 调用顺序和业务技能。catalog 的 `prompt` 字段不进入注入，也不再进入输入框。
- 代码：`OfficeCaseGallery`（`toggleOfficeCase`、`previewOfficeCase`）、`OfficeSelectedCase`、`AttachmentPreview`；`FreeFormInput` 的 `craft:insert-text` 恢复到 #731 之前。playground「Office 案例样例预览」新增 `composer-word`。
- 截图：`/workspace/sw709-shots/card-click/`（首页 Word 悬停、输入框里的案例卡片，浅色 / 深色）。

## 输入框里的 Word / Excel 案例卡片与 PPT 模板卡片一致（#709，LinNai 2026-11-01）

- PPT 的 `SelectedTemplate` 卡片抽成共用的 `AttachedCoverCard`：倾斜封面、两层叠页、紫色选中边框、右上角黑色 ×（悬停或菜单打开时出现）、右下角 ⋯ 菜单、从首页卡片飞入输入框的动画。PPT 与 Word / Excel 都用它，PPT 的 test id 与模板选项菜单不变。
- Word / Excel：叠页用案例封面；⋯ 打开的菜单显示案例标题、「参考案例 · 类别」和「预览样例」（有样例文件时），点击在 Office 协同面板只读打开样例并关闭菜单。PPT 的 ⋯ 仍是主题、比例等模板选项。
- 首页点卡片附上案例时，封面像 PPT 一样飞入输入框。
- playground「Office 输入框里的模板 / 案例卡片」三个真实输入框并排；截图：`/workspace/sw709-shots/input-card/`（浅色 / 深色，另有 Word 悬停和 ⋯ 菜单）。

## 案例隐式参考要点（#709，LinNai 2026-11-01 决定：样例 + 隐式提示词）

- catalog.json 每个 Word / Excel 案例（10 个，含 Selection 虚构小样）新增 `guidance`，80–150 字：从样例学什么（章节结构、版式、图表与表格类型、文风、核对方法），哪些必须换成用户材料（主题、数据、机构名、日期），不照搬样例事实和数字，缺的写「待补充」，用户这次的要求优先。
- 宿主 `buildOfficeInjection` 在所选案例的上下文里，紧跟 `office_template` 调用顺序写入「案例参考要点：…」，与案例 id / 修订、业务技能同一条注入。没选案例时不注入。system.ts 未改。
- 不进入输入框、案例卡片或输入框里的案例卡片；用户只看到样例和自己写的要求。
- 原有 dsh 的 `prompt` 字段保留不用；#734 原先补写的 5 条输入框提示词不再加入。
- 案例修订号未改：已经在进行中的会话沿用旧注入，新会话或重新选择案例后才带要点。
- 测试：`office-catalog.test.ts`（每个案例都有要点、长度与必含项；选中时注入且位置正确；未选不注入；渲染端源码不读 guidance），`office-home.test.tsx`（首页与输入框案例卡片的渲染结果里没有要点原文）。
