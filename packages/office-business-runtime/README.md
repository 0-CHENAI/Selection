# office-business-runtime

Selection 内部的 Office 业务计算运行时。决策见 [docs/adr/office-python-features-in-ts.md](../../docs/adr/office-python-features-in-ts.md)。

LinNai 确认该 ADR 之前，本包不注册为技能、不进入安装包、不向用户暴露。现阶段只提供 `quick_ratio` 示范实现和 golden 对拍。

```bash
bun packages/office-business-runtime/src/cli/quick-ratio.ts \
  --new-mrr 10000 --expansion 2000 --churned 3000 --contraction 500 --json
```

运行时是仓库已有的 Bun。这条链路不调用 Python。
