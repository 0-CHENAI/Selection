# ADR：dsh Python 脚本功能在 TypeScript / Bun + OfficeCLI 中的等价实现

- 状态：LinNai 已确认（#720）。阶段 09 起按映射表实现，CLI 可以接到技能。安装包和 CI 仍然不带 Python。
- 日期：2026-10-30
- 阶段：#703 阶段 03，Issue #706
- 基线：dsh-desktop `588412b9002fcb3ac88751fab7915e050c965563`；清单与 sha256 以 #704 / #719 的 [dsh-office-inventory.json](../plans/dsh-office-inventory.json) 为准
- 许可审计：[dsh-office-licenses.md](../plans/dsh-office-licenses.md)

## 背景

dsh 用随包 Python 3.12 和 python-docx / openpyxl / pandas / lxml 提供 Word 模板保真写入、SaaS 指标、数据体检、信息图、纪要校验和 Office 包检查。这些是要复刻的功能。Python 运行时不是要复刻的技术栈。

LinNai 2026-10-30 21:23（北京时间）：「我并不是要你复刻他的技术栈，我是要复刻它的功能。」

Selection 的实现落在已有栈上：TypeScript / Bun、OfficeCLI（`get` / `set` / `query` / `batch` / `validate` / `view issues` / `view text`，以及原生图表写入）、已有依赖 `fflate`、`fast-xml-parser`、`sharp`。不内置 Python，不调用用户机器上的 Python，不把通用 Python 执行开放给 agent。

## 推荐

1. 下表每一项都用 TypeScript / Bun + OfficeCLI 做等价实现。没有任何一项需要随包 Python。
2. 对拍在开发机上按 dsh `588412b` 一次性生成 golden，提交输出。CI 只比对 TypeScript 结果与 golden。CI 和安装包都不为这条链路安装 Python。
3. Excel 出图优先用 OfficeCLI 原生图表（可编辑）。HTML / SVG 信息图只作为补充产物；需要图片时再用已有的 `sharp` 栅格化。
4. 数据体检先用 OfficeCLI 把表导出成 CSV 或单元格数据再计算。只有导出覆盖不了读取时，才引入 MIT / Apache-2.0 / BSD 的 xlsx 库，并回写本 ADR 的许可表。本阶段不引入新的读取库。

这四条是本阶段需要 LinNai 决定的内容。拍板前，`packages/office-business-runtime` 只作为内部骨架存在。

## 功能映射

