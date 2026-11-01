# Selection 3.2 Office/PPT Ship 验收

对应 #689 / draft PR #697，目标 test，里程碑 #9。Ship 从 origin/test 开分支并引入 O0–O5 依赖；各阶段保留独立提交与 draft PR。用户另行授权 v3.2 集成，未授权合入 test 或发布。本页区分已证实、仍在执行和待批准的门禁；不能用定向通过代表全仓绿。

## 阶段交付与证据

| 阶段 | Draft PR → test | 交付与验收记录 | 当前证据 |
| --- | --- | --- | --- |
| O0 #683 | [#691](https://github.com/0-CHENAI/Selection/pull/691) | [基线入口与缺口表](../plans/selection-3.2-office-baseline.md) | 纯文档盘点，无运行时改动 |
| O1 #684 | [#692](https://github.com/0-CHENAI/Selection/pull/692) | [三分路由](selection-3.2-office-o1.md) | 阶段 CI 通过；三个真实路由用例均已独立复核 |
| O2 #685 | [#693](https://github.com/0-CHENAI/Selection/pull/693) | [修订环](selection-3.2-office-o2.md) | 阶段 CI 通过；真实拒绝导出/旧文件保护/局部截图通过 |
| O3 #686 | [#694](https://github.com/0-CHENAI/Selection/pull/694) | [模板与按页 UI](selection-3.2-office-o3.md) | 阶段 CI 通过；22 个双语适配工程、264 页结构检查通过；预览与 UI 原生复核范围见阶段记录 |
| O4 #687 | [#695](https://github.com/0-CHENAI/Selection/pull/695) | [外来稿 brief](selection-3.2-office-o4.md) | 阶段 CI 通过；真实摘要、hash 校验与模型完整读取后编辑通过 |
| O5 #688 | [#696](https://github.com/0-CHENAI/Selection/pull/696) | [Word/Excel 案例](selection-3.2-office-o5.md) | Validate 41004874701、OfficeCLI 41004874522 成功；已纳入 Ship 组合基线 |
| Ship #689 | [#697](https://github.com/0-CHENAI/Selection/pull/697) | 本页与两个验收脚本 | 实现与当前授权验收完成；test 发布门禁待批准 |

O5 固定 DSH 来源未找到可移植的 Word/Excel 案例，采用明确标记的 Selection 原创虚构业务编排，未冒称搬运。仍使用 OfficeCLI 模板副本与定点修改；没有引入 PPTD、Harness、Cordis、Python office-runtime、LibreOffice Kit 或替换编辑器。

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
| test 合入后 Validate + Package | 待用户批准合入 | 功能分支结果不能代替发布门禁；不关闭 #689 或里程碑 |

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

双平台打包手动运行于功能分支；publish-release 只允许默认分支或 test，本次不会发布。test 合入后的门禁保留待批准，不能由本次打包替代。

Beta 文案：**更聪明的改稿**——保留 OfficeCLI 定点编辑，增强已有演示稿的版式修订、按页反馈、模板参考与外来稿结构理解。没有替换编辑器，不承诺任意复杂 PPTX 无损往返。

## 其余真实用例的独立复核

