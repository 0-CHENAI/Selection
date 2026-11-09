# 阶段 09 验收记录：Excel 案例、业务技能与重算核对

对应 [#712](https://github.com/0-CHENAI/Selection/issues/712)，父规划 [#703](https://github.com/0-CHENAI/Selection/issues/703)。对照基线仍是 dsh-desktop `588412b`。公式路径按 [#705](https://github.com/0-CHENAI/Selection/issues/705) 的决定：OfficeCLI `computedValue` 写回缓存；装了 Excel 的 Windows / macOS 再 `CalculateFull`；TypeScript 只补未求值格子。脚本按 [#720](https://github.com/0-CHENAI/Selection/pull/720) 已确认的映射，用 Bun CLI 对拍，不内置 Python。

## 代码入口

| 能力 | 入口 |
| --- | --- |
| 三个案例原件 | `apps/electron/resources/skills/office-business/cases/{annual-business,port-cargo,bio-assay}/` |
| 目录与预览范围 | `apps/electron/resources/skills/office-business/catalog.json` 的 `previewPages` |
| 三个业务技能 | `apps/electron/resources/skills/{saas-metrics-coach,dataset-health-audit,data-viz-gen}/SKILL.md` |
| 指标 / Quick Ratio / 单位经济 / 体检 / 信息图 | `packages/office-business-runtime/src/cli/` |
| 从 inputs 生成副本、重算、交付门闩 | `packages/server-core/src/services/excel-delivery/` |

`xlsxRecalculate` 先读 `planNativeOfficeRender` 的公式步骤。Linux 上没有 Excel，计划不会调用 `CalculateFull`。OfficeCLI 宿主没给出的格子才进入 `recalculateWorkbook`。算出的数写回公式单元格的缓存。`assertExcelDelivery` 在未重算、checks 失败、缺少双读、空白页或使用 OCR 时拒绝交付。

案例 `example.xlsx` 的 sha256 与 `docs/plans/dsh-office-inventory.json` 一致。生成和改数都作用在副本上。

港口和实验案例的推荐技能沿用 dsh catalog 里已有的 `businessSkills`。没有另加一份还要 LinNai 确认的扩展字段。

## 验收命令

```bash
bun test packages/office-business-runtime/src/stage09-parity.test.ts \
  packages/office-business-runtime/src/quick-ratio.test.ts \
  packages/office-business-runtime/src/no-python.test.ts \
  packages/server-core/src/services/excel-delivery/excel-delivery.test.ts \
  packages/server-core/src/services/office-render-poc/office-render-poc.test.ts \
  packages/shared/src/skills/__tests__/excel-business-skills.test.ts
cd packages/office-business-runtime && bun run tsc --noEmit
cd packages/server-core && bun run tsc --noEmit
```

固定案例：

| 案例 | 结果 |
| --- | --- |
| X1 port-cargo | 用 `inputs/port.json` 写入副本后重算。`港口总览!B6/F6/J6/N6` 分别为 2516.8532、0.6504859719271668、2.6991141552511415、2190，容差 1e-6。8 张原生图表部件仍在。第一笔吨数增加 10000 后，B6 增加 1。 |
| X2 bio-assay | 用 `inputs/bio.json` 写入副本后，`checks.json` 五项通过。4 张原生图表仍在。 |
| X3 annual-business | 把 `月度经营数据!E41` 的新增 MRR 加 10000。`增长质量!N62` 与 `增长测算!C100` 各增加 10000，经营总览有单元格随之变化。`客户留存!N2` 仍等于 `增长测算!H6`（基准），`客户留存!B12` 仍等于 `客户批次数据!B9`。 |
| X4 dataset-health-audit | 缺陷夹具与 dsh 脚本报告一致（容差 1e-9）。港口明细注入 3 处缺失、3 行重复、3 处带单位的箱量，三项都被检出。 |
| X5 data-viz-gen | 指名 `corporate` 调色板时，HTML/SVG 与 dsh 脚本逐字节一致。同时给出 `officecli add ... type=column ... dataRange=`，不把图写成图片。 |
| 未重算 | `assertExcelDelivery({ recalculated: false })` 返回 `not-recalculated`。 |

Quick Ratio、三组 SaaS 指标和单位经济示例的文本与 JSON stdout 与 dsh `588412b` 逐字节一致。

## 本阶段明确不做

- 不把 LibreOffice Kit、Python 或 PPTD 打进安装包。`office-business-runtime` 不进 `electron-builder.yml`。
- 不在 Linux CI 里调用 Excel COM 或 Word 原生渲染。
- 不实现 #708 的会话注入和 #709 的选择器按钮（#709 后来定为点卡片把案例附到输入框，没有单独的「做同款」按钮）。技能已在 bundled catalog 里，模型可以 Read。
- 不重算图表缓存。原生图表部件保留；缓存是否与 Excel `CalculateFull` 一致，留到装了 Excel 的真机。
- 数据体检的 `--sample` 不用 pandas `RandomState`，对拍不使用这个参数。
- `palette: auto` 使用稳定哈希，不用 Python `hash()`。

## 留到真机

- Windows：对港口副本执行 Excel `CalculateFull`，再与 OfficeCLI `computedValue` 和 `checks.json` 用 1e-6 比较。
- macOS：同一复核走 AppleScript，而不是 Windows COM。
- 区域渲染后的原生读图要在 Electron 里看图。本阶段只拦住 OCR 和空白页，不在 CI 里声称已经看过图。