| 功能 | dsh 入口（588412b） | Selection 等价实现 | 归属 | 对拍 |
| --- | --- | --- | --- | --- |
| Word 模板 `prepare` / `write` / `validate` | `packages/dsh-desktop-office/lib/docx-layout.py`，sha256 `52df231d9873b8de8ad8af246c267ded42eb5aba96a37a5625bcf5c96747c367` | server-core 的 TS 模块。`fflate` 解包；段落定位优先用 OfficeCLI paraId / 路径。保序 OOXML 编辑不默认交给会重排命名空间的解析器。`validate` 按下面 7 项逐条做。 | 08（#711） | 4 个 Word 案例：同输入下，规范化后的 document XML 一致，诊断一致 |
| 受限 Python 子进程 | `lib/docx-workflow.js` 用安装级 Python 跑上面的脚本，并清空子进程环境 | 不需要 Python。TS 在 worker 内执行，沿用原安全边界：包内条目 ≤ 5000、解压后 ≤ 64 MB、禁止外部实体和网络、stdin ≤ 90 MB、段落文本 ≤ 32768、混合 run ≤ 200、单次编辑列表 ≤ 1000、路径 ≤ 1024、处理超时 45 秒、凭据不进子进程环境 | 08（#711） | 安全负例全部拒绝 |
| SaaS 指标 | `business-skills/saas-metrics-coach/scripts/metrics_calculator.py` | 纯 TS 函数 + 同名 Bun CLI。保留 `--mrr`、`--mrr-last`、`--customers`、`--churned`、`--new-customers`、`--sm-spend`、`--gross-margin`、`--expansion-mrr`、`--churned-mrr`、`--contraction-mrr`、`--profit-margin`、`--json`。输出字段保持 MRR、ARR、ARPA、MoM、流失、CAC、LTV、LTV:CAC、回收期、NRR 或仅流失估计、Rule of 40，以及 `_missing` | 09（#712） | 数值容差 1e-9，文本逐字段一致 |
| Quick Ratio | `scripts/quick_ratio_calculator.py`，sha256 `51cd1e8c7742e741b76472e47aeb5ebf508a3367cf8b7190cd80735016313b5d` | 本阶段示范：`packages/office-business-runtime`。公式 `(New MRR + Expansion) / (Churned + Contraction)`。评级阈值与原文一致：无进出为 `NO_DATA`；无流失且有增长，或比值 ≥ 4 为 `EXCELLENT`；≥ 2 为 `HEALTHY`；≥ 1 为 `WATCH`；其余为 `CRITICAL`。参数 `--new-mrr`、`--expansion`、`--churned`、`--contraction`、`--json` | 09（#712）；骨架已在本阶段 | 与 golden stdout 逐字节一致。见下方示范 |
| 单位经济 | `scripts/unit_economics_simulator.py` | 纯 TS。保留 `--mrr`、`--growth`、`--churn`、`--cac`、`--gross-margin`、`--sm-spend`、`--months`、`--json`。默认投影 12 个月。毛利率与销售费用在命令行按百分数传入、大于 1 时除以 100，与原脚本相同 | 09（#712） | 数值容差 1e-9，文本逐字段一致 |
| 数据体检 | `dataset-health-audit/scripts/data_quality_checker.py` | TS 实现源码中的 12 个维度和加权总分、等级。读表优先 OfficeCLI 导出。维度与权重：缺失 15、重复 10、类型一致 10、取值范围 10、格式 10、唯一性 8、空白 7、常量列 5、偏态 5、列名 5、基数 5、跨列一致 10。等级：≥95 A+，≥90 A，≥80 B，≥60 C，≥40 D，其余 F | 09（#712） | port-cargo 注入缺陷全部检出；总分与等级与原脚本一致 |
| 信息图 | `data-viz-gen/scripts/build_infographic.py` | TS 生成 HTML + SVG。类型为 `stats`、`comparison`、`flow`、`dashboard`（内含柱图、环图、流程图、统计卡）。进入 Excel / Word 时，能用 OfficeCLI 原生图表表达的优先用原生图表 | 09（#712） | 指名调色板时 SVG 结构一致。原生图表由模型原生读图确认，不用 OCR |
| 纪要结构校验 | `meeting-recap/scripts/validate_minutes.py` | TS 逐条移植：主标题含「会议纪要」；议题记录或详细记录非空；行动项表含任务、负责人、期限、交付标准（含原文别名）；分隔行跳过；列数、空字段、重复任务、待确认、`YYYY-MM-DD` 合法性。输入是模型 Markdown，或 OfficeCLI `view text` 的结果 | 07（#710） | 同输入报告逐行一致，退出码一致 |
| Office 包检查 | `dsh-skill-office` 内 `assets/scripts/check_office.py`，sha256 `d94afa67593a284751e0f2dc000877e836f885d39954a882033cf22a13278f66` | 标准库脚本的功能用 TS 做：ZIP CRC、重复条目、`[Content_Types].xml`、内部关系目标存在、docx / pptx / xlsx 摘要，以及 `--contains`、`--count`、`--out`。与 OfficeCLI `validate` / `view issues` 互补，不搬 Python。清单里该文件的处理方式仍是「不搬」正文 | 05（#708）落地，08（#711）复用 | 同文件同结论 |
| 技能正文里的 openpyxl / pandas / python-docx 操作说明 | `office-xlsx`、`office-docx` 技能。清单处理方式是「不搬」 | 不复制这两份正文。阶段 07 / 09 把「调用 `load_workspace_dependencies` 返回的 Python」改写成 OfficeCLI 命令和上表 TS CLI。方法论原文在 MIT 技能里的，搬入时保留 LICENSE 并写来源；操作步骤改成 Selection 的调用方式 | 07（#710）、09（#712） | 逐段对照表无遗漏 |