- **局部版式**：`/var/folders/jr/49n0sbtj1h56v4zmy5v7rwzh0000gn/T/selection-3.2-route-layout-lzzS43/trace.json`。磁盘 JSON 对照只有 2/4 页变化，所有原文/数值保留，theme 完全相同。原始 PPTX hash 已核验；其他 10 页及 theme/master/layout XML 树一致。两张最终图原生复核符合上方主张/下方三要点、四列旅程，未见遮挡；validate 零错误。采集器末尾曾因内存 schema 的 `logo: undefined` 与 JSON 缺省字段误报，已改为磁盘原 JSON 基线，同一轨迹重新应用全部范围断言通过，没有放松字段比较。
- **整套换风格**：`/var/folders/jr/49n0sbtj1h56v4zmy5v7rwzh0000gn/T/selection-3.2-route-restyle-kEPoe7/trace.json`。12 页 id/页序一致，主题变蓝；除旧风格标记 MONOCHROME 外，所有原文本/数值在相应页中保留（允许换行/合并标签）。最终 PPTX 文本与最终 deck 逐项一致，validate 零错误。独立原生读完 12 页，无明显溢出/遮挡；从最终交付重新截图到 `/tmp/selection-3.2-restyle-final-images`，12 张散列均与复核图一致。备注已随新布局改写，不声称备注字节不变。此用例启动于路径修复前，模型最后收敛副本为单一文件；路径修复的独立回归由标题/局部版式用例证明。
- **外来稿**：`/var/folders/jr/49n0sbtj1h56v4zmy5v7rwzh0000gn/T/selection-3.2-route-external-15hmWd/trace.json`。编辑前 Read 原 brief，起始行依次 1/901/1801/2701/4001/5301/6601，工具实际回包连续覆盖 7886 行，无截断缺口；随后 --verify 再 OfficeCLI set，写后重建 brief。与保留原字节逐个 PPT 部件对照，仅第 2 页目标标题改变；无 deck 重建。原生读图、validate、脚本最终标题断言均通过。

第三次完整 validate:ci 暴露工作树 `apps/electron/vendor/bun/bun` 未准备，导致 Word Heading/TOC 辅助器退出 127。按 CI 同样的受信任 Bun staging 方式补齐 gitignored 运行时，原失败文件 `officecli.test.ts` 26 pass / 199 assertions；随后完整 validate:ci 退出码 0，成功通过。

打包上传失败原因已定位为 artifact 名含功能分支的 `/`，上传/下载统一改用 `github.run_id`（只改命名，不改发布条件），修复后 run 41008459694 已验证两个平台完整上传成功。


## 授权范围内的交付回读

2026-10-30 回读确认：PR #691–#697 全部 open/draft、base=test、milestone=Selection 3.2，对应 Closes #683–#689；没有 PR 合入 test。远端 test 仍为 `3ef1e6e7f4da1e8c6a45745f2fdaa96b74dc9d60`。本轮相对 test 的改动未涉及 effort/WebGL/Fast；既有模板原页未覆盖，新增适配与预览位于独立目录。

已上传产物 `selection-macos-arm64-41008459694`（917058115 bytes）与 `selection-windows-x64-41008459694`（419756808 bytes），均未过期。没有发布 GitHub Release、关闭 issue/里程碑或制作面向用户的 PPT 成品；PPTX/Word/Excel 文件均为验收夹具。test 合入与后续发布门禁仍以用户另行批准为前提。

## #698 整合修复与本地复核

本次以 `origin/test` 的 `3ef1e6e7f`（#690）为第一父提交，将 `origin/v3.2` 的 `ef17477df` 本地无冲突整合。只承接 O0–Ship 并修复整合缺口；不合入 test、不发布、不关闭里程碑。#691–#697 保留为阶段档案，由 #698 的单一整合 PR 承接，不再逐条硬合；#681 已由合入的 #690 取代。

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

## #718 发布准备（尚未合入 test）

