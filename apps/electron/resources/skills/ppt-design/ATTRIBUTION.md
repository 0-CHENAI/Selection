# Attribution / 适配来源

## 本目录现在包含什么

页面格式、预检和 PPTX 导出是 Selection 自己的实现，使用 [PptxGenJS](https://github.com/gitbrent/PptxGenJS) 3.12.0（MIT，Copyright (c) 2015-Present Brent Ely）。没有复制其他产品的页面引擎源码。

两套参考页的几何和文案是为 Selection 写的。配色和字号节奏使用了下面的开源材料，没有嵌入其 HTML、字体或标志。

## Zara Zhang / beautiful-html-templates

- 项目：<https://github.com/zarazhangrui/beautiful-html-templates>
- 许可：MIT，Copyright (c) 2026 Zara Zhang。
- 锁定提交：`e5e204fb1f3b06290846e7dcd7aceddabeceec8c`。
- `blue-professional` 的奶油 `#FDFAE7`、钴蓝 `#1E2BFA`、墨 `#111111` 用于 `cobalt-brief`。该模板提到的 Space Grotesk 与 Inter 只是参考，运行时改用系统字体，不嵌入字体文件。
- `raw-grid` 的硬边、系统无衬线和放大数字，用来校准 `swiss-signal` 的字号节奏。页面坐标不是从那些 HTML 转来的。

## 设计系统结构

`design.md` 的写法（调色板、字体回退、边距、字号区间、版式清单、来源）参考了 DSH Desktop 公开发布的设计说明和版式清单的信息架构。DSH Desktop 以 MIT 发布。本目录没有复制其 `packages/ppt-runtime` 或 PPTD 引擎实现。

## 早前的审查习惯

G1–G5 和「整项任务最多三次视觉检查」沿用本技能上一版已经写进 Selection 的交付习惯。那一版的配方、三套换色风格和 OfficeCLI 构图脚本已经移除。早前文档改编自 hugohe3/ppt-master（MIT，Copyright (c) 2025-2026 Hugo He），锁定提交 `622bf0148bca4f697b0184322c7e2aa2a04520a2` 与 `523e5bd972f94c3cac8742fec0d54d43824a17bb`。本目录不再附带那些 SVG、占位符协议或品牌材料。

## 不包含的东西

没有第三方公司标志，没有字体二进制，没有社区模板包。许可保留不表示上游作者认可本集成，也不授予商标权利。
