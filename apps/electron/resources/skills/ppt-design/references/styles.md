# 两套风格与真实字体

选择时只读本页概览及所选 `styles/<id>/design.md`。机器值在 `theme.json`。风格同时决定配色、字体和整页构图；不能拼成第三套。

| ID | 适合 | 识别特征 |
|---|---|---|
| `swiss-signal` | 经营复盘、市场与决策材料 | 纸白、纯黑、信号红、左索引轨、超大数字、细线网格 |
| `navy-brief` | 决策简报、假设验证 | 海军底、奶油字、金色强调、低位大标题、暗面模块 |

画布 960 × 540 pt。正文通常 18 pt，标题 28–34 pt，来源/页脚 11–12 pt，大数字 48–64 pt。拆页，不缩字。

## swiss-signal

纸 `#F5F3EE`，墨 `#111111`，信号红 `#E52333`。红色只用于焦点色块和大数字，小标签用黑或深灰。左 18 pt 黑轨固定边界。

| 平台 | Latin | CJK |
|---|---|---|
| macOS | Helvetica Neue | PingFang SC |
| Windows | Arial | Microsoft YaHei |
| Linux | Noto Sans | Noto Sans CJK SC |

## navy-brief

底 `#0B1220`，字 `#F3EEE4`，金 `#C9A36A`。封面是金线、低位标题和右侧决策条，不用红块。内容页用暗面模块和金色门槛线。

| 平台 | Latin | CJK |
|---|---|---|
| macOS | Helvetica Neue | PingFang SC |
| Windows | Segoe UI | Microsoft YaHei |
| Linux | Noto Sans | Noto Sans CJK SC |

锁定前确认渲染环境的字体。Linux 缺 Noto 时须记录实际替代（如 WenQuanYi Micro Hei），并重做适配。本机通过不等于接收端已嵌入字体。
