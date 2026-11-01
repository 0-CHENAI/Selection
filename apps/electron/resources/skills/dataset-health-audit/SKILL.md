---
name: dataset-health-audit
description: "执行数据质量检查，对CSV/Excel/TSV/JSON等表格数据进行12个维度的全面审计，输出质量评分、问题详情和修复建议。当用户需要进行数据质量检测、查看缺失值、重复行、异常值、格式问题、类型混淆，或提及数据质量、质检、数据清洗前检查、异常值检测、格式校验、空值、数据健康度、质量评分等关键词时触发。"
license: MIT
---

# data-quality-checker

数据质检工具 —— 对表格数据执行 12 个维度的质量检测，输出每项评分（0-100）、总分和具体修复建议。

## 能力概览

| 维度 | 说明 |
|------|------|
| 缺失值检测 | 每列的空值/NaN 数量与比例 |
| 重复行检测 | 完全重复的行数与比例 |
| 数据类型一致性 | 同列中混杂不同类型（如数字列混入文字） |
| 数值范围/异常值 | 基于 IQR 方法检测离群值 |
| 格式合规性 | 日期、邮箱、手机号等字段的格式一致性 |
| 唯一性约束 | ID 类字段是否存在重复 |
| 空白字符串 | 前后空格、空字符串、仅空白字符 |
| 常量列 | 仅含单一值的列（信息量为零） |
| 数据分布偏斜 | 数值列的偏度是否过大 |
| 列名规范性 | 列名是否含空格、特殊字符、大小写不一致 |
| 基数异常 | 唯一值数量异常（过高或过低） |
| 跨列一致性 | 日期先后、数值大小等跨列逻辑校验 |

## Quick Start

调用会话工具 `office_business`，command 为 `data-quality`。计算在应用内完成，安装包里也能用，不需要 Python 或仓库路径。

```json
{"command": "data-quality", "path": "data.csv"}
{"command": "data-quality", "path": "data.csv", "output": "report.json"}
{"command": "data-quality", "path": "users.csv", "id_columns": "user_id,email"}
{"command": "data-quality", "path": "经营数据.xlsx", "sheet": "月度经营数据"}
{"command": "data-quality", "path": "经营数据.xlsx", "sheet": "明细", "range": "A3:H200"}
```

XLSX 读的是一个工作表的单元格缓存值：有公式的表先用 `xlsx_recalculate` 重算再体检。表头默认取第一行至少两个非空单元格的行；标题行、合计行会干扰判断时，用 `range` 圈出纯数据区域，首行当表头。

## 详细用法

### 参数说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `path` | 是 | 工作区内的 CSV / TSV / JSON / XLSX |
| `sheet` | 否 | XLSX 工作表名，省略时用第一个 |
| `range` | 否 | XLSX 数据区域，如 `A3:H200`，首行当表头 |
| `output` | 否 | 把 JSON 报告写到工作区内的 `.json`，省略时只返回正文 |
| `id_columns` | 否 | 应唯一的列名，逗号分隔；省略时自动识别 |
| `sample` | 否 | 抽样行数（大文件时使用）。抽样序列与 pandas 不同，复核时用全量 |

## 输出结构（JSON）

```json
{
  "file": "data.csv",
  "rows": 10000,
  "columns": 15,
  "overall_score": 78.5,
  "grade": "B",
  "dimensions": {
    "missing_values": {
      "score": 85.0,
      "issues": [
        {"column": "age", "missing_count": 150, "missing_pct": 1.5, "suggestion": "用中位数或众数填充"}
      ]
    },
    "duplicates": {
      "score": 95.0,
      "issues": [...]
    }
  },
  "top_suggestions": [
    "列 age 有 1.5% 缺失值，建议用中位数填充",
    "发现 200 行完全重复，建议去重"
  ]
}
```

## 评分标准

| 等级 | 分数范围 | 含义 |
|------|----------|------|
| A+ | 95-100 | 数据质量优秀，可直接使用 |
| A | 90-95 | 质量良好，少量小问题 |
| B | 80-90 | 质量中等，建议修复后使用 |
| C | 60-80 | 质量较差，需重点清洗 |
| D | 40-60 | 质量很差，大量问题需修复 |
| F | 0-40 | 数据基本不可用，需重新采集或大规模清洗 |

## 依赖

Bun。不安装 pandas、numpy 或 Python。xlsx 先用 OfficeCLI 导出成 CSV 再体检；本 CLI 直接读取 CSV、TSV 和 JSON。


## Selection 交付

不要调用 Python。12 个维度和加权总分调用会话工具 `office_business`（command 为 data-quality，path 指向工作区内的 CSV）。上面的 bun 命令只在本仓库开发对拍时使用。任意 pandas 表达式、透视和自定义 DataFrame 代码不在本技能里。

Excel 交付前：`xlsx_recalculate`（OfficeCLI `computedValue` 写回缓存；装了 Excel 的 Windows/macOS 再 `CalculateFull`；TypeScript 只补未求值格子）→ `checks.json` 逐项核对，没有 checks 就双读关键单元格 → 区域渲染后原生读图。禁止 OCR。空白页立即停止。不覆盖案例原件。调用时 `visual_review` 必填：纯数据 / 公式任务填 `not-needed`；改了格式、图表或打印设置，先区域渲染并原生读图，再填 `reviewed`。
