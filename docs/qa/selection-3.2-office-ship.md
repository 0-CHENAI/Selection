# Selection 3.2 Office/PPT Ship 验收

对应 #689。从 origin/test 开 `codex/office-ship-689`，引入已验收的 O0–O4 依赖。PR 仍为 draft → test；v3.2 为用户另行授权的集成分支。此文持续记录验收，未满足的门禁不能视为通过。

## 可复现真实工具验收

先准备仓库受管 OfficeCLI，再执行：

```sh
CRAFT_OFFICECLI=/绝对路径/受管原生officecli bun scripts/selection-3.2-office-ship.ts
```

脚本不调用模型、不用替身截图、不做 OCR，输出临时验收目录及 evidence.json：

- 遍历 O3 诊断记录对应的 22 个中文/英文适配工程，逐个 schema 与结构检查。
- 用实际随包 deck-cli 检查并导出固定素材；人为注入越界元素，确认 render 返回 needs_revision / 退出码 2，已有 PPTX SHA256 保持不变。
- 用真实 OfficeCLI 先截图第 1 页，再只截图第 2、4 页；确认只新增这两页，原第 1 页 SHA256 和修改时间均不变，PNG 签名正确。
- 确认原始模板素材与已有 PPTX 没有被截图流程改写。

2026-10-30 本地受管 OfficeCLI 1.0.157 运行通过。证据目录 `/var/folders/jr/49n0sbtj1h56v4zmy5v7rwzh0000gn/T/selection-3.2-ship-TShs86`。原生读图复核第 2、4 页：中文正常、标题和三项要点/四阶段图表可读，无明显遮挡或越界。此为两页样本，不是全部模板的全页视觉验收；脚本的 visualReview 字段刻意保留人工复核状态，不能从 PNG 存在推断视觉通过。

## 真实模型路由轨迹

```sh
bun run server:build:subprocess
bun scripts/selection-3.2-office-routing-live.ts title
bun scripts/selection-3.2-office-routing-live.ts layout
bun scripts/selection-3.2-office-routing-live.ts restyle
```

使用已配置的默认模型连接，创建隐藏 PRO 会话及独立临时素材副本，在精确会话 data 目录中放置既有 deck/交付记录。用户提示只描述修改意图，不预告期望工具；记录修改前后工程、文件散列、完整工具轨迹供复核。该脚本是证据采集器，不把回复中出现路由词当作通过。必须另外核对实际工具、OOXML 变化、未改页和风格边界，以及原生图片。

首次启动发现本工作树未构建 pi-agent-server，产生明确终端错误，未计为通过；已运行仓库 subprocess 构建命令后重试。路由三案的最终验收结论待补。

## 发布门禁与剩余项

- O5 的 CI、组合验证及集成待补。
- 三个真实模型路由、外来稿先读 brief 的轨迹验收待补。
- 组合 unit、完整 validate:ci 与 Ship PR CI 待补；定向通过不代表全仓绿。
- test 未获合入批准；因此 test 合入后的 Validate + Package 尚不具备执行前提。不得关闭 #689 或里程碑，不得把集成分支当正式发布。

Beta 文案拟用：**更聪明的改稿**——保留 OfficeCLI 的定点编辑，增强已有演示稿的版式修订、按页反馈、模板参考和外来稿结构理解。没有替换编辑器，也没有承诺任意复杂 PPTX 的无损往返。

### 标题案首次真实轨迹发现

默认模型 Laufry 的首轮实际调用 OfficeCLI 对第 2 页标题 run 定点修改，deck.json 散列不变、PPTX 散列变化，随后只截图第 2 页并读图。尚未计为完整通过：fixture 的 ppt-output.json 缺少源 stamp，宿主在模型执行前额外导出了一份副本，干扰交付路径；采集器已补齐真实文件 mtime/size stamp 后重跑。同时工具报告原始 deck 导出的 PPTX 已有 notesMasterIdLst 顺序校验错误，需独立核实，不应把它隐藏在“预存问题”下宣称发布质量通过。

### 导出结构修复

已用原生受管 OfficeCLI 1.0.157 独立复现原始导出的 notesMasterIdLst 顺序错误。在现有 ZIP/XML 收尾步骤只交换生成器相邻的 notesMasterIdLst 与 sldIdLst，保留两个节点内容及所有关系。20 项 deck 回归测试通过（480 assertions），包括备注文本与主列表顺序；随包 deck-cli 已重建。修复后真实固定素材导出通过 OfficeCLI validate（no errors），局部截图/旧文件保护重验通过。验收脚本增加真实 validate 退出码断言，防止仅截图正常就放行。

### 组合验证与交付路径修复

O5 #696 的 Validate 41004874701 和 OfficeCLI 41004874522 均成功后，已引入 Ship 分支，保留 O4 brief 与 O5 案例两组集成入口；本地真实组合测试 7 pass / 82 assertions。组合 typecheck:all 通过。

标题案重跑揭示 fixture stamp 不是唯一原因：macOS `/var` 别名与真实 `/private/var` 路径在交付归属比较前未统一，导致已保存记录不被信任而额外导出副本。读取记录现在先解析真实路径，现有边界比较仍拒绝工作目录/会话外文件；加入目录别名回归，确保直接编辑后的已有内容不被覆盖。ppt-live 11 pass / 132 assertions。模型曾尝试在 office_edit 后同步 deck.json，这会触发实时导出；路由合同现在明确本轮不得写回工程，等实际请求后续 deck_revision 时再对账。两项均需新的真实模型回归，不能拿旧轨迹证明修复后通过。

### 外来稿轨迹与全仓检查进行中

采集器增加 `external` 用例：只提供外来 PPTX，不放对应 deck，也不提示应调用哪一工具，检查真实模型是否先遵循 O4 brief。后续运行在验收目录保留 `before.pptx.bin` 原字节，避免宿主清理 scratch PPTX 时删除对照物；追加标题最终文字、office_edit 不改工程、局部修改不改其余页/主题、restyle 确实改变主题的硬断言。工具顺序、内容保留与原生视觉仍须人工复核，不能仅凭脚本退出码宣称全部通过。

首次完整 validate:ci 在 deep-link-routing 测试导入 Electron 时遇到本工作树缺少二进制安装产物；通过当前锁定的 Electron 39.2.7 安装脚本补齐（未改依赖版本），失败项单独重跑通过，完整命令已重新启动。该环境失败不算通过，也未以定向结果代替全仓结果。

### 标题案通过（修复后的真实模型）

默认连接 pi-api-key / Laufry，隐藏会话 `261030-warm-dolphin`，证据 `/var/folders/jr/49n0sbtj1h56v4zmy5v7rwzh0000gn/T/selection-3.2-route-title-EMxng1/trace.json`。实际调用 `officecli set /slide[2]/shape[@name=t3]/paragraph[1]/run[1] --prop text=理解关键用户时刻`；deck.json 前后 SHA256 一致，无重锁或 deck 重导出，目录只有一份用户交付 PPTX。

独立复核最终字节：用同版本导出器从 trace.before.deck 重建内容基线（该次采集尚未保留原始二进制，因此不声称 ZIP 字节相同），逐个比较全部 `ppt/` 部件的 XML 结构/属性/文字和媒体字节，仅忽略 XML 子节点间缩进。唯一实质差异为 slide2.xml 的指定标题文字；版式/母版 XML 只发生空白序列化变化。其余页面、备注、主题、媒体均一致。原生 OfficeCLI validate 零错误；原生读图 `data/qa/final-slide-2.png` 标题正确，无裁切/重叠/缺字。
