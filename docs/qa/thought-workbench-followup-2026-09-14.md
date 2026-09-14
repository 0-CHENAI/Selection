# 编排工作台后续测试记录（2026-09-14）

检查点：`codex/thought-workbench` / `8bad7818`。本记录不是全量验收通过声明。

## 1. 800×700 窄屏布局

已改 `ThoughtCanvas.tsx`：窄屏单列改为 `content-start` + `overflow-y-auto`，画布固定 `h-64`，编辑面板 `min-h-80`，大屏仍并排。

真实隔离 Electron（`--user-data-dir` + CDP 9333，窗口 inner 800×700，`rem=15`）已量到 testid：

| 项 | 修复前（同窗口） | 收束 chrome 后 |
| --- | --- | --- |
| 提案 | 默认展开，大文本框 | 思考页收起 |
| 工具条 | 四行按钮 | 一行：问答 / 笔记 / 添加材料 / 更多 |
| 分区可见高 | 153 | 387 |
| 画布高 | 240（几乎在折页下） | 240（完整可见） |
| 编辑面板 | 300，但整块在折页下 | 300，首屏可见空状态，可滚入 |

编辑面板不再被压到约 24px。次要操作（摘要、分组、导出、导入副本等）在「更多」。模板库 / YAML 导入改到编排图页。

证据：

- `docs/qa/thought-workbench-electron-narrow.json`
- `docs/qa/thought-workbench-electron-narrow.png`
- `docs/qa/thought-workbench-electron-narrow-scrolled.png`
- 预览对照：`docs/qa/thought-workbench-narrow-layout.json` 及 png
- 单测 `thought-canvas-layout.test.ts`、`task-human-workflow.test.tsx` 相关项通过

## 2. 真实模型闭环

隔离目录已只拷 `credentials.enc` + `llmConnections`（ORDER / Selection Backend，无 Fable5），同一机器可解密两个 `llm_api_key`。未拷用户工作区。上一隔离 Electron 被 SIGTERM 停掉后已带着连接重启；启动日志对 `pi-api-key-2` 完成 auth 初始化。

隔离 Electron 用 ORDER / Laufry 跑完一轮真实模型桌面闭环（不是模拟端点）：

- 问答预览：`Laufry` / `openai-completions` / contextWindow 262144，系统提示写明 **No tools are available**。
- 三轮局部提案均生成并通过「检查节点与依赖」后应用到草稿；应用后 `tasks/` 仍只有 legacy 夹具，没有 `real-model-qa`。
- 手动改标题为 `manual-edit-stale` 后重新提案，goal 写成 `confirm arithmetic after a manual title edit`；应用仍不写任务。只改工作台标题不会改 `draftIdentity`，因此那次没打出失效文案。后来用「生成提案 → 不应用 → 改 YAML → 应用到草稿」打出了 `tasks.proposalStale`。
- 「保存」创建 `tasks/real-model-qa/task.yaml`（仅定义，无 run），界面「编排已创建，尚未运行。」
- 「创建并运行」产生 `run-1789349991037`：节点 `ask` 在 7.4s 内完成，输出 `2 + 2 = 4。`，`tokensUsed=33321` / `modelMs=7413`。V3 因带 `acceptance_criteria` 且本次 run 没有 orchestratorSessionId，质量门把整次运行标成 **failed**（节点本身是 done）。结果已「添加到思考视图」。
- Agent 预览 61 个工具（对比问答 0 工具）。真实 Agent 在隔离工作区列出 `.claude-plugin` / `config.json` / `tasks` / `thought-workbenches` 等，未改用户 `~/.selection`。只读 `Ls` / `echo` 被 AST 自动放行，界面不出「需要权限」。

证据：`docs/qa/thought-workbench-real-model.json` 及 png、`thought-workbench-real-model-agent.json`。

### 2c. Agent 写入审批 / 取消 / 恢复

`touch /tmp/selection-thought-wb-qa-probe/write-probe.txt` 会弹出「需要权限」。输入区有一份 `invisible` 测量克隆，`.click()` 点到第一组「不允许」是空操作。必须点可见的 `[data-tutorial="permission-banner"]`。

