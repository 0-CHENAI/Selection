# Selection 3.2 Office/PPT Ship 验收

对应 [#718 整体验收与交付](https://github.com/0-CHENAI/Selection/issues/718) 与 [#703 Office 能力对齐 Epic](https://github.com/0-CHENAI/Selection/issues/703)，里程碑 Selection 3.2（#9）。实现已通过 #749 / #755 合入 test，发布验收基线为 v3.2.0-beta4。最终状态、已接受遗留和 LinNai 决定跳过的验收见文末「#718 最终交付」。

以下 O0–Ship 与 #698 段落保留历史验收证据，其测试数字和临时路径只对应各自当时的运行，不代表本次重新执行。

## 阶段交付与证据

| 阶段 | 历史阶段 PR | 交付与验收记录 | 当前证据 |
| --- | --- | --- | --- |
| O0 #683 | [#691](https://github.com/0-CHENAI/Selection/pull/691) | [基线入口与缺口表](../plans/selection-3.2-office-baseline.md) | 纯文档盘点，无运行时改动 |
| O1 #684 | [#692](https://github.com/0-CHENAI/Selection/pull/692) | [三分路由](selection-3.2-office-o1.md) | 阶段 CI 通过；三个真实路由用例均已独立复核 |
| O2 #685 | [#693](https://github.com/0-CHENAI/Selection/pull/693) | [修订环](selection-3.2-office-o2.md) | 阶段 CI 通过；真实拒绝导出/旧文件保护/局部截图通过 |
| O3 #686 | [#694](https://github.com/0-CHENAI/Selection/pull/694) | [模板与按页 UI](selection-3.2-office-o3.md) | 阶段 CI 通过；22 个双语适配工程、264 页结构检查通过；预览与 UI 原生复核范围见阶段记录 |
| O4 #687 | [#695](https://github.com/0-CHENAI/Selection/pull/695) | [外来稿 brief](selection-3.2-office-o4.md) | 阶段 CI 通过；真实摘要、hash 校验与模型完整读取后编辑通过 |
| O5 #688 | [#696](https://github.com/0-CHENAI/Selection/pull/696) | [Word/Excel 案例](selection-3.2-office-o5.md) | Validate 41004874701、OfficeCLI 41004874522 成功；已纳入 Ship 组合基线 |
| Ship #689 | [#697](https://github.com/0-CHENAI/Selection/pull/697) | 本页与两个验收脚本 | 阶段验收完成；后续整合与发布见文末最终交付 |

O5 当时在所固定的 DSH 来源中未找到案例，采用了标记为 Selection 原创的业务编排；后续 #704 来源清单和 #708 / #711 案例阶段已补齐 dsh Word/Excel 样例，当前覆盖以 #717 对齐报告为准。仍使用 OfficeCLI 模板副本与定点修改；没有引入 PPTD、Harness、Cordis、Python office-runtime、LibreOffice Kit 或替换编辑器。

## Ship 门禁

| 门禁 | 状态 | 权威证据 / 剩余工作 |
| --- | --- | --- |
| 真实 deck check → export、局部截图 | 通过 | 下述真实工具脚本；保留旧 PPTX、第 1 页截图的 hash 和 mtime |
| 标题修改走 OfficeCLI，不重锁/重生成 | 通过 | `261030-eager-forest`，原始字节副本对照仅目标标题变化，deck hash 不变，原生图与 validate 通过 |
| 仅改两页版式走 deck | 通过 | `261030-open-meteor`，原始 PPTX 对照：其余 10 页及主题/母版/版式 XML 不变；2/4 页原生图与 validate 通过 |
| 显式整套换风格 | 通过 | `261030-tall-pearl`，12 页页序/事实保留、主题改变；12 页原生复核，最终文件重截图散列一致、validate 通过 |
| 外来稿先完整读 brief、verify 后编辑 | 通过 | `261030-ivory-delta`，完整连续读取 7886 行、写前 verify、只改标题、写后重建 brief；原文件逐部件对照与原生图通过 |
| O4/O5 真实组合、类型检查 | 通过 | 7 tests / 82 assertions；typecheck:all 通过 |
| 完整 validate:ci | 通过 | `/tmp/selection-3.2-ship-validate-prepared.log`，退出码 0；包括全量测试、typecheck、lint、i18n |
| 实现提交 CI | 通过 | a76b483823053ae2172f68d5982e0232f1bd3231；[Validate 41008458729](https://github.com/0-CHENAI/Selection/actions/runs/41008458729)、[OfficeCLI 41008458731](https://github.com/0-CHENAI/Selection/actions/runs/41008458731) 成功；收尾文档提交不改实现，最新 PR 检查另行回读 |
| 双平台安装包 | 通过 | [run 41008459694](https://github.com/0-CHENAI/Selection/actions/runs/41008459694)，macOS/Windows 构建、校验和与上传成功，publish-release 按条件 skipped |
| v3.2 实现组合 | 已集成并推送 | e8eb83485c6f1d25eae046b45e37976138be11cd 含 O0–O5 与 Ship，跟已通过全部门禁的 a76b48382 文件树完全一致；后续仅同步收尾文档 |
| test 合入后 Validate + Package | 已通过（beta4 基线） | Validate 41323060340、Package 41323060317；链接及提交见文末最终交付 |

## 复现方法

先准备仓库受管 OfficeCLI 与模型子进程，不使用系统旧版本 CLI：

```sh
CRAFT_OFFICECLI=/绝对路径/受管原生officecli bun scripts/selection-3.2-office-ship.ts
bun run server:build:subprocess
bun scripts/selection-3.2-office-routing-live.ts title
bun scripts/selection-3.2-office-routing-live.ts layout
bun scripts/selection-3.2-office-routing-live.ts restyle
bun scripts/selection-3.2-office-routing-live.ts external
bun run validate:ci
```

真实工具脚本遍历 O3 的 22 个中/英文适配工程，逐个 schema/check；调用随包 deck-cli render 与受管 OfficeCLI validate；注入越界元素确认 needs_revision / 退出码 2 不覆盖旧 PPTX；先实际截第 1 页，再只截 2/4 页，检查 PNG、文件清单、第 1 页 hash/mtime 与原素材/交付 hash。最新通过证据在 `/var/folders/jr/49n0sbtj1h56v4zmy5v7rwzh0000gn/T/selection-3.2-ship-CGo2Di/evidence.json`。原生复核两页中文、标题、三要点/四阶段图表正常；不代表全部模板全页视觉通过，不使用 OCR。

真实模型脚本使用默认连接，建立隐藏 PRO 会话、独立临时目录与固定素材。用户提示只描述意图，不预告期望工具。记录原文件 `before.pptx.bin`、修改前后工程/散列、完整消息与工具轨迹；既有工程附真实全页修改前截图与源哈希，明确截图存在不等于视觉通过。外来稿不伪造 deck。脚本断言标题实际写入、office_edit 不改工程、局部改版不改其余页/主题、restyle 确实改变主题；仍需独立核对工具顺序、事实内容与原生视觉，不能仅靠退出码或模型自报。

## 已完成的真实标题复核

默认 pi-api-key / Laufry，最终会话 `261030-eager-forest`；轨迹 `/var/folders/jr/49n0sbtj1h56v4zmy5v7rwzh0000gn/T/selection-3.2-route-title-wwJb1m/trace.json`，独立复核同目录 `independent-review.json`。实际通过 OfficeCLI 改第 2 页标题 run，deck 前后 SHA256 一致，无重锁或 deck 重导出，目录只有一份交付 PPTX。

先核对 `before.pptx.bin` 的 SHA256 与记录一致，再对全部 60 个 `ppt/` 部件比较 XML 树/属性/文字及媒体字节，仅忽略子节点间缩进。唯一实质差异是 slide2.xml 的指定标题；其余页面、备注、主题、母版、媒体一致。OfficeCLI validate 零错误；原生读图 `data/slides/verify-slide-02.png` 标题正确、无裁切/重叠/缺字。采集器的最终标题、工程未变等硬断言均通过。此前会话 `261030-warm-dolphin` 也通过，但只使用重建内容基线；最终结论使用本次保留的原始字节副本。

## 实测发现与已修复问题

- **导出结构**：原始 PptxGenJS 把 notesMasterIdLst 放在 sldIdLst 后，真实 OfficeCLI validate 报错。在既有 ZIP 收尾阶段交换相邻列表，保留内容/关系；重建 deck-cli。20 项 deck 测试 / 480 assertions 通过，包含备注内容与顺序；实际导出 validate 零错误。
- **交付路径**：仅补 fixture stamp 仍出现副本；证实 macOS `/var` 与 `/private/var` 别名导致交付归属失效。读取记录统一真实路径，边界检查仍拒绝会话/工作目录外文件。ppt-live 11 tests / 132 assertions 通过，标题真实重验不再出现副本。
- **定点写回**：模型曾同步 deck.json，从而触发实时导出。路由合同明确 office_edit 本轮不写工程，实际后续 deck_revision 时才对账，避免覆盖 CLI 编辑。
- **brief 完整读取**：首轮先生成且写入前 --verify，但自行缩略文本丢失 path/format。参考文档明确实际字段与连续分段读取原 JSON；首轮不计完整通过；修正后真实用例已完整读取并通过独立复核。

## 验证失败的记录与边界

首次真实模型启动因缺 pi-agent-server 构建而失败，执行仓库 subprocess 构建后恢复；错误轮未记为通过。

完整 validate:ci 首次在 deep-link-routing 导入 Electron 时因本机缺安装产物失败。补齐锁定版本 Electron 39.2.7 后，失败项原样通过，未改依赖版本。第二次在真实网络 GitHub OAuth metadata discovery 超过默认 5 秒时失败；该文件原样单独重跑 7 pass / 11 assertions，未跳过或延长超时，第三次遇到下述随包 Bun 缺失，补齐后重新执行，最终完整命令通过。

历史双平台打包运行于功能分支，publish-release 当时按条件跳过；后续 test 的 beta4 发布已通过独立 Validate / Package，不能将这两次运行混为一次。

Beta 文案：**更聪明的改稿**——保留 OfficeCLI 定点编辑，增强已有演示稿的版式修订、按页反馈、模板参考与外来稿结构理解。没有替换编辑器，不承诺任意复杂 PPTX 无损往返。

## 其余真实用例的独立复核

- **局部版式**：`/var/folders/jr/49n0sbtj1h56v4zmy5v7rwzh0000gn/T/selection-3.2-route-layout-lzzS43/trace.json`。磁盘 JSON 对照只有 2/4 页变化，所有原文/数值保留，theme 完全相同。原始 PPTX hash 已核验；其他 10 页及 theme/master/layout XML 树一致。两张最终图原生复核符合上方主张/下方三要点、四列旅程，未见遮挡；validate 零错误。采集器末尾曾因内存 schema 的 `logo: undefined` 与 JSON 缺省字段误报，已改为磁盘原 JSON 基线，同一轨迹重新应用全部范围断言通过，没有放松字段比较。
- **整套换风格**：`/var/folders/jr/49n0sbtj1h56v4zmy5v7rwzh0000gn/T/selection-3.2-route-restyle-kEPoe7/trace.json`。12 页 id/页序一致，主题变蓝；除旧风格标记 MONOCHROME 外，所有原文本/数值在相应页中保留（允许换行/合并标签）。最终 PPTX 文本与最终 deck 逐项一致，validate 零错误。独立原生读完 12 页，无明显溢出/遮挡；从最终交付重新截图到 `/tmp/selection-3.2-restyle-final-images`，12 张散列均与复核图一致。备注已随新布局改写，不声称备注字节不变。此用例启动于路径修复前，模型最后收敛副本为单一文件；路径修复的独立回归由标题/局部版式用例证明。
- **外来稿**：`/var/folders/jr/49n0sbtj1h56v4zmy5v7rwzh0000gn/T/selection-3.2-route-external-15hmWd/trace.json`。编辑前 Read 原 brief，起始行依次 1/901/1801/2701/4001/5301/6601，工具实际回包连续覆盖 7886 行，无截断缺口；随后 --verify 再 OfficeCLI set，写后重建 brief。与保留原字节逐个 PPT 部件对照，仅第 2 页目标标题改变；无 deck 重建。原生读图、validate、脚本最终标题断言均通过。

第三次完整 validate:ci 暴露工作树 `apps/electron/vendor/bun/bun` 未准备，导致 Word Heading/TOC 辅助器退出 127。按 CI 同样的受信任 Bun staging 方式补齐 gitignored 运行时，原失败文件 `officecli.test.ts` 26 pass / 199 assertions；随后完整 validate:ci 退出码 0，成功通过。

打包上传失败原因已定位为 artifact 名含功能分支的 `/`，上传/下载统一改用 `github.run_id`（只改命名，不改发布条件），修复后 run 41008459694 已验证两个平台完整上传成功。


## 2026-10-30 历史交付回读（后续状态见最终交付）

2026-10-30 回读确认：PR #691–#697 全部 open/draft、base=test、milestone=Selection 3.2，对应 Closes #683–#689；没有 PR 合入 test。远端 test 仍为 `3ef1e6e7f4da1e8c6a45745f2fdaa96b74dc9d60`。本轮相对 test 的改动未涉及 effort/WebGL/Fast；既有模板原页未覆盖，新增适配与预览位于独立目录。

已上传产物 `selection-macos-arm64-41008459694`（917058115 bytes）与 `selection-windows-x64-41008459694`（419756808 bytes），当时均未过期。当时没有发布 GitHub Release、关闭 issue/里程碑或制作面向用户的 PPT 成品；PPTX/Word/Excel 文件均为验收夹具。后续合入和发布见最终交付。

## #698 整合修复与本地复核

该历史阶段以 `origin/test` 的 `3ef1e6e7f`（#690）为第一父提交，将 `origin/v3.2` 的 `ef17477df` 本地无冲突整合。当时只承接 O0–Ship 并修复整合缺口，尚未执行后续合入和发布；当前状态见最终交付。#691–#697 保留为阶段档案，由 #698 的单一整合 PR 承接，不再逐条硬合；#681 已由合入的 #690 取代。

### 相对 v3.2 的修复

- **实际运行状态回退**：旧路径在换风格/配色后仍将输入框残留 `ppt` 写为 `generate`，覆盖 `ppt-choice.json`。修复前真实状态 API 回读得到旧模板/主题；修复后普通跟进为 `revise`，已选模板/主题保留。显式修订优先，仅 restyle 携带模板、recolor 携带主题。
- **已有预览与新建上下文冲突**：无匹配 deck 的已授权 PPTX 预览不再收到新建上下文；读取持久化用户消息的授权路径，也覆盖排队重放。Word/Excel 预览不被误判为 PPT 跟进。
- **按页修订边界**：选页不等于授权重排；文字/数据/图片/局部格式走 OfficeCLI，不再同时要求改写并导出 deck。跟进图表不注入残留的生成配色。保存的 PPTX 仍是定点编辑后的权威文件。
- **模板合规**：补齐 DSH、DSH PPT（含此前遗漏的 DeepSeek and WorkBuddy PPT contributors）、Zara 的完整 MIT 与 HTML Anything 的完整 Apache-2.0 许可；新增技能 NOTICE 和根 NOTICE 入口，纠正只含五套/未导入其余套/许可正文已存在等矛盾。固定来源与路径见 [ATTRIBUTION](../../apps/electron/resources/skills/ppt-design/ATTRIBUTION.md)。不改变本体 Apache-2.0 许可，不给第三方模板另加非商业限制。
- **适配与噪音**：适配器完成全部 22 份检查后才写出，避免晚期检查失败部分覆盖早先产物；隔离对照实测旧版发生部分覆盖、修复版保留旧输出，成功时 22 份适配与随包产物字节一致。清理重复 release-note 分节、固定技能文案/目录连接断言，保留范围、版本、格式、公式和旧交付保护测试。保留功能分支 artifact 名称修复，因为 `/` 确实阻断 Ship 上传；发布条件未扩大。

### 本次已执行的验证

- `bun run officecli:check`、`officecli:prepare`：锁定 1.0.157 清单/策略/资源一致，准备受管原生二进制。
- 9 个相关文件定向回归：**67 pass / 0 fail / 3707 assertions**，包含路由状态优先级、修订范围、持久化、既有 PPTX 字节保护、模板检查和局部截图。
- `OFFICECLI_INTEGRATION=1 bun test scripts/selection-3.2-office-cases.test.ts apps/electron/resources/skills/officecli/scripts/ppt-brief.test.ts`：**6 pass / 0 fail / 69 assertions**；实际 Word/Excel 保格式定点修改、公式与 hash 检查、真实外来稿摘要和源版本核验。
- `bun run validate:ci`：**退出 0**；包含全工作区 typecheck、renderer 冷启动、共享/Pi/文档工具、全部受管测试、lint、i18n parity/sorted/coverage。存在现有 lint warning、Node deprecation 与 sourcemap 提示，无阻断错误。运行前使用 frozen lockfile 安装依赖、准备受管 Bun/OfficeCLI 和锁定 Electron 39.2.7；不修改依赖版本。本机 Bun 1.4.4（CI 配置为 1.3.10），远端结果仍独立看待。
- `selection-3.2-office-ship.ts`：22 个双语适配工程 / 264 页结构检查通过；实际 deck-cli 导出与 OfficeCLI validate 通过；越界稿退出 2 且不覆盖旧文件；只截 2/4 页保留第 1 页 hash/mtime。原生复核 2/4 页标题、中文、三要点和四阶段图表无明显裁切/遮挡。证据：`selection-3.2-ship-dksFOd/evidence.json`（本机临时目录）。不代表全部模板全页视觉通过。
- 真实 Chromium playground：诊断默认选择第 6 页、空评论禁用、诊断提交仅含 page 6 / `market-title`；切到第 2 页后仅提交该页评论，无旧元素残留；菜单焦点恢复后面板保持打开。
- #690 实现文件与 `3ef1e6e7f` 精确对照无差异；真实输入组件验证 Max canvas 出现/离开 Max 释放、Fast 不随 effort 改变、创建请求保存 `fastMode: true` 和 `thinkingLevel: medium`、重开与紧凑菜单保留、忙碌/不支持禁用。
- `electron:build:resources` 实际复制后，ATTRIBUTION、NOTICE 和五份 LICENSE 共 **7 份文件逐字节一致**。
- `selection-3.2-office-routing-live.ts title`：真实隐藏 PRO 会话 `261030-gentle-nickel` / Laufry 完成 OfficeCLI 定点改第 2 页标题；deck hash 不变、工作目录只有一份交付。独立核对原始字节副本 SHA256 与最终 hash，比较全部 **60 个 `ppt/` 部件**的 XML 树/媒体：唯一语义变化是 `slide2.xml` 的指定标题，其余页/备注/主题/母版不变；新增 `docProps/custom.xml` 为 OfficeCLI 元数据。实际最终文件再次 `validate` 零错误，重截第 2 页原生查看标题正确，无明显裁切/遮挡。轨迹与独立记录位于 `selection-3.2-route-title-GQ925j/{trace,independent-review}.json`（本机临时目录）。本次未重复运行真实 layout/restyle/external 模型用例；这些场景的历史验收与本次状态/合同回归分开记录。

### 仍需区分的风险

三分路由是明确的模型工具合同，不是对任意模型行为的强制沙箱。外来复杂 PPTX 的母版继承、动画、SmartArt、OLE 等仍不保证无损往返；后续 deck 修改前必须对账 OfficeCLI 改过的成稿。新增三套 retained-native 的底层版权仍来自上游声明，不等于独立法律确权。部分 JSON 的 `v0.2.21` 是继承的导入器标签，以 ATTRIBUTION 固定提交为准。适配器只保证检查失败不写出，不保证磁盘错误/进程中断下跨文件事务性。本次未重打双平台安装包，历史功能分支包与 CI 不能冒充本整合提交的新验收。

## #718 最终交付（2026-11-02 收尾记录）

### 实现、集成与发布基线

Office 能力基于 OfficeCLI + TypeScript / Electron；不打包 LibreOffice、不为 Office 链路内置 Python、不移植 PPTD。实现基线是 `office-align-3.2@16569b3e561b8cba8c1cec8838bf675802da846f`，文件内容已分两次 squash 进入 test。不能用原提交不在 test 祖先链中推断实现未合入。

| PR | 交付能力 | test 上的合并 SHA |
| --- | --- | --- |
| [#749 Office 能力整体集成](https://github.com/0-CHENAI/Selection/pull/749) | 整合案例、模板、业务工具、导入修订、版式守卫、重算与预览、对齐报告 | `8be2f9901a426463ed01051e88f26eec68543700` |
| [#755 首页、配图和模板修复同步](https://github.com/0-CHENAI/Selection/pull/755) | 同步用户配图合同、Word/Excel 首页点击修复、PPT 模板文字间距与导出修复 | `5239d16ac927128c0fb7834915eacadc9622710e` |

发布验收基线为 [v3.2.0-beta4 预发布版](https://github.com/0-CHENAI/Selection/releases/tag/v3.2.0-beta4)，对应 test 提交 `56bcf8254a058cdcd7b179631154a707e8990756`。该提交的 [Validate](https://github.com/0-CHENAI/Selection/actions/runs/41323060340) 与 [Package](https://github.com/0-CHENAI/Selection/actions/runs/41323060317) 均成功。2026-11-02 回读时 test 已前进到 `3598245a3ec6d74c59351eb5ff6c0ff6a243723a`，且已有 beta5 / beta6；beta4 是本次 Office 收尾的验收基线，不是当前最新版本。

本轮只更新交付文档与评分元数据，通过 PR 合入 `office-align-3.2`；不直接推 test，也不创建合入 test 的 PR。

### 按能力交付

| 领域 | 用户能做什么 / 实现边界 |
| --- | --- |
| 来源与技术路线 | 固定 dsh 来源、案例和许可；保留 OfficeCLI 原生编辑，Python 业务计算用 TS 实现，不引入 LibreOffice 或 PPTD |
| Word | 从案例和个人模板起稿、定点替换并继承样式；会议纪要与公文业务指南、文种路由、草稿版式、七项版式核对和最终交付守卫 |
| Excel | 经营、港口、实验及个人办公案例；指标计算、直接读取 xlsx 的数据体检、修改后先落盘再重算、公式 checks 核对；HTML 图表按工作簿锚点定位 |
| PPT | 模板画廊与个人模板工程；外来 PPTX 结构理解和导入、定点编辑 / 局部改版 / 整套换风格三条路由；预检与视觉修订、用户图完整放入；复杂对象保留并诊断，不承诺任意无损往返 |
| 共享与交付 | Office 模式、案例预览、中途附加材料、修订状态与范围守卫、最终文件保护；随包 Office 使用文档、许可证和打包检查 |

后续修复证据：[用户配图初版 #750](https://github.com/0-CHENAI/Selection/pull/750)、[完整放图与无图无占位 #752](https://github.com/0-CHENAI/Selection/pull/752)、[首页入口及模板可见性 #751](https://github.com/0-CHENAI/Selection/pull/751)、[文字间距及图表结构 #753](https://github.com/0-CHENAI/Selection/pull/753)、[44 套 562 页模板导出修复 #754](https://github.com/0-CHENAI/Selection/pull/754)，均由首页、配图及模板同步 PR #755 承接到 test。

### 最终对齐度、产品决定与遗留

[对齐报告](selection-3.2-office-parity-report.md) 与 `scripts/office-parity/matrix.ts` 使用同一口径：PPT **100%**、Word **100%**、Excel **95.8%**、共享底座 **100%**、总体 **99.1%（53.5 / 54）**。53 项对齐、1 项部分、0 项缺失、8 项排除，各域均 ≥90%。共享底座 100% 已包含图表锚点后续修复，不沿用 #717 早期评论的 95%。分数衡量能力覆盖，不代表所有端到端流程或视觉质量都已实测。

- **PPT-IMAGE：对齐（按产品决定用用户配图代替生图）。** LinNai 决定不内置图片生成，内置生图项 #741 已关闭；用户有图就使用带图片位的版式，无图就使用无图片位的版式，不留空占位。用户图不裁切、不改比例、完整放入，允许留白。最终规则以完整放图修复 #752 为准，替代用户配图初版 #750 的裁切规则；不声称实现了内置生图。
- **XLS-CHART-CACHE：部分对齐，已知遗留。** 已有 Excel 样例真机通过，但原生图表缓存与 Excel CalculateFull 的专项核对未完成。LinNai 已接受，不阻挡 #718 / #703 收尾，仍记 0.5 分。
- **最后一轮 Lola PowerPoint 复测：LinNai 决定跳过。** 按该决定直接同步 test（首页、配图及模板同步 PR #755）。不能把该轮写成通过，也不能把此前样例通过扩展为所有最新模板的真机复测通过。
- PDF 导出继续按阶段 06 排除在本轮用户路径之外；动画、SmartArt、OLE、EMF 的可编辑还原等边界见对齐报告。

### 安装包全流程：已完成与决定跳过

以下沿用历史实测，并归档 LinNai 在 2026-11-02 收尾指令中确认的样例数量和豁免；本次文档收尾没有重新安装或运行 Office。整体集成 PR #749 原正文列 PPT 3 个样例，本次 LinNai 确认此前已通过 PPT 4 个，按这一最新确认归档，不将其写成 PR 原有数字。

- [x] 既有 Lola 真机样例：Excel 3 个、PPT 4 个、Word 3 个，已测试通过（LinNai 收尾确认；#749 保留早期真机记录）。
- [x] beta4 安装包构建、打包校验和发布：Package 41323060317 成功，预发布版已存在。
- [x] beta4 基线 test 的 Validate：41323060340 成功；Package：41323060317 成功。
- [x] 既有确定性验收与原件保护：上文记录的标题、局部版式、整套换风格、外来稿、案例 hash、公式及版式守卫回归已通过；不冒充安装包连续流程验收。
- [ ] **LinNai 决定跳过**：最后一轮 Lola 真机 PowerPoint 复测（未执行，不计通过）。
- [ ] **LinNai 决定跳过**：重新在安装包串行执行「首页 Word 案例 → 中途上传 → write → 守卫 → 交付」全流程；已有 Word 样例通过不替代这一完整链路。
- [ ] **LinNai 决定跳过**：重新在安装包串行执行「Excel 经营案例 → 改数 → 重算 → 交付」全流程；保留既有工具及真机样例证据。
- [ ] **LinNai 决定跳过**：重新在安装包串行执行「PPT 外来稿导入 → 换风格 → 用户配图 → check → 导出」全流程；保留既有路由和配图验证证据。
- [ ] **LinNai 决定跳过**：安装包个人模板完整生成流程。
- [ ] **LinNai 决定跳过**：安装包注入后、写入中、重算中、导入中分别刷新，逐项复测状态不重放副作用。
- [ ] **LinNai 决定跳过**：安装包 NORM / PRO、深色和 PRO 金色主题的入口组合复测。
- [ ] **LinNai 决定跳过**：上述整套安装包流程完成后再次核对原始案例 sha256；历史 hash 回归仍单独保留。
- [ ] **LinNai 决定跳过**：安装包体积与阶段 02 / 03 预算比较；已有打包成功不等于预算比较通过。
- [ ] **LinNai 决定跳过**：冷启动及首次渲染、重算、导入耗时测量；没有新数据，不填推测值。

### 文档、许可与范围

随包 `office-business/SKILL.md` 说明重算前落盘及 xlsx 数据体检；`apps/electron/resources/docs/office.md` 提供 Office 使用说明。公文分册由 Selection 自写，来源与内容复用边界见 `office-business/NOTICE`；第三方 MIT / Apache-2.0 案例和技能保留 LICENSE、`ppt-design/ATTRIBUTION.md` 与 `THIRD_PARTY_NOTICES`。

Office 能力链路不新增 LibreOffice、Python 办公运行时或 PPTD；相关打包断言见 `no-python.test.ts`。`office_business` 将 TS 的 `office-business-runtime` 打入主进程 JS，并非内置 Python。既有其他工具的运行时不在本次拆改范围。

长任务治理 #759–#765、OfficeCLI 升级 PR #673 / #701 不属于本 Epic，不作为此次关闭条件，也不在本轮修改范围。
