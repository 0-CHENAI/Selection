# office-business-runtime

Selection 内部的 Office 业务计算运行时。决策见 [docs/adr/office-python-features-in-ts.md](../../docs/adr/office-python-features-in-ts.md)。

#720 的映射已作为阶段 07 的实现依据。本包提供 `quick_ratio` 与纪要结构校验，仍不进入安装包，也不带 Python。

```bash
bun packages/office-business-runtime/src/cli/quick-ratio.ts \
  --new-mrr 10000 --expansion 2000 --churned 3000 --contraction 500 --json
```

运行时是仓库已有的 Bun。这条链路不调用 Python。

纪要结构校验：

```bash
bun packages/office-business-runtime/src/cli/validate-minutes.ts 会议纪要.md
```

报告 stdout 与 dsh `validate_minutes.py` 的 golden 逐字节一致。用法行写的是上述 Bun 命令。