这一节是 [#718](https://github.com/0-CHENAI/Selection/issues/718) 的清单和版本说明。它不代替桌面安装包上的全流程，也没有打开指向 `test` 的拉取请求。合入 `test` 仍要 LinNai 批准。

### 对齐度

见 [selection-3.2-office-parity-report.md](selection-3.2-office-parity-report.md)。按 dsh 588412b 从严复核后：PPT 96.2%，Word 100%，Excel 95.8%，共享底座 100%，总体 98.1%。计入分母的未对齐项是 0。草稿 PR #741（PPT 配图接 Seedream / OpenAI）合入后，PPT 到 100%，总体到 99.1%。

还剩两项部分对齐，需要 LinNai 书面确认能否带着发布：

- PPT-IMAGE：图片槽合同和占位已经有了，但还没有内置生图提供方，等 #741。
- XLS-CHART-CACHE：原生图表缓存还没跟装了 Excel 的机器核对。

PDF 导出按阶段 06 排除在用户路径之外。

### 本轮合入 office-align-3.2 的 PR

| PR | 内容 | 合入提交 |
| --- | --- | --- |
| #742 | 办公计算会话工具、公文分册、xlsx 体检、重算落盘、草稿版式、Excel 浮动图表锚点、对齐报告 | 997829cb8 |

#740 已并入 #742 后关闭。#741（PPT 配图提供方）还是草稿，没有合入，要等 LinNai 看过设置页和密钥存储。

### 版本

根 `package.json` 和 `apps/electron/package.json` 仍是 `3.1.0`。这次不新建 `release-notes/3.2.0.md`，也不改版本号。用户可见的说明写在 `release-notes/next.md`。版本文件等批准合入 `test` 之后由发布流程汇总。

### 文档

- `office-business/SKILL.md`：重算前先落盘，数据体检可以直接给 xlsx。
- 新增用户文档 `apps/electron/resources/docs/office.md`（Office 使用说明）。随 `resources/docs` 自动进包，没有加进系统提示，`system.ts` 只剩约 7 个 token。

### 许可

- 公文写作是 Selection 自写。来源句在 `office-business/NOTICE`：能力参照 dsh-desktop gov-doc-writing，未复用其内容。分册 08–18 都是自写，测试禁止出现对方的专有栏目名。
- MIT / Apache-2.0 的案例和技能保留原 LICENSE。ppt-design 的 `ATTRIBUTION.md` 和 `THIRD_PARTY_NOTICES` 仍随模板。
- 安装包里不含 LibreOffice Kit、Python 办公运行时或 PPTD，没有 MPL-2.0 分发义务。`no-python.test.ts` 现在断言两件事：`electron-builder.yml` 里没有 libreoffice、soffice、lokit、pptd；`office-business`、`ppt-design` 和 `resources/bin` 下没有 .py / .pyc，也没有这几类引擎文件。
- `office_business` 把 `office-business-runtime` 打进主进程的 JS 包，但这个目录不在 electron-builder 的文件列表里。

### 体积与性能

这一轮没有重打安装包，体积、冷启动和第一次渲染 / 重算 / 导入的耗时都没有新数据。需要在 macOS arm64 和 Windows x64 安装包上测，再和阶段 02 / 03 的预算比。

box 上能给的参考（Linux，OfficeCLI 1.0.157，不代表安装包）：12 页 PPT 用 OfficeCLI 出 HTML 并截四宫格约 4 秒；一份 Word 首页截图约 4 秒；三个 Excel 案例各跑一次 `xlsx_recalculate`（含核对或双读），每个都在 10 秒内。

### 还没在安装包上走过的流程

下面每条都还没有这次的 macOS arm64 / Windows x64 安装包证据。勾选留给真机，不要把本页前面的 O0–O5 记录当成这一轮的安装包验收。

- [ ] 首页 Office → Word 案例 → 中途上传 → `office_template_write` → 守卫 → 交付
- [ ] Excel 年度经营 → 改数 → `xlsx_recalculate` → 交付
- [ ] PPT 外来稿 → 理解 → 导入 → 换风格 → 配图 → check → 导出
- [ ] 个人模板生成一份稿件
- [ ] 注入后、写入中、重算中、导入中分别刷新，状态不重放副作用
- [ ] NORM / PRO、深色、PRO 金色主题下入口仍可用
- [ ] 原始案例 sha256 在流程后不变
- [ ] 安装包体积相对阶段 02 / 03 的预算
- [ ] 冷启动，以及第一次渲染、重算、导入的耗时
- [ ] 在装了 Word / Excel / PowerPoint 的机器上打开成稿（Lola 的真机检查）
- [ ] 合入 `test` 之后的 Validate 和 Package

box 上已经跑过的是确定性层：对齐脚本、单元测试、质量对比页图（`/workspace/sw717-shots/`）。没有真实模型回合，box 上没有模型和出图密钥。

`answer-delivery.test.ts` 里「linked OfficeCLI outputs」仍是已知偶发失败，这次没有改那个用例。
