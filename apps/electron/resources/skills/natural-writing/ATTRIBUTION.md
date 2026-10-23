# 来源与适配

此技能的正文完整来自 [op7418/Humanizer-zh](https://github.com/op7418/Humanizer-zh)。获取的提交是 `f4518a8eab97b8bfebc66a89d34320a89bef6930`（2026-09-23，`fix: preserve meaning and author voice in Chinese rewrites`）。同目录 `LICENSE` 是上游 MIT 许可证原文。

Selection 适配：

- 目录 id 仍是 `natural-writing`。显式选择会把这份捆绑技能注入当前回合，工作区里的同名覆盖仍走 Read，已有会话里的 `[skill:natural-writing]` 也继续指向这里。仓库没有技能别名，改成 `humanizer-zh` 会让这些路径直接失败。
- frontmatter 改成 Selection 的 `name` 与 `description`。显示名为 Humanizer-zh。描述只覆盖中文正文，并与 `humanizer`、`academic-humanizer` 分开；普通问答、代码、检索、逐字引用、逐字翻译和纯排版不使用。
- 去掉上游的 `allowed-tools` 和 `metadata`，避免指向 Selection 没有的工具。中文正文、31 条模式、优先级（保留事实与确定程度 > 用户范围和文体 > 作者声音 > 具体模式）以及默认只交付最终文本，都保持原样。

本文件和 `LICENSE` 只用于来源追溯，不要加载到模型上下文。
