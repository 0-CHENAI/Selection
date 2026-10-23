# 引擎能力边界

新建演示文稿由 PptxGenJS 写出原生文本、形状、图片和 Office 图表，不是整页图片。预览 SVG/PNG 只用于自查，不贴进幻灯片。

OfficeCLI 若把 SVG 当作图片导入，那是已有文件编辑路径，不是本引擎的导出方式。不要把预览 SVG 再导入去“修复”几何。

图表：`bar`/`column`/`line`/`pie`/`doughnut` 为原生图表；`waterfall` 用堆叠柱模拟（基座系列对读者隐藏）。漏斗等结构用形状表达。
