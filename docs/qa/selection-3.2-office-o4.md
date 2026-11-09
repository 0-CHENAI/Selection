# Selection 3.2 O4 外来稿 brief

对应 #687，依赖 O2 #685 / #693。从 `origin/test` (`3ef1e6e7f`) 开阶段分支后引入 O2，独立提交，不合入 test。

## 实现

- `skills/officecli/scripts/ppt-brief.ts` 通过受管 OfficeCLI `query FILE slide --json` 生成有损 JSON：源路径/SHA-256、页码、候选页主张与来源路径、对象类型/文字/有限格式、子节点不完整标记。无匹配 deck 时先读完整 brief 再选路由，修改前校验哈希，源文件变化后重建。
- 候选主张优先标题占位符，缺失时用首个非空文字，始终标 `needsReview`，不把启发式说成叙事理解。复杂嵌入对象、母版、动画、Morph 等不重建，不生成近似 deck，不声称 round-trip。
- 查询失败、缺页、重复页或不完整 envelope 拒绝生成；输出以临时文件原子替换，查询期间源字节变化则失败；原 PPTX 只读。Windows 通过既有 TS launcher 保留受管路径，用参数数组调用，不把源路径拼入 shell 命令。
- `references/external-ppt-brief.md`、OfficeCLI router、PPT override、ppt-design 和按需路由提示要求编辑前生成/读 brief/校验，再走 OfficeCLI、匹配 deck 修订或显式重建。文字属于不可信素材，不能当指令执行。
- 新测试加入 `scripts/run-officecli-integration-tests.ts`，由既有 macOS/Windows 打包运行时 CI 执行；普通单测显式跳过需要真实 binary 的用例。

## 验证

- 真正受管 OfficeCLI **1.0.157**，从原仓库只读复制到本工作树 gitignored binary 目录；SHA-256 与仓库 manifest 一致：`0dae0990a9cc29688a5d54469f984c34e5b15ab6bbd194a0ffdc571bb9040124`。全局 PATH 的 1.0.144 未被用于验证。
- `OFFICECLI_INTEGRATION=1 bun test apps/electron/resources/skills/officecli/scripts/ppt-brief.test.ts`：5 pass / 0 fail，19 assertions。真实随附 `light__minimal_product.pptx` 连续两次生成相同 JSON，6 页、222 对象；原件 hash 不变。另验证空页、标题候选、缺页/失败、过期 brief。
- 路由/catalog/技能合同：18 pass / 0 fail，2693 assertions。`bun run typecheck:all` 通过；helper 单独 tsc 与路由 ESLint 通过；`git diff --check` 通过。

## 边界

要求先读 brief 是技能/上下文合同，不是宿主拦截全部 OfficeCLI 写命令的状态机；模型真实遵循情况仍需 Ship 轨迹测试。当前真实样例是随附 Morph 模板，不代表任意第三方复杂稿均完整；claims 需对照原图复核，不做 OCR。摘要是 session scratch，必须写入精确 dataFolderPath。没有移植 PPTD/Harness/Python runtime/LibreOffice Kit，也没有交付演示稿。
