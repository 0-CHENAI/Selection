# office-business-runtime

Selection 内部的 Office 业务计算运行时。决策见 [docs/adr/office-python-features-in-ts.md](../../docs/adr/office-python-features-in-ts.md)。

阶段 09 起，技能通过下面的 Bun CLI 调用本包。安装包不内置 Python，electron-builder 也不把本包打进去。

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
