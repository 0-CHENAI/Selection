# office-business-runtime

Selection 内部的 Office 业务计算运行时。决策见 [docs/adr/office-python-features-in-ts.md](../../docs/adr/office-python-features-in-ts.md)。

#720 的映射已作为阶段 07 和阶段 09 的实现依据。本包提供 Quick Ratio、纪要结构校验、Word 案例草稿，以及 SaaS 指标、单位经济、数据体检和信息图。安装包不内置 Python，electron-builder 也不把本包打进去。

```bash
bun packages/office-business-runtime/src/cli/quick-ratio.ts \
  --new-mrr 10000 --expansion 2000 --churned 3000 --contraction 500 --json
```

同一运行时还有：

```bash
bun packages/office-business-runtime/src/cli/metrics.ts --mrr 50000 --customers 100 --churned 5 --json
bun packages/office-business-runtime/src/cli/unit-economics.ts --mrr 50000 --growth 10 --churn 3 --cac 2000 --json
bun packages/office-business-runtime/src/cli/data-quality.ts data.csv
bun packages/office-business-runtime/src/cli/build-infographic.ts config.json --native-chart
```

运行时是仓库已有的 Bun。这条链路不调用 Python。

纪要结构校验：

```bash
bun packages/office-business-runtime/src/cli/validate-minutes.ts 会议纪要.md
```

报告 stdout 与 dsh `validate_minutes.py` 的 golden 逐字节一致。用法行写的是上述 Bun 命令。
