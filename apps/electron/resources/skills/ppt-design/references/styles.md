# 风格

先读本页，再只打开选定风格的 `design.md`。中文参考页是 `deck.json`，英文参考页是 `deck.en.json`。不要一次读入两套参考页。

索引：[styles/catalog.json](../styles/catalog.json)。五套都是 12 页、960×540 pt。页面从 DSH Desktop v0.2.21 转入，几何和示例文案保持源页面。许可见 [ATTRIBUTION](../ATTRIBUTION.md)。

| id | 材料 | 封面气质 | 许可 |
|---|---|---|---|
| `dsh-cartesian` | 理性简报、取舍、可检验的判断 | 暖石色纸面，衬线标题，细圆和发丝线 | MIT |
| `dsh-course-workshop` | 培训、课程、工作坊 | 学习目标边栏，概念图，练习和自测 | Apache-2.0 |
| `dsh-editorial-notebook` | 研究、观点、业务叙事 | 双栏论述，边注，证据条，决策矩阵 | MIT |
| `dsh-engineering-blueprint` | 架构评审、技术方案、执行计划 | 纸张底色，工程网格，流程盒，反馈路径 | Apache-2.0 |
| `dsh-soft-editorial` | 观察手记、需要细读的判断 | 奶油纸，圆角色卡，衬线大标题 | MIT |

锁定一个 `theme.id`。字体、颜色、边距和字号区间以该风格的 `design.md` 为准。参考页里的句子和数字是虚构示例，必须换成用户材料；换完后几何可以调整，但要重新预检。

没有合适的参考页时，仍使用该风格的 token、边距和字号区间，新开一个 `layout` id，不要混入另一套的色值。

两处中文源页面会报 `orphan`：`dsh-course-workshop` 第 3 页 `03:t7`「从引导练习走向独立完成」，`dsh-engineering-blueprint` 第 3 页 `03:t101`「明确每一层边界」。沿用这些页时重排句子。不要缩小字号，也不要把框加宽到撞上邻列。其余参考页没有这个问题。