`office-pptx` 的 python-pptx 指南不在本决策的脚本清单里。阶段 13 对照 dsh-ppt，不迁那份指南。

#706 正文曾写数据体检「13 类检查」。`588412b` 的 `DIMENSION_WEIGHTS` 是上表 12 项；总分和等级是汇总，不是第 13 项检查。阶段 09 按这 12 项实现。

## 对拍框架

| 产出 | 位置 | 谁用 |
| --- | --- | --- |
| 本 ADR | `docs/adr/office-python-features-in-ts.md` | 阶段 07、08、09、14 |
| 运行时骨架 | `packages/office-business-runtime/` | 阶段 07–09 在此补实现。拍板前不接入技能和安装包 |
| golden | `scripts/fixtures/office-parity/` | 阶段 14 的确定性层。生成说明在该目录 README |

golden 生成命令和脚本 sha256 写在 `scripts/fixtures/office-parity/README.md`。仓库只提交 stdout。dsh 基线升级时在开发机重跑生成命令，替换输出，并改 README 里的提交号。

数值类对拍的验收口径是容差 1e-9 且文本逐字段一致。示范实现用逐字节 stdout 比对，这比容差更严，容差仍是阶段 09 其余计算器的口径。

## 示范实现：quick_ratio

入口（内部）：

```bash
bun packages/office-business-runtime/src/cli/quick-ratio.ts \
  --new-mrr 10000 --expansion 2000 --churned 3000 --contraction 500 --json
```

P1 对应用例 `input-template-example`。`input-template.md`（sha256 `235fcd97…1077b3`）没有 New MRR 字段；技能文档里的示例命令提供 `--new-mrr 10000`，Expansion / Churned / Contraction 对应模板里的三个 MRR 字段。空白模板正文留到阶段 09 再搬。

实现注意了 argparse 的类型细节：省略 `--expansion` / `--contraction` 时默认是整数 `0`，JSON 写成 `0`；写在命令行上的 `0` 是 float，JSON 写成 `0.0`。无流失且有增长时 `quick_ratio` 为 `null`，`quick_ratio_display` 为 `∞`（JSON 里是 `\u221e`）。比值 3.999 的展示是 `4.00`，状态仍是 `HEALTHY`。

测试：

```bash
bun test packages/office-business-runtime/src/quick-ratio.test.ts \
  packages/office-business-runtime/src/no-python.test.ts
```

`quick-ratio.test.ts` 对 manifest 里每个用例比对文本和 JSON stdout，并用 Bun 进程再跑一遍 P1，确认链路是「调用 → Bun 执行 → JSON」。`no-python.test.ts` 确认本包和夹具目录没有 `.py`，包没有依赖，`electron-builder.yml` 和 CI workflow 都没有把这个包打进去。

## 调用约定

拍板前不改任何技能文件，也不把本包放进安装包。`electron-builder.yml` 的 `files` 仍只包含既有资源；本包没有被引用。

拍板后，技能里「使用 `load_workspace_dependencies` 返回的安装级 Python」改为调用内置 Bun 上的上述 CLI，或等价的 agent 工具。参数名和 JSON 字段保持不变，技能正文只改命令。文本报告保持英文，因为对拍要求与 dsh stdout 一致。

安装包里已经有文档工具用的 uv 和若干脚本（markitdown、pdf-tool 等）。那是既有能力，本阶段不拆除。本决策约束的是 Office 对齐这条链路：不为它增加 Python 运行时。干净 Windows 安装上的端到端验收（#706 的 P2）留在 #718；本阶段证明示范实现的进程入口是 Bun。

## 许可

