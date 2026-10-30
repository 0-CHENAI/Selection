# Office 功能对拍夹具

本目录只保存开发机上一次性生成的 golden 输出。CI 用 TypeScript 结果比对这里的文件，不运行 Python，安装包也不带 Python。

对照基线：dsh-desktop `588412b9002fcb3ac88751fab7915e050c965563`。脚本 sha256 与 [dsh-office-inventory.json](../../docs/plans/dsh-office-inventory.json) 一致。决策见 [office-python-features-in-ts.md](../../docs/adr/office-python-features-in-ts.md)。

## quick-ratio

来源脚本：`packages/dsh-desktop-office/business-skills/saas-metrics-coach/scripts/quick_ratio_calculator.py`

sha256：`51cd1e8c7742e741b76472e47aeb5ebf508a3367cf8b7190cd80735016313b5d`

生成环境：Python 3.12.3。命令形态：

```bash
python3 quick_ratio_calculator.py --new-mrr 10000 --expansion 2000 --churned 3000 --contraction 500
python3 quick_ratio_calculator.py --new-mrr 10000 --expansion 2000 --churned 3000 --contraction 500 --json
```

`manifest.json` 列出每个用例的 argv。`*.text.stdout` 与 `*.json.stdout` 是该命令的完整 stdout，含末尾换行。P1 用例 `input-template-example` 的字段说明在 `input-template.sample.json`。

重新生成时只替换这些 stdout。不要把 `.py` 提交进本目录。

## metrics / unit-economics / data-quality / infographic

阶段 09 追加。生成环境仍是 Python 3.12.3，只在开发机运行 dsh `588412b` 的原脚本，仓库只保留 stdout 和指名调色板的 HTML。

| 目录 | 来源脚本 | sha256 |
| --- | --- | --- |
| `metrics/` | `saas-metrics-coach/scripts/metrics_calculator.py` | `decb7362196e97172e876f9732456ef41e91e123c6a335f62883d87fc0cfbf49` |
| `unit-economics/` | `saas-metrics-coach/scripts/unit_economics_simulator.py` | `08a17b6fed9ef619f92ce5cc84cd44d592b229c2fa369a8a1913fce8bcf71f3b` |
| `data-quality/` | `dataset-health-audit/scripts/data_quality_checker.py` | `78e0b59f649841ba06b107689a587237112d67047636e10727368bcdf8f93fdb` |
| `infographic/` | `data-viz-gen/scripts/build_infographic.py` | `ff58f92a2d6c9d56274a1d0776cc28770c5c4a3fe672f72f048b59b402648dbf` |

数值类对拍容差 1e-9。Quick Ratio、指标文本、单位经济文本和指名调色板的 SVG 用逐字节 stdout / HTML。`palette: auto` 不进入 golden，TypeScript 使用稳定哈希。
