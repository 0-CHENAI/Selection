# Selection 3.2 O3 模板与按页修订

对应 #686，依赖 O2 #685 / PR #693。阶段从 `origin/test` 的 `3ef1e6e7f4da1e8c6a45745f2fdaa96b74dc9d60` 开分支，再引入 O2；O3 独立提交，draft PR 目标仍为 test。按后续授权可集成到 v3.2，不合入 test。

## 范围与来源

- 对照本机 DSH 固定快照 `8dec631777c34fbbcc7d45af787bdd2c468d2cfb`，用已有 `scripts/import-dsh-templates.ts` 补齐剩余 11 套；共 16 套 DSH 双语模板。真实 id 来自 metadata.definition.slug，三套 retained-native 的目录前缀 `curated-` 不属于模板 id。
- 新增 8 套 Zara MIT、3 套 retained-native MIT；`ATTRIBUTION.md` 写明来源版本及版权人，既有 Apache NOTICE 不变。不引入 Harness/PPTD/runtime。
- 原导入中英文页位于 `styles/<id>/`。修正文本断行、对比度、连线与少量语义装饰标记后，独立写入 `styles/examples/imported/<id>/`，目录指向这些适配样例；原封面/内容/尾页及既有五套均不覆盖。`scripts/adapt-dsh-office-templates.ts` 可重复执行，`styles/dsh-import-diagnostics.json` 记录源诊断与剩余诊断。源文案是示例，新稿仍必须换成用户素材。
- 11 套 × 中英文 × 12 页 = 264 页，经 schema + checkDeck；22 份适配工程无结构 issues。
- 更新 picker/catalog、中文名/分类和完整中文 12 页 WebP + vector PDF 预览。保留现有首页排序。预览脚本新增指定模板范围、按当前平台选择字体，并用已有 sharp 编码 WebP，避免依赖本机 ffmpeg 的 libwebp 编译选项。

## 界面与数据合同

- 模式入口沿用 `PptPickerButton` / `PptHomeGallery`；`TemplateGallery` 已有分类、搜索、自定义模板上传/重命名/删除/导出、逐页预览，服务由 `ppt-library.ts` 提供。本阶段复用这些入口，不重复造一个 Composer 或引入 Harness。
- `PptResultCard` 菜单新增“按页修改”，`PptIssueRevisionPanel` 默认选首个有诊断的页；可切换页码、预览此页、描述局部修改或点击“修复此问题”。仍保留显式换风格/换配色入口。
- 宿主进度提供 `issues[]`（code、message、elementId），每页最多展示 50 条，issueCount 仍为完整数；文案提示代理编辑前读取完整当前诊断。旧会话只有 issue 字段仍能展示。进度签名包含 issues，避免诊断变化却不刷新。
- 问题按钮发送 `action: revise` 与精确 `{page, elementId}`；手动修改只发送所选 page。没有把诊断点击变为 restyle；空修改禁用提交。7 个语言包补齐文案。

## 验证与边界

- 55 tests / 0 fail / 3689 assertions：live、catalog、library、deck、结果卡、技能合同。包括新增 11 套覆盖、所有逐页资源、RPC 大小边界、诊断数量截断/元素定位与旧模板回归。
- `bun run typecheck:all` 通过；`git diff --check` 通过；shared 协议与三个 Electron 变更组件定向 ESLint 通过。仓库根没有 ESLint 配置，改为包内定向检查，不宣称全仓 lint 通过。React 服务端静态渲染测试有既存 useLayoutEffect 警告，浏览器交互另外验证。
- Ego 实际 playground：completed 场景空描述禁用；选第 2 页提交后收到 `{action:'revise',targets:[{page:2}]}` 且仅一次；attention 场景默认第 6 页，点击诊断收到 `{page:6,elementId:'market-title'}` 且仅一次。按页面板原生截图已读，未用 OCR。
- 原生读图检查 11 套封面及 9 张关键适配页（模块物流 1/9/10、宣言海报 1/6/12、樱花 12、趣味 2、北欧 3）。不是全部 264 页的视觉验收，也不等于 PowerPoint/WPS 保真验证。
- 初次 headless LibreOffice 未找到中文字体，生成方框；读图发现后以临时 FONTCONFIG_FILE 显式包含 `/System/Library/AssetsV2/com_apple_MobileAsset_Font8` 等本机字体目录，重新生成全部新增资源，PDF 字体确认有 PingFangSC。未修改系统字体或运行时安装。复现时须保证渲染器能访问模板所需中文字体；脚本 `--templates=id1,id2 --force` 仅刷新指定模板。
- 新增模板预览为开发资源，不是向用户交付的演示稿；沿用模板预览既有 LibreOffice 转 PDF 流程，不引入 LibreOffice Kit。模型真实工具轨迹、英文全部页面视觉验收和 Office 成品编辑验证留待 Ship，不能用结构检查替代。