| 来源 | 许可证 | 本阶段做法 |
| --- | --- | --- |
| saas-metrics-coach，Copyright (c) 2026 Abbas Mir | MIT | Quick Ratio 的公式、评级文案和报告版式是派生实现。声明写在 `packages/office-business-runtime/NOTICE`。不提交 `.py` |
| meeting-recap、dataset-health-audit、data-viz-gen | MIT | 阶段 07 / 09 移植时保留原 LICENSE，并在 NOTICE 登记。本阶段不搬正文 |
| `docx-layout.py`、`check_office.py` | MIT（包级或 dsh-skill-office） | 按行为重写，不提交 Python 源码 |
| `fflate` | MIT，仓库已有 | 阶段 08 继续用 |
| `fast-xml-parser` 5.2.5 | MIT，仓库已间接依赖 | 阶段 08 只有在规范化比对能通过时才用它读 OOXML。它会改命名空间前缀或顺序时，改用保序处理，再与 lxml 的 `canonical()` 比对 |
| `sharp` | Apache-2.0，仓库已有 | 仅在信息图必须栅格化时使用 |
| 新的 xlsx 读取库 | 未引入 | 先用 OfficeCLI 导出。若必须引入，只接受 MIT / Apache-2.0 / BSD，并回写本表。不引入许可未核清的表格库 |

gov-doc-writing 仍按 #704 的决定：Selection 自写，不照搬原文。它没有计算脚本，不在本映射的实现项里。

## 已知差异

- `build_infographic.py` 的 `palette: auto` 使用 Python `hash()`。进程哈希盐会变，不能当稳定 golden。阶段 09 对未指名的调色板使用固定算法，并在对拍说明里记下与 dsh 的这一处差异。配置写明调色板时，SVG 结构仍要求一致。
- pandas 的类型推断、空值判断和偏态度量与 TS 不会自动相同。阶段 09 先用 port-cargo 的缺陷样例把 12 个维度的判定口径定下来，再声称总分一致。
- `docx-layout.py` 依赖 lxml 的命名空间、属性序和空白。阶段 08 的对拍比较 `canonical()` 那种结构，不要求 ZIP 字节相同。
- 毛利率、销售费用在命令行大于 1 时除以 100。这是原脚本的行为，TS 保持，不在本阶段「修正」。
- 公式重算、PDF、区域渲染属于 #705，本 ADR 不另选一条渲染路径。

## 非目标

- 不内置 Python，不调用用户系统的 Python，不向 agent 开放通用 Python。
- 不在本阶段实现除 `quick_ratio` 以外的脚本。那些脚本留在阶段 07 / 08 / 09。
- 不追求源码逐行对应。要求同输入下功能和输出一致。
- 不修改 #719 的清单处置列。清单里这些脚本仍是「决策后再定」，等本 ADR 被确认后再改。
- 不把 `office-business-runtime` 接到技能、会话工具或安装包。

## 验收记录

命令：

```bash
bun test packages/office-business-runtime/src/quick-ratio.test.ts \
  packages/office-business-runtime/src/no-python.test.ts
cd packages/office-business-runtime && bun run tsc --noEmit
```

2026-10-30 在本分支执行：`bun test` 上述两个文件，20 pass / 0 fail / 117 assertions；`packages/office-business-runtime` 的 `tsc --noEmit` 通过。14 个 golden 用例（含 P1 `input-template-example`）文本和 JSON stdout 都逐字节一致，并用 Bun 进程复跑了 P1 JSON。P2 的干净 Windows 安装不在本阶段执行。P3 由 `no-python.test.ts` 约束本链路；既有文档工具的 Python 不在本次拆除范围。

## 需要 LinNai 决定的问题

是否批准下面四条，作为阶段 07（#710）、阶段 08（#711）、阶段 09（#712）的实现依据？

1. dsh 这些 Python 脚本的功能全部用 TypeScript / Bun + OfficeCLI 做等价实现，不内置 Python，也不调用用户系统里的 Python。
2. 对拍采用开发机按 dsh `588412b` 一次性生成 golden，CI 只比对输出。CI 和安装包都不为这条链路安装 Python。
3. Excel 出图优先用 OfficeCLI 原生图表。HTML / SVG 信息图只作为补充产物。
4. 数据体检先用 OfficeCLI 把表导出再计算。只有导出覆盖不了时，才引入 MIT / Apache-2.0 / BSD 的 xlsx 读取库，并回写本 ADR。

批准之前，`packages/office-business-runtime` 不注册为技能、不进入安装包、不对用户可见。批准之后，阶段 07 / 08 / 09 才能按映射表开工，并可以把对应 CLI 接到技能。
