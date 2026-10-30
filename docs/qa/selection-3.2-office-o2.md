# Selection 3.2 O2 修订环

对应 #685，依赖 O1 #684 / PR #692。阶段分支从当时最新 `origin/test`（`3ef1e6e7f4da1e8c6a45745f2fdaa96b74dc9d60`）建立，再合入 O1 依赖；独立提交 O2，不合入 test。集成目标按主人后续授权为 `v3.2`。

## 已实现

- `packages/server-core/src/services/ppt-live.ts/exportIncrementalPptx` 调用默认带 check 的 exportDeck，`needs_revision` 时不生成新文件、不替换上一份可用 PPTX、不更新输出 stamp。写出期间工程再次变化时丢弃候选，等下一轮。CLI 的 check → render 路径继续检查，退出码 2 是正常修订反馈。
- 当前工程的宿主检查缓存优先于 sidecar；没有匹配 stamp 的旧诊断不能冒充新工程检查结果，检查异常/未检查不按通过处理。SessionManager 在发布页面状态前填充检查结果。
- `engine/screenshot.ts` 与分发 `deck-cli.mjs` 支持 `--pages N --only-pages 2,4`。校验非空、整数、范围，去重排序，保留原始页码；仅更新指定页。OfficeCLI 优先，已有 LibreOffice+pdftoppm 回退也按指定页生成 PNG。返回成功前确认目标文件存在，不能接受残留旧截图。
- `checkDeck` 不再把相邻同 layout 当错误；溢出、容量、字体、对比度、图表对账等检查保留。技能、schema/layouts 指南与实际检查器一致。
- 新增 `references/composition.md`，明确结论—主图/表—辅助证据—解读，以及锁定主题 token 下借用论证槽；整套重锁仍只由明确 restyle 意图触发。标注 DSH 固定快照来源，不加载 DSH runtime。
- G4 按范围修订：新稿/全局改变/缺少有效既往证据为全量；局部修订仅截图并原生读图受影响页。记录沿用的未改页证据，修改会使对应页证据失效；保留三次总上限及禁止 OCR。修订上下文实际传入目标页列表。

## 验证

- 引擎目录 + PPT catalog/live/library/routing：69 pass / 0 fail，4764 assertions（后补“首次失败不得生成文件”后，live 单独复跑 10 pass / 0 fail，126 assertions）。
- 原生读图政策 + 系统提示：43 pass / 0 fail，273 assertions。
- 最终截图实现及实际打包 CLI 参数透传：4 pass / 0 fail，17 assertions。截图测试使用可记录调用的替身，证明只调用 2、4 页及保留无关图，不是实际 Office 渲染/视觉质量证据。
- `bun run typecheck:all` 通过；shared 路由文案 ESLint、`git diff --check` 通过。曾在仓库根直接运行 tsc 报无 src 输入，改用仓库正式 typecheck:all，不将前者当产品缺陷。
- 分发文件用 `bun build apps/electron/resources/skills/ppt-design/engine/cli.ts --target=bun --outfile=apps/electron/resources/skills/ppt-design/engine/deck-cli.mjs` 重建，差异仅为本阶段逻辑。

## 未验证与边界

没有运行模型端到端、真实局部 OfficeCLI 截图或 PowerPoint/WPS 视觉验收；引擎 round-trip 测试在缺少随附 binary 时可以只验证 OOXML，不能把它当 CLI 实测。最终真实产物与模型工具轨迹仍需 Ship 核对。

开发用模板预览脚本与历史参考页测试仍有 `enforceCheck: false` 的显式调用，用于观察已知有问题的原始参考页；本阶段取消的是用户会话实时导出的跳过路径，CLI render 本来也不暴露此开关。参考页不得被这些开发导出结果宣称为通过或可交付。原模板没有被修改。

局部 G4 的既往证据仍由会话计划记录，未新增宿主级“逐页视觉签名”状态机；`passed` 页面状态表示结构检查，不等于模型真正看过。O3 应继续清楚区分问题页修订和视觉交付状态。外来稿 lossy brief 属于 O4，本轮不声称 round-trip。
