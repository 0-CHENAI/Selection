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