隔离窗口实测：

| 步骤 | 结果 |
| --- | --- |
| 可见「不允许」 | 日志 `allowed=false`；模型回复命令被拒绝、文件未创建；探针文件不存在 |
| 重开同一草稿 | 未自动再弹「需要权限」，未重跑 `touch` |
| 再生成后可见「允许」 | 新会话 `260914-keen-copper`，日志 `allowed=true, alwaysAllow=false`；`write-probe.txt` 在允许后出现（0 字节） |

证据：`docs/qa/thought-workbench-agent-write-permission.json` / `.png`，`thought-workbench-agent-allow-resume.json`，`thought-workbench-agent-deny.png` / `recover.png` / `allow.png`。

### 2d. 提案失效文案

生成提案出现「检查节点与依赖」后不应用，改 YAML 追加 `# stale-edit-marker`，再点「应用到草稿」。`[role=alert]` 为：「提案生成失败，输入已保留。 生成期间草稿已修改，请重新生成提案以保留人工修改。」所需 `tasks.proposalStale` 文案在内，但套了 `tasks.proposalFailed` 前缀。未写 `tasks/proposal-stale-qa`。

证据：`docs/qa/thought-workbench-proposal-stale.json` / `.png`

## 2b. 材料内存

隔离窗口导入 2.8MB `large-material.txt`：约 1.3s 完成，原件 blob 2,808,000 字节，但 `document.json` 也约 2.82MB（全文内联进节点 materials.text）。阅读器打开 2,736,000 字符并可滚动。JS usedSize 受 GC 影响可升可降；embedder heap 从约 6–9MB 升到 139–260MB。这是真实界面证据，不是帧率基准，也不代表 PDF 解码峰值。

证据：`docs/qa/thought-workbench-materials-ui.json` / `.png`

## 3. 其余产品验收

已补：

- TaskRunner：`waiting-approval` 且 `lastFailure` 为 `feedback-delivery-*` 时快照暴露 `blocker`。原失败项 `allows explicit feedback retry after delivery failure and restart without opening the gate` 现通过；未把整个 runner 套件写成全量发布验收。
- 冲突恢复 UI：同字段 CAS 冲突弹出面板，必须点「保留当前 / 保留已保存」，渲染时不自动选边。隔离 Electron 实测 `/title`：保留当前后 revision 3、标题 `local-conflict-qa`，未创建 `tasks/` 运行。
- V1 迁移 UI：打开关联 `legacy-v1` 的工作台进入执行视图，横幅提示将在**保存时**写 `schema_version: 2` 并备份；本次未点保存，`task.yaml` 与打开前逐字节一致，无 `.history`。不是 V2→V3 确认保存的完整迁移验收。

证据：

- `docs/qa/thought-workbench-conflict-ui.json` / `.png`
- `docs/qa/thought-workbench-migration-ui.json` / `.png`

- V2→V3 确认保存：执行视图露出 YAML 页签（不再把「编排图」在 yaml/results 上误标为选中）。隔离 Electron 实测：点保存弹出「确认保存为 v3」；点取消后 `task.yaml` 与 `.orig` 逐字节一致、无 `.history`；再确认后写成 `schema_version: 3` 并生成 `.history/2026-09-14T01-31-14-896Z.yaml`。保存管道会补 `runner: conduct` / `kind: session`，未静默迁移、未启动运行。

证据：

- `docs/qa/thought-workbench-v2v3-ui.json` / `.png`
- V2 `cache: pure` → `run-pure`：新夹具 `legacy-v2-pure` 打开后改 YAML 为 v3 且保留 `cache: pure`。确认框列出 `cache: pure on a becomes run-pure`；取消后文件不变；确认后磁盘为 `schema_version: 3` + `cache: run-pure`，并有 `.history`。未启动运行。
- `docs/qa/thought-workbench-v2-cache-pure-ui.json` / `.png`

