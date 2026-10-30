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

## validate-minutes

来源脚本：`packages/dsh-desktop-office/business-skills/meeting-recap/scripts/validate_minutes.py`

sha256：`cca5ddea85bb07a64a93b012393b62ebc92777ec0cbb9c7638cbeb5ea38cc720`

生成环境：Python 3.12.3。对 `validate-minutes/*.md` 逐个运行：

```bash
python3 validate_minutes.py pass-basic.md
```

`*.md.stdout` 是完整 stdout，含末尾换行。`manifest.json` 记录退出码。用法行因脚本名不同，不纳入逐字节对拍；报告正文和退出码要求一致。重新生成时只替换这些 stdout，不要提交 `.py`。
