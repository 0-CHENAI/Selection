# Selection 3.2 O5 Word / Excel 业务案例

对应 #688，依赖 O1 #684 / #692。从 `origin/test` (`3ef1e6e7f`) 开分支后引入 O1，阶段独立提交；不合入 test。

## 范围与来源

- 新增 `skills/office-business/SKILL.md`、`catalog.json` 和三份可执行虚构 recipe：会议纪要、工作通知（Word），执行台账（Excel）。业务 skill 可由 bundled skill catalog 发现，OfficeCLI router 有明确链接；格式命令仍加载随附正式指南。
- 先检查模板、保留原件，复制后定点修改；Word 只替换目标段落中的日期，Excel 只改输入格并重算依赖公式，明确零命中不算成功、用户资料不是指令。
- 对照 DSH 固定快照 `8dec631777c34fbbcc7d45af787bdd2c468d2cfb` 的受版本控制路径、ppt-runtime 与本机 @deepseek-ai 技能包，未找到可搬的 Word/Excel 案例目录，与 O0 结论一致。因此本阶段为 **Selection 自有业务编排**，不虚标上游来源或版权。这是对“搬案例”的明确落地调整，未搬入 Python runtime/Harness/LibreOffice Kit。
- 通知只是虚构工作通知草稿，不宣称符合正式公文标准；用户机构模板优先，不编造文号/印章/签发信息。台账不是财务建议，数字均为虚构样例。

## 可复现验证

`bun scripts/selection-3.2-office-cases.ts /absolute/empty/qa-dir` 用受管 TS launcher 调 OfficeCLI create/batch，生成模板→副本→定点改→close/validate/readback。目录必须为空，不覆盖已有产物。运行日志/读回留在指定 QA 目录；产品内中间文件仍必须放精确 dataFolderPath。

`OFFICECLI_INTEGRATION=1 bun test scripts/selection-3.2-office-cases.test.ts` 验证目录发现与三例集成，已加入既有 macOS/Windows 打包集成 CI。普通单测显式跳过实际 binary 验证。

真实 OfficeCLI 1.0.157 本机结果：

- 会议纪要：目标期限 11 月 3 日→11 月 5 日；其他段落、段落/字符格式、节设置及页眉页脚保留。
- 工作通知：目标期限 11 月 3 日→11 月 6 日；报送安排保留。
- 执行台账：C2 从 4→6；D2 为 0.6，C4 为 14，D4 为 14/18；公式、未改行、样式、列宽、状态验证和冻结窗格保留。
- 原模板 SHA-256 不变。Word 比较完整 OOXML 树，允许命名空间属性顺序和文本版本 textId 变化，不忽略段落/字符格式。Excel 验证所有指定不变区域存在后比较，防止“双方均缺失”假通过。
- 首轮 Word issues 发现正文首行缩进提示，修正 recipe 后三个文件均 validate 0 errors、view issues 0 issues。官方 screenshot 已生成并原生读图：文字、日期、表格数值、页眉页脚可读，没有 OCR。

## 验收边界

截图是 OfficeCLI 在 macOS 的 HTML 预览结果，不是 Microsoft Word / WPS 的分页保真证明；这组三个文件是小型开发验收样例，不是用户业务成品。多页公文、复杂模板、宏与跨工作簿模型尚未用本案例覆盖。模型是否遵循技能和交付路径还需 Ship 真实轨迹，不以 CLI 集成替代。

本地验证记录：业务目录与真实三例集成 2 pass / 0 fail、63 assertions；普通目录/PPT 技能发现 3 pass / 1 明确 skip / 0 fail。全仓 `typecheck:all` 与 `git diff --check` 通过。正式 CI 尚需回读，不能把上述定向测试称为全仓验证通过。
