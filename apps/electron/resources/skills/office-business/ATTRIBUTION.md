# Office 业务案例来源

对照提交：dsh-desktop `588412b9002fcb3ac88751fab7915e050c965563`。逐文件 sha256 以 `docs/plans/dsh-office-inventory.json` 为准。

| 路径 | 许可 | 处理 |
| --- | --- | --- |
| `cases/meeting-minutes/` | MIT（包级） | 原样 |
| `cases/coffee-market/` | MIT（包级） | 原样 |
| `cases/equity-research/` | MIT（包级） | 原样 |
| `cases/government-notice/` | LinNai 样例，2026-10-30 22:52 准予原样搬入 | 原样，含嵌入字体 |
| `business-skills/meeting-recap/LICENSE` | MIT | 原样 |
| `business-skills/meeting-recap/SKILL.md` | MIT | 方法论保留，文件交付改为 OfficeCLI 与 Bun 校验 |
| `business-skills/work-report-writer/` | MIT | LICENSE 原样；交付节改为 OfficeCLI |
| `business-skills/research-writer/LICENSE.txt` | Apache-2.0 | 原样 |
| `business-skills/research-writer/SKILL.md` | Apache-2.0 | 译本正文未改，文末追加 Selection 文件交付 |
| `business-skills/gov-doc-writing/` | Selection 自写 | 能力参照 dsh-desktop gov-doc-writing，未复用其内容 |
| `cases/selection-samples/` | Selection 自编 | 虚构小样，待 LinNai 确认是否保留 |

`meeting-recap/scripts/validate_minutes.py` 没有搬入。等价实现是 `packages/office-business-runtime/src/validate-minutes.ts`。