- 主题：设置 → 外观切换浅色 / 深色后，思考画布 `html` class 与分区底色跟着变。浅色 stage/editor `oklch(0.98 …)`，深色 `oklch(0.145 …)`。画布控件（搜索、工具条、React Flow）在两种主题下都可读。
- 无障碍：思考分区可见控件无空名称；`标题` / `草稿` / `添加材料` 有 aria-label。选中问答节点后出现 `textarea[aria-label=问答]`。状态用 `role=status`。
- 键盘：`标题` 可聚焦，Tab 下一站是「思考」，随后焦点落到侧栏会话列表，画布内没有闭合的键盘环。未单独验收 React Flow 的删除 / 方向键。

证据：`docs/qa/thought-workbench-theme-a11y.json`，`thought-workbench-theme-light.png` / `theme-dark.png`。

- 安装包内嵌服务：隔离 Electron 正常退出后，用 `CRAFT_FEATURE_THOUGHT_WORKBENCH=1 bun run electron:build` 再 `electron-builder --mac --arm64 --dir --publish never` 打出 `apps/electron/release/mac-arm64/Selection.app`。第一次打包装进的 Pi 仍是 `apps/electron/resources` 旧副本；`copyPiAgentServer` 同步后再打，主进程 / Pi / Photon WASM / ThoughtDAG notice 与本次源码 SHA-256 一致。`codesign --verify --deep --strict` 通过（ad-hoc，未公证）。包内 Bun 输出 `1.3.10`；Pi 子进程打印 `starting` 后 stdin EOF 正常退出。复制时提示根目录没有 koffi（与此前记录一致，未阻止本次启动）。

  安装包用独立 `CRAFT_CONFIG_DIR` / `user-data-dir` / CDP 9334 启动，**没有** `CRAFT_SERVER_URL`。页面是 `file://…/Selection.app/…/dist/renderer/index.html`，不是 Vite。进程监听 `127.0.0.1:53090`（内嵌 RPC，随机端口）。点「新建编排」出现思考 / 画布 / 编辑分区。用户本机 `bun run electron:dev`（5173）未停。这不是 DMG 安装或公证发布。

证据：`docs/qa/thought-workbench-packaged.json` / `thought-workbench-packaged-ui.json` / `thought-workbench-packaged-ui.png`。

- 材料流式帧率 / PDF 解码峰值（隔离 Electron 真实窗口）：
  - 样本 `sample-invoice.pdf`：导入 456ms，默认画布 765×990，点放大到 150% 后 **1147×1485**（与先前实现记录一致）。页码选择「第 1 页 / 第 2 页」；第 2 页文本 1272 字符，画布仍 765×990。在第 2 页对全文做选区后点「引用选区」，界面显示 `0–1272` 并新增引用节点。
  - 40 页探针 PDF（569KB）：导入 167ms，渲染画布 765×990，抽出 4080 字符。导入前后 Runtime heap used 81.0→82.2MB，embedder 8.4→8.9MB。导入完成后 2.5s rAF 采样 `performance.memory.used` 约 148.5MB，波动约 80KB。这是导入后稳态，不是 `getDocument` 瞬时峰值。
  - 2.8MB 文本：导入 955ms，阅读器 2,736,000 字符。滚动 45 帧 p50 **16.7ms**、p95 18.7ms、最大 33.4ms，1 帧超过 33ms。embedder heap 6.8→311MB（与此前全文内联一致）。不是泄漏长测。

证据：`docs/qa/thought-workbench-materials-stream.json` / `.png`。

仍不能把上述桌面片段写成全量通过。画布内键盘环未闭合。

## 4. 默认入口

已将 `isThoughtWorkbenchEnabled()` 改为默认开启；Vite / WebUI 未设置环境变量时 bake `1`。`CRAFT_FEATURE_THOUGHT_WORKBENCH=0` 仍回到定义表单旧入口，不删除工作台文档。定义表单代码保留作回退，不是把桌面片段写成全量通过。

正式 PR：https://github.com/0-CHENAI/Selection/pull/355（面向 `test`）。#354 / #320 已写隔离验收评论。

## 数据边界

未对用户 `~/.selection` 跑 Agent。未绕过审批、未静默迁旧任务、未重跑中断工具。
